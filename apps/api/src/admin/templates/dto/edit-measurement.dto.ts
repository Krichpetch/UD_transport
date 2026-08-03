import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'

// Shallow tier shape at the DTO boundary — same convention as ReimportRowsDto's `items:
// ChecklistGroup[]`: the real structural check happens downstream, in
// templates.core.ts#editMeasurementValue's call to parseTemplateDefinition, not here.
class TierDto {
  @IsNumber() min: number
  @IsOptional() max?: number | null
  @IsNumber() required: number
  @IsOptional() @IsNumber() incrementPer?: number
  @IsOptional() @IsNumber() incrementBy?: number
}

// Session S3b, Part C.3 — a brand-new tiered measurement needs its own `inputs` (the auditor's
// basis/provided entry fields); irrelevant to S3a's edit-existing-value path (an existing
// measurement's inputs never change), so this is optional and only meaningful when creating.
class MeasurementInputDto {
  @IsString() key: string
  @IsString() labelTh: string
}

export class EditMeasurementDto {
  @IsIn(['gte', 'lte', 'range', 'tiered']) operator: 'gte' | 'lte' | 'range' | 'tiered'
  @IsOptional() @IsNumber() value?: number | null
  @IsOptional() @IsNumber() value2?: number | null
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TierDto) tiers?: TierDto[]
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => MeasurementInputDto) inputs?: MeasurementInputDto[]
  @IsString() unit: string
  @IsBoolean() autoGrade: boolean
  @IsOptional() @IsString() sourceText?: string
  @IsOptional() @IsString() note?: string
}
