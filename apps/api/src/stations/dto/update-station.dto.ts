import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator'
import { TRANSPORT_MODES, RAIL_SUBTYPES, RESPONSIBLE_AGENCIES } from '@repo/types'

// railSubtype also accepts '' — StationsService.update() treats a falsy railSubtype
// as "clear the subtype" (dto.railSubtype || null), so '' must stay valid here.
const RAIL_SUBTYPES_OR_CLEAR: readonly string[] = [...RAIL_SUBTYPES, '']

export class UpdateStationDto {
  @IsString() @IsOptional() nameTh?: string
  @IsIn(TRANSPORT_MODES) @IsOptional() mode?: string
  // Session F3, Part A.5 — line/route (สาย). Part of the (mode, nameTh, line) identity key, so
  // editing it can collide with an existing station: StationsService.update() catches the P2002
  // and reports which station it clashed with. '' is a legitimate value (the "no line" sentinel,
  // never null — see schema.prisma Station.line), so no @IsNotEmpty here.
  @IsString() @IsOptional() line?: string
  @IsIn(RAIL_SUBTYPES_OR_CLEAR) @IsOptional() railSubtype?: string
  @IsString() @IsOptional() province?: string
  @IsString() @IsOptional() region?: string
  @IsIn(RESPONSIBLE_AGENCIES) @IsOptional() responsibleAgency?: string
  @IsNumber() @IsOptional() lat?: number
  @IsNumber() @IsOptional() lng?: number
}
