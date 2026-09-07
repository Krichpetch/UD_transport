import { IsBooleanString, IsIn, IsISO8601, IsOptional, IsString } from 'class-validator'
import { TRANSPORT_MODES, RAIL_SUBTYPES, RESPONSIBLE_AGENCIES } from '@repo/types'

export class MetricsQueryDto {
  @IsOptional() @IsIn(TRANSPORT_MODES) mode?: string
  @IsOptional() @IsIn(RAIL_SUBTYPES) railSubtype?: string
  @IsOptional() @IsString() region?: string
  @IsOptional() @IsString() province?: string
  @IsOptional() @IsIn(RESPONSIBLE_AGENCIES) responsibleAgency?: string
  @IsOptional() @IsString() subItem?: string
  @IsOptional() @IsISO8601() from?: string
  @IsOptional() @IsISO8601() to?: string
  // UDT-18 — 'true' scopes the aggregation to stations that "ผ่านมติ ครม.", computed on the fly
  // per request from each station's latest checklist (see
  // StationsService.cabinetApprovedIdsFromRows) — there is no denormalized Station column.
  @IsOptional() @IsBooleanString() cabinetApproved?: string
}
