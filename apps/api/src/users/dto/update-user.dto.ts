import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator'
import { RESPONSIBLE_AGENCIES } from '@repo/types'

export class UpdateUserDto {
  @IsString() @MinLength(3) @IsOptional() username?: string
  @IsEmail() @IsOptional() email?: string
  @IsIn(['ADMIN', 'AUDITOR', 'EXECUTIVE', 'REVIEWER']) @IsOptional() role?: string
  @IsIn(RESPONSIBLE_AGENCIES) @IsOptional() agency?: string
}
