import { IsString, IsNumber, IsOptional, IsIn } from 'class-validator'
import { TRANSPORT_MODES, RAIL_SUBTYPES, RESPONSIBLE_AGENCIES } from '@repo/types'

export class CreateStationDto {
  @IsString() name: string
  @IsString() nameTh: string
  @IsIn(TRANSPORT_MODES) mode: string
  @IsIn(RAIL_SUBTYPES) @IsOptional() railSubtype?: string
  @IsString() province: string
  @IsString() region: string
  @IsIn(RESPONSIBLE_AGENCIES) responsibleAgency: string
  @IsNumber() lat: number
  @IsNumber() lng: number
}
