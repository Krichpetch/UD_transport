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

export class EditMeasurementDto {
  @IsIn(['gte', 'lte', 'range', 'tiered']) operator: 'gte' | 'lte' | 'range' | 'tiered'
  @IsOptional() @IsNumber() value?: number | null
  @IsOptional() @IsNumber() value2?: number | null
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => TierDto) tiers?: TierDto[]
  @IsString() unit: string
  @IsBoolean() autoGrade: boolean
  @IsOptional() @IsString() sourceText?: string
  @IsOptional() @IsString() note?: string
}
