import { IsArray, IsBoolean, IsIn, IsNumber, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { TEMPLATE_ANSWER_TYPES, type TemplateAnswerType } from '@repo/types'

// Shallow at the DTO boundary, same convention as EditMeasurementDto — the real structural check
// happens when the value is first pushed onto a node (master-criteria.core.ts#pushMasterToInstance
// re-validates through parseTemplateDefinition).
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

// Session S5, Part D.1 — the master facility editor's create form. Deliberately no code/num/
// position (Part A: a master never carries them — those stay per-instance).
export class CreateMasterCriterionDto {
  @IsString() labelTh: string
  @IsOptional() @IsIn(TEMPLATE_ANSWER_TYPES) answerType?: TemplateAnswerType
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => MasterMeasurementDto) measurements?: MasterMeasurementDto[]
  @IsOptional() @IsObject() @ValidateNested() @Type(() => MasterGuidanceDto) guidance?: MasterGuidanceDto
  @IsOptional() @IsArray() @IsString({ each: true }) imageKeys?: string[]
  @IsOptional() @IsArray() @IsString({ each: true }) lawRefs?: string[]
  @IsOptional() @IsBoolean() cabinetResolution?: boolean
  @IsOptional() @IsBoolean() beyondLaw?: boolean
  @IsOptional() @IsNumber() facilityCode?: number
}
