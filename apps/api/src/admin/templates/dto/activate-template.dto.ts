import { IsBoolean, IsOptional } from 'class-validator'

// force = re-submit after seeing the DRAFTS_AT_RISK warning from an unforced call — mirrors
// apps/api/prisma/activate-template.ts's --force flag (Guardrail 2 override).
export class ActivateTemplateDto {
  @IsOptional() @IsBoolean() force?: boolean
}
