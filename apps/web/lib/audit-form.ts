// E-form redesign (Session E2, Parts B/C/D) — pure conversion functions between a
// ChecklistTemplateDefinition (the FORM, keyed by `code`) and the flat answer map the Zustand
// audit-form store holds (keyed by the same `code`, which doubles as StoredChecklistNode.id on
// the wire). Kept framework-free and side-effect-free so it's trivially testable and reusable
// from both the store and any read-only preview.
import type {
  ChecklistTemplateDefinition,
  TemplateNode,
  ChecklistPhoto,
  ChecklistValue,
} from '@repo/types'

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
    if (node.answerType) {
      total++
      if (isLeafAnswered(node, answers[node.code])) answered++
    }
    node.subItems?.forEach(visit)
  }
  nodes.forEach(visit)
  return { answered, total }
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

export function buildStoredGroups(def: ChecklistTemplateDefinition, answers: AnswerMap) {
  return def.groups.map((g) => ({
    groupId: g.code,
    groupName: groupDisplayName(g),
    items: g.items.map((it) => buildNode(it, answers)),
  }))
}
