import { IsOptional, IsString } from 'class-validator'

export class EditGuidanceDto {
  @IsString() text: string
  @IsOptional() @IsString() reference?: string
}
