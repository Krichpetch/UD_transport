import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator'

export class CreateUserDto {
  @IsString() @MinLength(3) username: string
  @IsEmail() email: string
  @IsIn(['ADMIN', 'AUDITOR', 'EXECUTIVE']) @IsOptional() role?: string
  // Manual-add: admin sets a password. Omit to have the server generate a temp one.
  @IsString() @MinLength(8) @IsOptional() password?: string
}
