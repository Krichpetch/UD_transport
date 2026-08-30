import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator'
import { RESPONSIBLE_AGENCIES } from '@repo/types'

export class UpdateUserDto {
  @IsString() @MinLength(3) @IsOptional() username?: string
  @IsEmail() @IsOptional() email?: string
  @IsIn(['ADMIN', 'AUDITOR', 'EXECUTIVE', 'REVIEWER']) @IsOptional() role?: string
  @IsIn(RESPONSIBLE_AGENCIES) @IsOptional() agency?: string
  // UDT-53 — grant/revoke the "sys admin" bit. Only a sys admin may set this; authorised in
  // users.service.ts.
  @IsBoolean() @IsOptional() isSuperAdmin?: boolean
}
