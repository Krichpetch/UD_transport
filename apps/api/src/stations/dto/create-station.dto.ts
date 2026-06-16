import { IsString, IsNumber, IsOptional, IsIn } from 'class-validator'

export class CreateStationDto {
  @IsString() name: string
  @IsString() nameTh: string
  @IsIn(['ทางบก', 'ทางราง', 'ทางเรือ', 'ทางอากาศ']) mode: string
  @IsString() @IsOptional() railSubtype?: string
  @IsString() province: string
  @IsString() region: string
  @IsString() responsibleAgency: string
  @IsNumber() lat: number
  @IsNumber() lng: number
}
