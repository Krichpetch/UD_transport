// E-form redesign (Session E2, Parts B/C/D) — pure conversion functions between a
// ChecklistTemplateDefinition (the FORM, keyed by `code`) and the flat answer map the Zustand
// audit-form store holds (keyed by the same `code`, which doubles as StoredChecklistNode.id on
// the wire). Kept framework-free and side-effect-free so it's trivially testable and reusable
// from both the store and any read-only preview.
import type {
  ChecklistTemplateDefinition,
  ChecklistTemplateGroupDef,
  TemplateNode,
  ChecklistPhoto,
  ChecklistValue,
  FacilityMetrics,
} from '@repo/types'
import { computeFacilityMetrics } from '@repo/types'
import { CHECKLIST_CATEGORIES } from '@/lib/constants'
import type { NavigatorPage, NavigatorLeafPreview } from '@/components/audit/PageNavigator'

// One leaf's answer, shape a superset of every answerType — unused fields simply stay at their
// default. Mirrors @repo/types#StoredChecklistNode minus the tree-structural fields (id/labelTh/
// subItems), which the template supplies.
export interface AuditAnswer {
  value: ChecklistValue          // 'choice' (v1) only
  meetsStandard: boolean         // 'choice', and 'presence_standard' with no measurements
  present: boolean | null        // 'presence' | 'presence_standard'
  values: Record<string, number> // 'presence_standard' with measurements — keyed by measurement key, or by tiered inputs[].key
  note: string
  photos: ChecklistPhoto[]
  flagged: boolean
  reviewFlag: boolean
}

export type AnswerMap = Record<string, AuditAnswer>

export function defaultAnswer(): AuditAnswer {
  return { value: null, meetsStandard: false, present: null, values: {}, note: '', photos: [], flagged: false, reviewFlag: false }
}

function visitLeaves(def: ChecklistTemplateDefinition, fn: (node: TemplateNode) => void): void {
  const visit = (node: TemplateNode) => {
    if (node.answerType) fn(node)
    node.subItems?.forEach(visit)
  }
  def.groups.forEach((g) => g.items.forEach(visit))
}

