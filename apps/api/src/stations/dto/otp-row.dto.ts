import { IsArray, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'

class OtpStationDto {
  @IsString() nameTh: string
  @IsString() name: string
  @IsString() mode: string
  @IsString() @IsOptional() railSubtype?: string
  @IsString() province: string
  @IsString() region: string
  @IsString() responsibleAgency: string
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
  @IsArray() @ValidateNested({ each: true }) @Type(() => OtpRowDto) rows: OtpRowDto[]
}
