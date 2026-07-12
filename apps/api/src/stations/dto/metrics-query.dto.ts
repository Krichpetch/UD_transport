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
  // TODO(executive-dashboard): wire when มติครม. field lands on Station. Accepted so the
  // executive dashboard's timeframe/filter UI can send it forward-compatibly; the controller
  // rejects with 501 whenever this is actually sent, rather than silently ignoring it.
  @IsOptional() @IsBooleanString() cabinetApproved?: string
}
