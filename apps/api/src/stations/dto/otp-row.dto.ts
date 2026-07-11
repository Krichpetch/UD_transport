import { ArrayMaxSize, IsArray, IsIn, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { TRANSPORT_MODES, RAIL_SUBTYPES, RESPONSIBLE_AGENCIES } from '@repo/types'

class OtpStationDto {
  @IsString() nameTh: string
  @IsString() name: string
  @IsIn(TRANSPORT_MODES) mode: string
  @IsIn(RAIL_SUBTYPES) @IsOptional() railSubtype?: string
  @IsString() province: string
  @IsString() region: string
  @IsIn(RESPONSIBLE_AGENCIES) responsibleAgency: string
  @IsNumber() lat: number
  @IsNumber() lng: number
}

export class OtpRowDto {
  @ValidateNested() @Type(() => OtpStationDto) station: OtpStationDto
  @IsArray() items: object[]
  @IsNumber() score: number
  @IsString() status: string
  @IsString() lastInspected: string
}

export class BatchOtpDto {
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => OtpRowDto) rows: OtpRowDto[]
}
