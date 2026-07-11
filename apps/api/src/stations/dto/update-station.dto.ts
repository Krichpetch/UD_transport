import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator'
import { TRANSPORT_MODES, RAIL_SUBTYPES, RESPONSIBLE_AGENCIES } from '@repo/types'

// railSubtype also accepts '' — StationsService.update() treats a falsy railSubtype
// as "clear the subtype" (dto.railSubtype || null), so '' must stay valid here.
const RAIL_SUBTYPES_OR_CLEAR: readonly string[] = [...RAIL_SUBTYPES, '']

export class UpdateStationDto {
  @IsString() @IsOptional() nameTh?: string
  @IsIn(TRANSPORT_MODES) @IsOptional() mode?: string
  @IsIn(RAIL_SUBTYPES_OR_CLEAR) @IsOptional() railSubtype?: string
  @IsString() @IsOptional() province?: string
  @IsString() @IsOptional() region?: string
  @IsIn(RESPONSIBLE_AGENCIES) @IsOptional() responsibleAgency?: string
  @IsNumber() @IsOptional() lat?: number
  @IsNumber() @IsOptional() lng?: number
}
