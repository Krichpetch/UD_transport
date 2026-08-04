import { IsString, IsNumber, IsOptional, IsIn } from 'class-validator'
import { TRANSPORT_MODES, RAIL_SUBTYPES, RESPONSIBLE_AGENCIES } from '@repo/types'

export class CreateStationDto {
  @IsString() name: string
  @IsString() nameTh: string
  @IsIn(TRANSPORT_MODES) mode: string
  @IsIn(RAIL_SUBTYPES) @IsOptional() railSubtype?: string
  // Session F3, Part A.5 — line/route (สาย); part of the (mode, nameTh, line) identity key.
  // Omitted defaults to '' (the "no line" sentinel, never null — see schema.prisma Station.line).
  @IsString() @IsOptional() line?: string
  @IsString() province: string
  // Region is a derived attribute (see @repo/types#deriveRegion), not user input — StationsService
  // .create() computes it from lat/lng when omitted. Still acceptable explicitly for callers that
  // legitimately need to pin it (e.g. a scripted import correcting a bad derivation).
  @IsString() @IsOptional() region?: string
  @IsIn(RESPONSIBLE_AGENCIES) responsibleAgency: string
  @IsNumber() lat: number
  @IsNumber() lng: number
}
