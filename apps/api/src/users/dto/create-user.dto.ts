import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator'
import { RESPONSIBLE_AGENCIES } from '@repo/types'

export class CreateUserDto {
  @IsString() @MinLength(3) username: string
  @IsEmail() email: string
  @IsIn(['ADMIN', 'AUDITOR', 'EXECUTIVE', 'REVIEWER']) @IsOptional() role?: string
  // Manual-add: admin sets a password. Omit to have the server generate a temp one.
  @IsString() @MinLength(8) @IsOptional() password?: string
  @IsIn(RESPONSIBLE_AGENCIES) @IsOptional() agency?: string
  // UDT-53 — grant the "sys admin" bit (only meaningful with role ADMIN). Only a sys admin may
  // set this; the attempt is authorised in users.service.ts, not here.
  @IsBoolean() @IsOptional() isSuperAdmin?: boolean
}
