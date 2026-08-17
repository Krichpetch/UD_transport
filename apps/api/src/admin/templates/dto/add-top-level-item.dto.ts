import { IsArray, IsIn, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { EditMeasurementDto } from './edit-measurement.dto'

// The individual-editor sibling of add-and-place (facility-groups.service.ts#addAndPlace,
// AddAndPlaceDto) — same "new item + position it relative to an anchor" shape, but writes to ONE
// template only, no multi-template fan-out. `containerCode` may be either a GROUP code (inserts
// into that group's top-level items, a sibling of e.g. TTRS) or an existing NODE code (inserts as
// a sibling under that node) — templates.core.ts#addPositionedChildNode already resolves both;
// `anchorCode` must be an existing item directly inside `containerCode` (a top-level item of the
// group, or a subItem of the node) since that's what fixes the insertion position. `code` is
// deliberately absent — always server-assigned, append-only (see addPositionedChildNode's doc);
// the resulting code reflects INSERTION ORDER, not visual position, so it will not generally match
// wherever `side`/`anchorCode` places it on screen.
export class AddTopLevelItemDto {
  @IsString() containerCode: string
  @IsString() anchorCode: string
  @IsIn(['before', 'after']) side: 'before' | 'after'
  @IsString() labelTh: string
  @IsIn(['presence', 'presence_standard', 'measured']) type: 'presence' | 'presence_standard' | 'measured'
  @IsOptional() @ValidateNested() @Type(() => EditMeasurementDto) threshold?: EditMeasurementDto
  @IsOptional() @IsArray() @IsString({ each: true }) lawRefs?: string[]
  // Optional facility-catalog code — when supplied, server-side resolves lawRefs (unless the
  // caller already supplied its own)/cabinetResolution/beyondLaw from FACILITY_CATALOG, the same
  // "choose from a facility template" derivation add-and-place already does.
  @IsOptional() @IsNumber() facilityCode?: number
}
