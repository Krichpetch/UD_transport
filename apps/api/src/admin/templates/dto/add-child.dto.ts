import { IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { EditMeasurementDto } from './edit-measurement.dto'

// Session S3b, Part C.4 — "เพิ่มข้อย่อย". `code` is deliberately absent: the server always
// auto-assigns it, append-only per parent (see templates.core.ts#addChildNode) — there is no way
// to request a specific code through this DTO, by design.
export class AddChildDto {
  @IsString() labelTh: string
  @IsIn(['presence', 'presence_standard', 'measured']) type: 'presence' | 'presence_standard' | 'measured'
  @IsOptional() @ValidateNested() @Type(() => EditMeasurementDto) threshold?: EditMeasurementDto
  @IsOptional() @IsArray() @IsString({ each: true }) lawRefs?: string[]
}
