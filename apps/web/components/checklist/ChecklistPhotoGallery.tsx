'use client'

import * as React from 'react'
import { ChevronLeft, ChevronRight, Loader2, MessageSquare, Trash2, X } from 'lucide-react'
import type { ChecklistPhoto } from '@repo/types'

const VISIBLE = 3

// Session F3, Part E — this component serves two jobs with opposite needs, so it now takes an
// explicit variant instead of one set of dimensions tuned for the first one:
//
//   'evidence'  (default, UNCHANGED) — auditor-uploaded proof photos, shown in a dense table
//               cell / row. size-8 tiles, max 3 with a "+N" overflow badge. The point is a
//               compact indicator you tap to inspect.
//   'reference' — admin-attached INSTRUCTIONAL images on the auditor E-form (สนข.: "ปรับรูปให้
//               เห็นชัดขึ้น"). These have to be legible at a glance on a phone WITHOUT tapping,
//               so they render as a full-width grid of large tiles with every image visible —
//               an instruction hidden behind a "+2" badge is an instruction nobody reads.
//   'detail'   — the admin checklist-review table's detail row. Live feedback: the full-width
//               'reference' grid read as too large there. size-16 tiles, every photo shown (no
//               "+N" cap — unlike 'evidence' this isn't a cramped table cell) — matches PhotoPicker's
//               OWN upload-preview tile size exactly, so a photo looks the same size reviewed here
//               as it did when the auditor just uploaded it.
//
// All three variants keep the identical tap-to-open lightbox; only the inline presentation differs.
export type PhotoGalleryVariant = 'evidence' | 'reference' | 'detail'

const VARIANT_STYLES: Record<PhotoGalleryVariant, { wrapper: string; tile: string; img: string }> = {
  evidence: {
    wrapper: 'flex items-center gap-1',
    tile:    'relative size-8 shrink-0 overflow-hidden rounded border border-border shadow-sm',
    img:     'size-full object-cover',
  },
  reference: {
    // A grid, not a strip: one big image when there's one (the common case), two-up beyond that,
    // so a single reference diagram gets the full width it needs to be readable.
    wrapper: 'grid w-full grid-cols-1 gap-2 sm:grid-cols-2',
    tile:    'relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-border bg-white shadow-sm',
    // `contain`, not `cover`: a cropped diagram loses exactly the edges that carry the dimension
    // annotations these images exist to show.
    img:     'size-full object-contain',
  },
  detail: {
    wrapper: 'flex flex-wrap gap-2',
    tile:    'relative size-16 shrink-0 overflow-hidden rounded-lg border border-border shadow-sm',
    img:     'size-full object-cover',
  },
}

// ── Carousel lightbox ──────────────────────────────────────────
export function PhotoLightbox({
  photos,
  startIndex,
  onClose,
  onDelete,
  onCaptionChange,
}: {
  photos: ChecklistPhoto[]
  startIndex: number
  onClose: () => void
  // Session E3, Part C.2/C.3 — auditors get a delete action on their own photos, reusing this
  // same viewer rather than a second one; admins (no onDelete passed) stay read-only.
  onDelete?: (photo: ChecklistPhoto) => void | Promise<void>
  // Part C — same editable/read-only split as onDelete above: passed only by the auditor's own
  // capture view (LeafAnswerRow), live-typed straight into the answer store exactly like the
  // existing per-item note field (no separate save step — it rides the same autosave). Absent
  // everywhere else (admin view, the auditor's own read-only my-work detail), where a caption —
  // if the photo has one — renders as plain text instead.
  onCaptionChange?: (photo: ChecklistPhoto, caption: string) => void
}) {
  const [idx, setIdx] = React.useState(startIndex)
  const [deleting, setDeleting] = React.useState(false)
  const total = photos.length
  const photo = photos[idx]

  // Reacts to the PARENT's photos array actually shrinking (after a successful delete mutation
  // re-renders with one fewer photo) rather than guessing the post-delete index up front.
  React.useEffect(() => {
    if (total === 0) { onClose(); return }
    if (idx > total - 1) setIdx(total - 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total])

  // Scroll lock
  React.useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // Keyboard
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape')      onClose()
      if (e.key === 'ArrowLeft'  && idx > 0)           setIdx(i => i - 1)
      if (e.key === 'ArrowRight' && idx < total - 1)   setIdx(i => i + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [idx, total, onClose])

  // The shrink-driven effect above closes the lightbox on the render where total hits 0; this
  // guards the one render in between (photo briefly undefined) without skipping any hook above.
  if (!photo) return null

  async function handleDelete() {
    if (!onDelete || deleting || !photo) return
    setDeleting(true)
    try {
      await onDelete(photo)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Counter */}
      <p className="absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-black/40 px-3 py-1 text-xs text-white/80">
        {idx + 1} / {total}
      </p>

      {/* Close */}
      <button
        onClick={onClose}
        className="absolute right-4 top-4 flex size-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
      >
        <X size={16} />
      </button>

      {/* Prev */}
      <button
        disabled={idx === 0}
        onClick={e => { e.stopPropagation(); setIdx(i => i - 1) }}
        className="absolute left-4 flex size-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-20"
      >
        <ChevronLeft size={24} />
      </button>

      {/* Image */}
      <div className="relative max-h-[85vh] max-w-[80vw]" onClick={e => e.stopPropagation()}>
        <img
          src={photo.url}
          alt={photo.filename}
          loading="lazy"
          className="max-h-[85vh] max-w-[80vw] rounded-xl object-contain shadow-2xl"
        />
        <div className="mt-2 flex items-center justify-center gap-3">
          <p className="text-center text-xs text-white/50">{photo.filename}</p>
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); void handleDelete() }}
              disabled={deleting}
              className="flex items-center gap-1 rounded-full bg-red-500/20 px-2 py-0.5 text-[11px] font-medium text-red-200 hover:bg-red-500/30 disabled:opacity-50"
            >
              {deleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
              ลบรูปนี้
            </button>
          )}
        </div>

        {/* Part C — per-photo caption. Editable (auditor's own capture) mirrors the existing
            per-item note field exactly: live onChange straight into the answer store, no separate
            save step. Read-only elsewhere (admin, my-work detail): plain text, shown only when
            the photo actually has one — a caption-less legacy photo renders with nothing here. */}
        {onCaptionChange ? (
          <input
            type="text"
            value={photo.caption ?? ''}
            onChange={(e) => onCaptionChange(photo, e.target.value)}
            onClick={(e) => e.stopPropagation()}
            placeholder="เพิ่มคำอธิบายรูปนี้ (ถ้ามี)"
            className="mt-2 w-full max-w-[80vw] rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-center text-xs text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/40"
          />
        ) : photo.caption ? (
          <p className="mt-2 flex items-center justify-center gap-1 text-center text-xs text-white/70">
            <MessageSquare size={11} className="shrink-0" /> {photo.caption}
          </p>
        ) : null}
      </div>

      {/* Next */}
      <button
        disabled={idx === total - 1}
        onClick={e => { e.stopPropagation(); setIdx(i => i + 1) }}
        className="absolute right-4 flex size-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-20"
      >
        <ChevronRight size={24} />
      </button>
    </div>
  )
}

