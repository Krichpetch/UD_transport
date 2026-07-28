'use client'

// W2-S3a Part A.2 — dedicated read-only tree renderer for the admin template editor. Deliberately
// NOT a reuse of apps/web/components/audit/V2PagerForm.tsx: that component is tightly coupled to
// the global useAuditFormStore Zustand singleton (every leaf reads/writes it directly, no
// prop-driven data API) and has no real read-only mode (its `disabled` prop is cosmetic CSS
// only) — turning it into a standalone-definition renderer would be a bigger refactor than this
// session's scope. This component instead shares the underlying TemplateNode SHAPE-TRAVERSAL
// logic (walk node.subItems, discriminate on node.answerType) with that renderer and with
// @repo/types#walkTemplateLeaves, so "what counts as a leaf" is still defined in exactly one
// place even though the rendering code itself is new.
import * as React from 'react'
import type { ChecklistTemplateDefinition, TemplateNode } from '@repo/types'
import { walkTemplateLeaves } from '@repo/types'
import { CheckCircle2, ChevronRight, Image as ImageIcon, Scale, Search, SkipForward, X } from 'lucide-react'
import { INPUT_CLS } from '@/lib/ui-classes'
import { PhotoLightbox } from '@/components/checklist/ChecklistPhotoGallery'
import { useTemplateImageUrls } from '@/hooks/use-template-image-urls'
import { useRemoveTemplateImage } from '@/hooks/use-templates-admin'

// Image-count badge that doubles as a delete affordance — click opens the same lightbox the
// editor dialog uses (with delete wired up), without having to open the full node editor just to
// remove one bad image. stopPropagation keeps this from also triggering the row's onSelect.
function NodeImageBadge({ templateId, node }: { templateId: string; node: TemplateNode }) {
  const [open, setOpen] = React.useState(false)
  const keys = node.imageKeys ?? []
  const { data: urls } = useTemplateImageUrls(keys)
  const removeImage = useRemoveTemplateImage(templateId)
  if (keys.length === 0) return null

  const photos = keys
    .map((key) => ({ id: key, url: urls?.[key] ?? '', filename: key.split('/').pop() ?? key, uploadedAt: '' }))
    .filter((p) => p.url)

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          if (photos.length > 0) setOpen(true)
        }}
        className="text-muted-foreground hover:text-foreground flex shrink-0 items-center gap-0.5"
        title="ดู/ลบรูปภาพ"
      >
        <ImageIcon size={13} />
        {keys.length}
      </button>
      {open && photos.length > 0 && (
        <PhotoLightbox
          photos={photos}
          startIndex={0}
          onClose={() => setOpen(false)}
          onDelete={async (photo) => {
            await removeImage.mutateAsync({ nodeCode: node.code, key: photo.id })
          }}
        />
      )}
    </>
  )
}

function nodeMatchesQuery(node: TemplateNode, query: string): boolean {
  if (node.code.toLowerCase().includes(query) || node.labelTh.toLowerCase().includes(query)) return true
  return node.subItems?.some((c) => nodeMatchesQuery(c, query)) ?? false
}

function leafConfirmState(node: TemplateNode): 'none' | 'partial' | 'full' {
  const measurements = node.measurements ?? []
  if (measurements.length === 0) return 'none'
  const confirmed = measurements.filter((m) => m.confirmed).length
  if (confirmed === measurements.length) return 'full'
  if (confirmed === 0) return 'none'
  return 'partial'
}

function LeafBadges({ templateId, node }: { templateId: string; node: TemplateNode }) {
  const measurements = node.measurements ?? []
  const confirmed = measurements.filter((m) => m.confirmed).length
  const hasEra = measurements.some((m) => m.byLaw)
  return (
    <div className="flex shrink-0 items-center gap-2 text-xs">
      {measurements.length > 0 && (
        <span
          className={`rounded px-1.5 py-0.5 font-medium ${
            confirmed === measurements.length ? 'bg-[#52aa4e]/10 text-[#52aa4e]' : 'bg-[#ffc107]/10 text-[#b38600]'
          }`}
        >
          {confirmed}/{measurements.length} ยืนยันแล้ว
        </span>
      )}
      {hasEra && (
        <span title="มีข้อยกเว้นตามยุคกฎหมาย">
          <Scale size={13} className="text-purple-500" />
        </span>
      )}
      <NodeImageBadge templateId={templateId} node={node} />
    </div>
  )
}

// Same spirit as the auditor form's per-row indicator (LeafAnswerRow.tsx): a filled green check
// when every measurement on this leaf is confirmed, a half-filled amber dot when some are, and a
// plain outline when none are (or the leaf has no measurements to confirm at all) — so completion
// status reads at a glance without having to parse the "X/Y ยืนยันแล้ว" pill text.
function ConfirmDot({ node }: { node: TemplateNode }) {
  const state = leafConfirmState(node)
  if (state === 'full') return <CheckCircle2 size={16} className="shrink-0 text-[#52aa4e]" />
  if (state === 'partial') return <span className="block size-4 shrink-0 rounded-full border-2 border-[#ffc107] bg-[#ffc107]/30" />
  return <span className="border-border block size-4 shrink-0 rounded-full border-2" />
}