// Fresh answers for every leaf in the template — the "empty form" state.
export function seedAnswers(def: ChecklistTemplateDefinition): AnswerMap {
  const answers: AnswerMap = {}
  visitLeaves(def, (node) => { answers[node.code] = defaultAnswer() })
  return answers
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Rehydrates from a previously-stored `items` blob (a DRAFT's ChecklistGroup[]/StoredChecklistNode
// tree) — matched to template leaves by `id === code`. Unmatched stored nodes (a retired leaf) and
// missing template leaves (never answered) are both handled gracefully: seedAnswers() supplies the
// default for anything the stored blob doesn't cover.
export function hydrateAnswers(def: ChecklistTemplateDefinition, storedGroups: unknown): AnswerMap {
  const answers = seedAnswers(def)
  if (!Array.isArray(storedGroups)) return answers

  const visitStored = (node: unknown) => {
    if (!isPlainObject(node)) return
    const id = node.id
    if (typeof id === 'string' && answers[id]) {
      const existing = answers[id]
      answers[id] = {
        value: (node.value as ChecklistValue | undefined) ?? existing.value,
        meetsStandard: typeof node.meetsStandard === 'boolean' ? node.meetsStandard : existing.meetsStandard,
        present: node.present !== undefined ? (node.present as boolean | null) : existing.present,
        values: isPlainObject(node.values) ? (node.values as Record<string, number>) : existing.values,
        note: typeof node.note === 'string' ? node.note : existing.note,
        photos: Array.isArray(node.photos) ? (node.photos as ChecklistPhoto[]) : existing.photos,
        flagged: typeof node.flagged === 'boolean' ? node.flagged : existing.flagged,
        reviewFlag: typeof node.reviewFlag === 'boolean' ? node.reviewFlag : existing.reviewFlag,
      }
    }
    if (Array.isArray(node.subItems)) node.subItems.forEach(visitStored)
  }

  for (const g of storedGroups) {
    if (isPlainObject(g) && Array.isArray(g.items)) g.items.forEach(visitStored)
  }
  return answers
}

// A leaf counts as "answered" for progress purposes when it has a definite value — bare "present"
// on a presence_standard leaf whose standard verdict isn't resolved yet still counts (the auditor
// DID answer มี/ไม่มี, which is the countable unit — see DATA_DICTIONARY_v2.md §2's bare-มี note).
// `value === 'N/A'` is a universal marker (Session E2 follow-up) usable on ANY answerType — e.g.
// three mutually-exclusive ramp-length criteria where only one applies to the physical ramp; the
// other two are marked ไม่เกี่ยวข้อง rather than left unanswered or forced to ไม่มี.
export function isLeafAnswered(node: TemplateNode, answer: AuditAnswer | undefined): boolean {
  if (!answer) return false
  if (answer.value === 'N/A') return true
  if (node.answerType === 'choice') return answer.value !== null
  return answer.present !== null
}

export function countProgress(def: ChecklistTemplateDefinition, answers: AnswerMap): { answered: number; total: number } {
  return countProgressForNodes(def.groups.flatMap((g) => g.items), answers)
}

// Same tally, scoped to an arbitrary subtree — used for per-group/per-item progress indicators
// (Part B.4) without walking the whole template each time.
export function countProgressForNodes(nodes: TemplateNode[], answers: AnswerMap): { answered: number; total: number } {
  let total = 0
  let answered = 0
  const visit = (node: TemplateNode) => {
    // Part C.5 — era-redacted leaves are excluded from the checklist's applicable item set
    // entirely (not merely N/A'd); they never enter the progress denominator, same as scoring.
    if (node.answerType && node.applicable !== false) {
      total++
      if (isLeafAnswered(node, answers[node.code])) answered++
    }
    node.subItems?.forEach(visit)
  }
  nodes.forEach(visit)
  return { answered, total }
}

// Part C.3 — every answerable descendant leaf below `node` (node itself included, if it is one)
// that the frozen era stamp marked non-applicable. Used to render the collapsed per-group footer
// note ("รายการที่ไม่เข้าข่ายตามกฎหมายที่ใช้บังคับ (N รายการ)") — auditors never answer these, so
// they're listed read-only, never as a normal answerable row.
export function collectRedactedLeaves(nodes: TemplateNode[]): TemplateNode[] {
  const out: TemplateNode[] = []
  const visit = (node: TemplateNode) => {
    if (node.answerType && node.applicable === false) out.push(node)
    node.subItems?.forEach(visit)
  }
  nodes.forEach(visit)
  return out
}

// True when `node` (leaf or container) has nothing answerable left after redaction — a leaf whose
// own applicable is false, or a pure container whose every descendant leaf is redacted. Used to
// skip whole v2 pager pages / child rows for a fully non-applicable item, per Part C.3 ("auditors
// cannot answer them" — they must not even see an empty answerable row for one).
export function isNodeFullyRedacted(node: TemplateNode): boolean {
  if (node.answerType) return node.applicable === false
  if (!node.subItems || node.subItems.length === 0) return false
  return node.subItems.every(isNodeFullyRedacted)
}

// One node of the wire payload — matches @repo/types#StoredChecklistNode, built from the
// template's structure + the answer map. `note`/`photos` are always emitted (v1 parity: the old
// ChecklistSubItem shape requires them non-optional).
interface BuiltNode {
  id: string
  labelTh: string
  answerType?: TemplateNode['answerType']
  value?: ChecklistValue
  meetsStandard?: boolean
  cabinetPriority?: boolean
  present?: boolean | null
  values?: Record<string, number>
  note: string
  photos: ChecklistPhoto[]
  flagged?: boolean
  reviewFlag: boolean
  applicable?: boolean
  subItems?: BuiltNode[]
}

function buildNode(node: TemplateNode, answers: AnswerMap): BuiltNode {
  const a = answers[node.code] ?? defaultAnswer()
  const out: BuiltNode = {
    id: node.code,
    labelTh: node.labelTh,
    note: a.note,
    photos: a.photos,
    reviewFlag: a.reviewFlag,
    // Session F1, Part C.4 — carried through from the (already era-marked) template so the
    // in-progress live score preview excludes redacted leaves too, matching what the server will
    // authoritatively bake in at submit time (ChecklistsService#applyRedactionFlags).
    ...(node.applicable === false ? { applicable: false as const } : {}),
  }

  if (node.answerType) {
    out.answerType = node.answerType
    if (node.answerType === 'choice') {
      out.value = a.value
      out.meetsStandard = a.meetsStandard
      out.cabinetPriority = node.cabinetResolution ?? false
      out.flagged = a.flagged
    } else {
      // presence / presence_standard — universal N/A marker, orthogonal to `present` (Session E2
      // follow-up); see isLeafAnswered's doc for why this exists.
      if (a.value === 'N/A') out.value = 'N/A'
      if (node.answerType === 'presence') {
        out.present = a.present
      } else {
        out.present = a.present
        if (node.measurements && node.measurements.length > 0) {
          out.values = a.values
        } else {
          out.meetsStandard = a.meetsStandard
        }
      }
    }
  }

  if (node.subItems) out.subItems = node.subItems.map((c) => buildNode(c, answers))
  return out
}

// Builds the ChecklistGroup[]/StoredChecklistNode[] "items" payload the save-draft/submit
// endpoints expect. Group display name reproduces today's live form EXACTLY: the DB template's
// group.labelTh is the bare Thai name ('ที่จอดรถ'); the pre-E1 hardcoded form always showed it
// with the group code prefixed ('(A1) ที่จอดรถ') — see apps/api/prisma/v1-template-groups.ts.
// Reproduces today's live form's group header text exactly — see buildStoredGroups' doc.
export function groupDisplayName(g: { code: string; labelTh: string }): string {
  return `(${g.code}) ${g.labelTh}`
}

// Auto-derived rollup for a container node (e.g. A1.1) — computed fresh from its descendant
// leaves every render; the container itself is NEVER an independent scored data point (giving it
// its own template-level answerType would double-count against its children in the scoring
// totals — see the E2 follow-up discussion). Two uses:
//   1. Read-only display (e.g. the item pager's collapsed preview).
//   2. Driving the container's own มี/ไม่มี BUTTON highlight in V2PagerForm's ContainerNode — a
//      real one-click auditor action ("does ทางลาด exist here at all?") that CASCADES to every
//      descendant leaf (see collectLeafCodes below) rather than requiring the auditor to open
//      each mutually-exclusive sub-criterion individually and mark it ไม่เกี่ยวข้อง one at a time.
//      'ไม่เกี่ยวข้อง' (every descendant N/A) reads as "ไม่มี" at the container level in that UI —
//      from the container's perspective, "every specific criterion is inapplicable" IS "it
//      doesn't exist" — this function itself stays a neutral, general-purpose aggregate; the
//      container-level ไม่มี/N/A relabeling is a UI-only mapping done in the component.
export type ContainerStatus = 'มี' | 'ไม่มี' | 'บางส่วน' | 'ไม่เกี่ยวข้อง' | 'ยังไม่ตอบ'

type LeafState = 'มี' | 'ไม่มี' | 'N/A' | 'unanswered'

function leafState(node: TemplateNode, answer: AuditAnswer | undefined): LeafState {
  if (!answer) return 'unanswered'
  if (answer.value === 'N/A') return 'N/A'
  if (node.answerType === 'choice') {
    if (answer.value === 'มี') return 'มี'
    if (answer.value === 'ไม่มี') return 'ไม่มี'
    return 'unanswered'
  }
  if (answer.present === true) return 'มี'
  if (answer.present === false) return 'ไม่มี'
  return 'unanswered'
}

export function computeContainerStatus(node: TemplateNode, answers: AnswerMap): ContainerStatus {
  const states: LeafState[] = []
  const visit = (n: TemplateNode) => {
    if (n.answerType) states.push(leafState(n, answers[n.code]))
    n.subItems?.forEach(visit)
  }
  node.subItems?.forEach(visit)

  if (states.length === 0) return 'ยังไม่ตอบ'
  const applicable = states.filter((s) => s !== 'N/A')
  if (applicable.length === 0) return 'ไม่เกี่ยวข้อง' // every descendant marked N/A
  if (applicable.some((s) => s === 'มี')) return 'มี'
  // Bug fix (Session E2 follow-up): a genuinely UNTOUCHED container (every descendant still
  // 'unanswered') must read as ยังไม่ตอบ, not บางส่วน — otherwise every container reports
  // "partial progress" from the very first render, which made ContainerNode's children show by
  // default instead of staying hidden until มี is actually clicked.
  if (applicable.every((s) => s === 'unanswered')) return 'ยังไม่ตอบ'
  if (applicable.every((s) => s === 'ไม่มี')) return 'ไม่มี'
  return 'บางส่วน' // a genuine mix of ไม่มี + unanswered, with no มี yet
}

// Every answerable descendant code below `node` (not including `node` itself) — the set a
// container-level ไม่มี click cascades N/A onto, or a มี click resets back to unanswered. Same
// traversal scope as computeContainerStatus, kept separate since callers need the raw codes (to
// build a bulk patch) rather than an aggregated verdict.
export function collectLeafCodes(node: TemplateNode): string[] {
  const codes: string[] = []
  const visit = (n: TemplateNode) => {
    if (n.answerType) codes.push(n.code)
    n.subItems?.forEach(visit)
  }
  node.subItems?.forEach(visit)
  return codes
}

// Session F1, Part A — same traversal as collectLeafCodes, but returns the actual node refs (not
// just codes) so a cascade can build an answerType-aware patch per leaf (ไม่มี means something
// different for a 'choice' leaf than for 'presence'/'presence_standard' — see absentPatchFor).
export function collectLeaves(node: TemplateNode): TemplateNode[] {
  const leaves: TemplateNode[] = []
  const visit = (n: TemplateNode) => {
    if (n.answerType) leaves.push(n)
    n.subItems?.forEach(visit)
  }
  node.subItems?.forEach(visit)
  return leaves
}

// Session F1, Part A.3 — a parent's ไม่มี cascades a REAL ไม่มี answer onto every descendant leaf
// (not N/A): the facility is missing, so its sub-standards genuinely fail การจัดให้มีฯ and must
// count in that denominator, not be excluded from it. Answer-type-aware since "ไม่มี" means a
// different stored shape per leaf kind. Measured values are always cleared.
export function absentPatchFor(node: TemplateNode): Partial<AuditAnswer> {
  return node.answerType === 'choice'
    ? { value: 'ไม่มี', meetsStandard: false, flagged: false }
    : { present: false, value: null, meetsStandard: false, values: {} }
}

// Session F3, Part B — NA_CASCADE_PATCH (the ไม่เกี่ยวข้อง cascade patch) has been REMOVED.
//
// สนข. 2026-08-03 (Dr.Aliz), confirmed by the audit team: "เอาปุ่ม ไม่เกี่ยวข้อง ออก" — auditors now
// answer with ไม่มี only, so no auditor code path may write 'N/A' any more. This constant was the
// only such write path, so deleting it is what makes that guarantee structural rather than a
// convention someone can re-break by adding a button back.
//
// 'N/A' itself is deliberately UNTOUCHED as a VALUE: it remains in ChecklistValue, in scoring.ts,
// in computeFacilityMetrics, in the excel export, in the admin checklist page's state breakdown
// and in the auditor history renderer. Thousands of stored checklists contain it and must keep
// rendering and scoring exactly as they always have — see leafState/computeContainerStatus below,
// which still READ it. Era redaction (`applicable === false`) rides the same exclusion mechanics
// and is a different thing entirely from the auditor's old N/A; it is untouched too.

export function buildStoredGroups(def: ChecklistTemplateDefinition, answers: AnswerMap) {
  return def.groups.map((g) => ({
    groupId: g.code,
    groupName: groupDisplayName(g),
    items: g.items.map((it) => buildNode(it, answers)),
  }))
}

export interface CategorySummaryGroup {
  groupId: string
  groupName: string
  metrics: FacilityMetrics
}

export interface CategorySummary {
  value: string
  label: string
  metrics: FacilityMetrics
  groups: CategorySummaryGroup[]
}

// Part B (auditor self-unsubmit/summary session) — groups a submitted checklist's stored items
// (buildStoredGroups' own output shape: {groupId, groupName, items}[]) by category (A/B/C — the
// same `groupId[0]` rule categoryLabel/the navigator's grouping already uses, since groupId IS the
// stored group's template code, e.g. "A1" for v1 or "A" for v2/v3's own top-level group). Every
// number comes from computeFacilityMetrics called on SLICES of the exact same items array the
// checklist's stored score was computed from — never a second pass-counting path, so these can
// never drift from it, and redacted (applicable===false) / hidden (never stored) / optional-group
// items are excluded from every denominator exactly as computeFacilityMetrics already excludes
// them everywhere else.
//
// v1 stores many small groups per category (A1, A2, A3…), so `groups` lists a real per-group
// breakdown; v2/v3 stores exactly ONE group per category (its own top-level group already IS the
// category), so `groups` there holds that single entry — callers should skip rendering it when
// length is 1, since it would just duplicate the category's own `metrics` on its own row.
export function groupSummaryByCategory(
  items: { groupId?: string; groupName?: string }[],
  templateDef?: ChecklistTemplateDefinition,
): CategorySummary[] {
  return CHECKLIST_CATEGORIES.map((cat) => {
    const groupsInCat = items.filter((g) => (g.groupId ?? '')[0] === cat.value)
    return {
      value: cat.value,
      label: cat.label,
      metrics: computeFacilityMetrics(groupsInCat, templateDef),
      groups: groupsInCat.map((g) => ({
        groupId: g.groupId ?? '',
        groupName: g.groupName ?? '',
        metrics: computeFacilityMetrics([g], templateDef),
      })),
    }
  }).filter((cat) => cat.groups.length > 0)
}

// ── Pager + navigator construction — shared between /audit's editable pager and the my-work
// read-only review, so there is one pagination scheme, not two independently-built ones. ──

// Session S4a, Part D.2 — the navigator's top-level category (A/B/C), derived from a page's own
// leading code letter: v1 groups use the exact same A1/A2/B1.../C1 code scheme as v3's containers
// (see apps/api/prisma/v1-template-groups.ts), so the same leading-letter grouping applies to both.
export function categoryLabel(code: string): { groupKey: string; groupLabel: string } {
  const letter = code[0] ?? code
  return { groupKey: letter, groupLabel: CHECKLIST_CATEGORIES.find((c) => c.value === letter)?.label ?? letter }
}

// Live feedback follow-up — the navigator's third (leaf-preview + search) tier, built as a REAL
// tree (not flattened to only the deepest leaves): a page's preview holds exactly its own direct
// children, and if one of those itself has subItems (e.g. a tiered measurement), THEY nest one
// level deeper under it, not merged flat into the parent's own list. v1 group items typically
// have no subItems (so they render as leaves with no further nesting); v2/v3 top-level items can
// nest arbitrarily — same TemplateNode shape for both (ChecklistTemplateGroupDef.items and
// TemplateNode.subItems are both TemplateNode[]), so one function covers both.
export function collectLeafPreview(nodes: TemplateNode[]): NavigatorLeafPreview[] {
  return nodes.map((n) => ({
    code: n.code,
    labelTh: n.labelTh,
    children: n.subItems && n.subItems.length > 0 ? collectLeafPreview(n.subItems) : undefined,
  }))
}

// One entry per PAGE, v1 = group-level, v2 = item-level, matching each pager's own granularity —
// see buildV2Pages below for how v2Pages itself is built. Progress figures reuse
// countProgressForNodes, the exact same tally every progress display in this app already uses, so
// the navigator can never disagree with them.
export function buildNavPages(
  groups: ChecklistTemplateGroupDef[],
  isV1: boolean,
  v2Pages: { group: ChecklistTemplateGroupDef; item: TemplateNode }[],
  answers: AnswerMap,
): NavigatorPage[] {
  return isV1
    ? groups.map((g) => {
        const p = countProgressForNodes(g.items, answers)
        return {
          code: g.code, label: groupDisplayName(g), answered: p.answered, total: p.total,
          leafItems: collectLeafPreview(g.items),
          ...categoryLabel(g.code),
        }
      })
    : v2Pages.map(({ group, item }) => {
        const p = countProgressForNodes([item], answers)
        return {
          code: item.code,
          label: item.num ? `${item.num}. ${item.labelTh}` : item.labelTh,
          sublabel: groupDisplayName(group),
          answered: p.answered,
          total: p.total,
          leafItems: item.subItems && item.subItems.length > 0 ? collectLeafPreview(item.subItems) : undefined,
          ...categoryLabel(group.code),
        }
      })
}

// v2/v3's pager is one level deeper than v1's: v1 paginates group-by-group; v2 paginates
// item-by-item within a group (A1 → A1.1, A1.2, …), continuing seamlessly into the next group's
// first item — see V2PagerForm.tsx for what renders inside one item's page. A top-level item
// that's fully era-redacted (itself, or every descendant when it's a pure container) never gets
// its own page.
export function buildV2Pages(groups: ChecklistTemplateGroupDef[]): { group: ChecklistTemplateGroupDef; item: TemplateNode }[] {
  return groups.flatMap((g) => g.items.filter((item) => !isNodeFullyRedacted(item)).map((item) => ({ group: g, item })))
}
