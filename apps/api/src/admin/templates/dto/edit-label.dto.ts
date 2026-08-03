import { IsOptional, IsString } from 'class-validator'

// Session S3b, Part C follow-up — the question text itself. `code` is deliberately absent (stays
// server-assigned/append-only — see templates.core.ts#editNodeLabel's doc).
export class EditLabelDto {
  @IsString() labelTh: string
  @IsOptional() @IsString() num?: string
}
