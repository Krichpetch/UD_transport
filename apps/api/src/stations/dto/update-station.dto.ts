import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator'

export class UpdateStationDto {
  @IsString() @IsOptional() nameTh?: string
  @IsIn(['ทางบก', 'ทางราง', 'ทางเรือ', 'ทางอากาศ']) @IsOptional() mode?: string
  @IsString() @IsOptional() railSubtype?: string
  @IsString() @IsOptional() province?: string
  @IsString() @IsOptional() region?: string
  @IsString() @IsOptional() responsibleAgency?: string
  @IsNumber() @IsOptional() lat?: number
  @IsNumber() @IsOptional() lng?: number
}