// ── Thumbnail strip — max VISIBLE + "+N" overflow ──────────────
export function ChecklistPhotoGallery({ photos, onDelete, onCaptionChange, variant = 'evidence' }: {
  photos: ChecklistPhoto[]
  onDelete?: (photo: ChecklistPhoto) => void | Promise<void>
  // Part C — see PhotoLightbox's doc; forwarded straight through so a reviewer scanning the
  // dense evidence-photo strip (e.g. the admin checklist view) sees a small indicator on any tile
  // that has one (below), and gets the full text once they tap into the lightbox.
  onCaptionChange?: (photo: ChecklistPhoto, caption: string) => void
  // Session F3, Part E — defaults to the pre-F3 appearance, so every existing evidence call site
  // is untouched.
  variant?: PhotoGalleryVariant
}) {
  const [lightboxIdx, setLightboxIdx] = React.useState<number | null>(null)
  const btnRefs = React.useRef<(HTMLButtonElement | null)[]>([])

  if (photos.length === 0) {
    return <span className="text-[10px] text-muted-foreground/40">—</span>
  }

  const styles = VARIANT_STYLES[variant]
  // Reference images are instructions, and 'detail' has the room a table cell doesn't — both show
  // every photo, never collapsed behind a "+N". Only the dense 'evidence' strip caps + overflows.
  const showAll  = variant === 'reference' || variant === 'detail'
  const visible  = showAll ? photos : photos.slice(0, VISIBLE)
  const overflow = showAll ? 0 : photos.length - VISIBLE

  function open(i: number) { setLightboxIdx(i) }

  function close() {
    const lastVisible = visible.length - 1
    const trigger = lightboxIdx !== null ? (btnRefs.current[Math.min(lightboxIdx, lastVisible)] ?? null) : null
    setLightboxIdx(null)
    trigger?.focus()
  }

  return (
    <>
      <div className={styles.wrapper}>
        {visible.map((p, i) => {
          const showOverlay = !showAll && i === VISIBLE - 1 && overflow > 0
          return (
            <button
              key={p.id}
              ref={el => { btnRefs.current[i] = el }}
              onClick={() => open(i)}
              className={`${styles.tile} focus:outline-none focus:ring-2 focus:ring-ring/60`}
            >
              <img src={p.url} alt={p.filename} loading="lazy" className={styles.img} />
              {/* Part C — a tile is too small for the caption text itself (size-8 in the dense
                  evidence strip); this just flags WHICH photo has one, so a reviewer knows to tap
                  in rather than having to open every photo to check. */}
              {p.caption && (
                <div className="absolute right-0.5 top-0.5 flex size-3 items-center justify-center rounded-full bg-black/60">
                  <MessageSquare size={7} className="text-white" />
                </div>
              )}
              {showOverlay && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-[10px] font-bold text-white">
                  +{overflow}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {lightboxIdx !== null && (
        <PhotoLightbox
          photos={photos}
          startIndex={lightboxIdx}
          onClose={close}
          onDelete={onDelete}
          onCaptionChange={onCaptionChange}
        />
      )}
    </>
  )
}
