import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsISO8601, IsOptional, IsString, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import type { ChecklistGroup } from '@repo/types'

class LegacyStationDto {
  @IsString() nameTh: string
  @IsString() mode: string
  @IsString() responsibleAgency: string
  @IsString() province: string
}

// items is deliberately `object[]` (shallow) rather than deeply validated — same convention as
// OtpRowDto, since the real structural check for a flat ChecklistGroup[] shape happens where
// computeScoreFromItems/scoreToStatus actually read it, not at the DTO boundary.
class LegacyChecklistRowDto {
  @IsString() sourceId: string
  @ValidateNested() @Type(() => LegacyStationDto) station: LegacyStationDto
  @IsString() auditorUsername: string
  @IsArray() items: ChecklistGroup[]
  @IsIn(['APPROVED', 'REJECTED', 'SUBMITTED']) status: 'APPROVED' | 'REJECTED' | 'SUBMITTED'
  @IsISO8601() @IsOptional() submittedAt?: string | null
  @IsISO8601() createdAt: string
  @IsISO8601() @IsOptional() reviewedAt?: string | null
  @IsString() @IsOptional() reviewNotes?: string | null
}

export class ReimportRowsDto {
  @IsArray() @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => LegacyChecklistRowDto) rows: LegacyChecklistRowDto[]
  @IsBoolean() @IsOptional() dryRun?: boolean
}
