import { IsIn, IsObject, IsOptional, IsString } from 'class-validator'

// Session S4b, Part 3.2 — one canonical-item edit, fanned out to every instance the grouping
// engine says shares it. `field` picks which of templates.core.ts's existing per-definition edit
// functions runs against EACH target row; the nested payload is deliberately shallow-typed here
// (like EditEraDto already is) — the real shape check is that same downstream function's
// parseTemplateDefinition call, run once per instance, so a malformed payload fails loudly on the
// first row rather than partially applying across a fan-out.
export type GroupedEditField = 'measurement' | 'guidance' | 'lawRefs' | 'hidden' | 'label' | 'era' | 'image'

export class GroupedEditDto {
  @IsIn(['measurement', 'guidance', 'lawRefs', 'hidden', 'label', 'era', 'image'])
  field: GroupedEditField

  // measurement | era only — which measurement slot on each instance's leaf to touch.
  @IsOptional() @IsString() measurementKey?: string

  @IsOptional() @IsObject() measurement?: {
    operator: 'gte' | 'lte' | 'range' | 'tiered'
    value?: number | null
    value2?: number | null
    tiers?: unknown[]
    unit: string
    autoGrade: boolean
    sourceText?: string
    note?: string
  }

  @IsOptional() @IsObject() guidance?: { text: string; reference?: string }

  @IsOptional() @IsObject() lawRefs?: { lawRefs: string[]; beyondLaw: boolean }

  @IsOptional() @IsObject() hidden?: { hidden: boolean }

  @IsOptional() @IsObject() label?: { labelTh: string; num?: string }

  @IsOptional() @IsObject() era?: {
    lawCode: string
    entry?: { value?: number | null; value2?: number | null; tiers?: unknown[]; sourceText?: string | null; labelTh?: string | null } | null
  }

  // image only — the MinIO key from a single prior upload (POST .../images/:nodeCode against ONE
  // instance), attached to (op:'add') or removed from (op:'remove') every instance via the same
  // addImageKey/removeImageKey core functions. Never re-uploads the file N times; propagation only
  // ever copies/drops the reference. addImageKey is idempotent on an already-attached key, so 'add'
  // is safe to fan out to ALL instances including the one the file was originally uploaded to.
  @IsOptional() @IsString() imageKey?: string
  @IsOptional() @IsIn(['add', 'remove']) imageOp?: 'add' | 'remove'
}
