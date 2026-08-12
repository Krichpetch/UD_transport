import { IsArray, IsBoolean, IsIn, IsNumber, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { TEMPLATE_ANSWER_TYPES, type TemplateAnswerType } from '@repo/types'

class MasterMeasurementDto {
  @IsIn(['gte', 'lte', 'range', 'tiered']) operator: 'gte' | 'lte' | 'range' | 'tiered'
  @IsString() key: string
  @IsOptional() @IsNumber() value?: number | null
  @IsOptional() @IsNumber() value2?: number | null
  @IsOptional() @IsArray() tiers?: unknown[]
  @IsOptional() @IsArray() inputs?: unknown[]
  @IsString() unit: string
  @IsBoolean() autoGrade: boolean
  @IsOptional() @IsString() sourceText?: string
  @IsOptional() @IsString() note?: string
}

class MasterGuidanceDto {
  @IsString() text: string
  @IsOptional() @IsString() reference?: string
}

// Session S5, Part D.1 — a partial patch: the admin sends only the field(s) they changed, same
// "per-field edit" spirit as the grouped editor's GroupedEditDto, without needing a separate
// endpoint per field (a master has 9 write-through fields, not 1-2 like a single measurement slot,
// so one flexible PATCH body is the simpler fit here — see master-criteria.service.ts's doc). Every
// field is independently optional; the service only touches fields actually present in the body
// (undefined = "leave as-is", never coerced to "clear"). No @nestjs/mapped-types dependency — this
// repo doesn't have it installed, so the fields are spelled out directly rather than derived via
// PartialType from CreateMasterCriterionDto.
export class EditMasterCriterionDto {
  @IsOptional() @IsString() labelTh?: string
  @IsOptional() @IsIn(TEMPLATE_ANSWER_TYPES) answerType?: TemplateAnswerType
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => MasterMeasurementDto) measurements?: MasterMeasurementDto[]
  @IsOptional() @IsObject() @ValidateNested() @Type(() => MasterGuidanceDto) guidance?: MasterGuidanceDto | null
  @IsOptional() @IsArray() @IsString({ each: true }) imageKeys?: string[]
  @IsOptional() @IsArray() @IsString({ each: true }) lawRefs?: string[]
  @IsOptional() @IsBoolean() cabinetResolution?: boolean
  @IsOptional() @IsBoolean() beyondLaw?: boolean
  @IsOptional() @IsNumber() facilityCode?: number
}
