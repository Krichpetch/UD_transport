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
  // Exactly ONE of these two identifies the anchor — both come from GET /admin/template-groups.
  // A real anchor is not always nested inside another item: "เครื่องบริการถ่ายทอดการสื่อสารสาธารณะ
  // (TTRS)" (Fix 5's own anchor) is itself a top-level item directly under its GROUP, a peer of
  // other top-level items, so it surfaces as a `containerGroups[]` entry, not a `canonicalItems[]`
  // (leaf) entry. anchorItemId (a canonical/leaf item id) inserts as a sibling LEAF inside that
  // item's own container; anchorContainerGroupId (a container-group id) inserts as a sibling
  // TOP-LEVEL ITEM inside that container's own group.
  @IsOptional() @IsString() anchorItemId?: string
  @IsOptional() @IsString() anchorContainerGroupId?: string

  @IsIn(['before', 'after']) side: 'before' | 'after'

  @IsArray() @IsString({ each: true }) targetTemplateIds: string[]

  @ValidateNested() @Type(() => AddAndPlaceContentDto) content: AddAndPlaceContentDto

  @IsBoolean() confirm: boolean
}
