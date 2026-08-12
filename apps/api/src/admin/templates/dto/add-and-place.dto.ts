import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { EditMeasurementDto } from './edit-measurement.dto'

// Session S4b-fix, Fix 3 — add-and-place: create one item and apply it to N templates at a chosen
// position in one call. `confirm: false` (the default a caller should use first) resolves and
// reports the target list WITHOUT writing anything — the frontend's "preview" step; `confirm: true`
// performs the writes. Mirrors GroupedEditDto's "shallow-typed nested payload, real shape check
// downstream" convention.
export class AddAndPlaceContentDto {
  @IsString() labelTh: string
  @IsIn(['presence', 'presence_standard', 'measured']) type: 'presence' | 'presence_standard' | 'measured'
  @IsOptional() @ValidateNested() @Type(() => EditMeasurementDto) threshold?: EditMeasurementDto
  @IsOptional() @IsArray() @IsString({ each: true }) lawRefs?: string[]
  @IsOptional() @IsInt() facilityCode?: number
}

export class AddAndPlaceDto {
  // Session S5-fix (round 2) — a single id into the unified recursive tree GET
  // /admin/template-groups now returns (facility-grouping.core.ts's CanonicalItem, any depth — a
  // leaf and a container are the same node type). "Insert before/after this node" resolves
  // identically regardless of depth: the node's own parentCode is always the code to splice into
  // (addPositionedChildNode already tries a group-code lookup before a node-code lookup), so a
  // depth-0 anchor (a top-level item like TTRS) and a deeper leaf/container anchor both just work
  // through the same field — no more "which kind of anchor is this" split.
  @IsString() anchorNodeId: string

  @IsIn(['before', 'after']) side: 'before' | 'after'

  @IsArray() @IsString({ each: true }) targetTemplateIds: string[]

  @ValidateNested() @Type(() => AddAndPlaceContentDto) content: AddAndPlaceContentDto

  @IsBoolean() confirm: boolean
}