function NodeRow({
  templateId,
  node,
  depth,
  breadcrumb,
  selectedCode,
  onSelect,
  query,
}: {
  templateId: string
  node: TemplateNode
  depth: number
  breadcrumb: string[]
  selectedCode: string | null
  onSelect: (node: TemplateNode, breadcrumb: string[]) => void
  query: string
}) {
  const hasChildren = !!node.subItems && node.subItems.length > 0
  const isAnswerable = !!node.answerType
  const [manuallyOpen, setManuallyOpen] = React.useState(depth < 1)
  const searching = query.length > 0
  if (searching && !nodeMatchesQuery(node, query)) return null
  // While searching, force every matching branch open so results are never hidden behind a
  // collapsed group — this is the "search" half of the navigator, not just highlighting.
  const open = searching ? true : manuallyOpen

  return (
    <div>
      <div
        className={`flex items-center gap-1 rounded px-2 py-2 text-sm ${selectedCode === node.code ? 'bg-primary/10' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {/* Expand/collapse is its own click target now, separate from selecting the node —
            previously a container's only click behavior WAS expand/collapse (isAnswerable
            gated onSelect), which meant a pure A.X container could never be opened in the
            editor at all, so admins had no way to attach images to the level most images
            actually live at. Every node — leaf or container — is selectable now. */}
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setManuallyOpen((o) => !o)}
            className="hover:bg-secondary shrink-0 rounded p-0.5"
          >
            <ChevronRight size={14} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
          </button>
        ) : (
          <span className="w-[22px] shrink-0" />
        )}
        <div
          className="hover:bg-secondary/60 flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded px-1 py-0.5"
          onClick={() => onSelect(node, breadcrumb)}
        >
          {isAnswerable && <ConfirmDot node={node} />}
          <span className="bg-secondary text-muted-foreground shrink-0 rounded px-1.5 py-0.5 font-mono text-xs">{node.code}</span>
          <span className="text-foreground min-w-0 flex-1 truncate">{node.labelTh}</span>
          {isAnswerable ? (
            <LeafBadges templateId={templateId} node={node} />
          ) : (
            <div className="shrink-0 text-xs">
              <NodeImageBadge templateId={templateId} node={node} />
            </div>
          )}
        </div>
      </div>
      {hasChildren && open && (
        <div>
          {node.subItems!.map((child) => (
            <NodeRow
              key={child.code}
              templateId={templateId}
              node={child}
              depth={depth + 1}
              breadcrumb={[...breadcrumb, node.labelTh]}
              selectedCode={selectedCode}
              onSelect={onSelect}
              query={query}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function TemplateTree({
  templateId,
  definition,
  selectedCode,
  onSelect,
}: {
  templateId: string
  definition: ChecklistTemplateDefinition
  selectedCode: string | null
  onSelect: (node: TemplateNode, breadcrumb: string[]) => void
}) {
  const [query, setQuery] = React.useState('')
  const normalizedQuery = query.trim().toLowerCase()

  // "Next unconfirmed" jump — walks the leaves in document order (same order the tree renders
  // them in) starting just after the current selection, wrapping around once. Opens that leaf's
  // editor directly rather than scrolling to it, since the editor is where the actual work of
  // confirming happens anyway.
  function jumpToNextUnconfirmed() {
    const leaves = walkTemplateLeaves(definition)
    const unconfirmed = leaves.filter((l) => (l.measurements ?? []).some((m) => !m.confirmed))
    if (unconfirmed.length === 0) return
    const currentIdx = selectedCode ? unconfirmed.findIndex((l) => l.code === selectedCode) : -1
    const next = unconfirmed[(currentIdx + 1) % unconfirmed.length]!
    onSelect(next, [])
  }

  const unconfirmedCount = React.useMemo(
    () => walkTemplateLeaves(definition).filter((l) => (l.measurements ?? []).some((m) => !m.confirmed)).length,
    [definition],
  )

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search size={15} className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหารหัสหรือชื่อรายการ…"
            className={`${INPUT_CLS} py-2 pl-8 pr-8 text-sm`}
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
            >
              <X size={14} />
            </button>
          )}
        </div>
        {unconfirmedCount > 0 && (
          <button
            type="button"
            onClick={jumpToNextUnconfirmed}
            className="border-border bg-card hover:bg-secondary/60 flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium"
            title="ไปยังเกณฑ์ที่ยังไม่ยืนยันถัดไป"
          >
            <SkipForward size={15} />
            ถัดไป ({unconfirmedCount})
          </button>
        )}
      </div>

      <div className="themed-scrollbar max-h-[70vh] overflow-y-auto">
        {definition.groups.map((group) => (
          <div key={group.code} className="mb-1">
            {(!normalizedQuery || group.items.some((it) => nodeMatchesQuery(it, normalizedQuery))) && (
              // Solid background — this is `sticky top-0`, pinned over rows scrolling underneath
              // it. A translucent bg-secondary/40 let those rows show through and visually
              // overlap the header text; bg-secondary (no opacity) fully occludes them.
              <div className="text-muted-foreground bg-secondary sticky top-0 z-10 px-2 py-2 text-sm font-semibold shadow-sm">
                {group.code} {group.labelTh}
              </div>
            )}
            {group.items.map((item) => (
              <NodeRow
                key={item.code}
                templateId={templateId}
                node={item}
                depth={0}
                breadcrumb={[group.labelTh]}
                selectedCode={selectedCode}
                onSelect={onSelect}
                query={normalizedQuery}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
