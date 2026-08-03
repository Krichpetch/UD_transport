import { IsBoolean, IsIn, IsOptional } from 'class-validator'

// Session S3b, Part C.2 — the 3-way question type selector; see templates.core.ts#setNodeQuestionType
// for how 'measured' collapses onto the same answerType as 'presence_standard'.
export class SetQuestionTypeDto {
  @IsIn(['presence', 'presence_standard', 'measured']) type: 'presence' | 'presence_standard' | 'measured'
  // Required to proceed when the switch would silently discard existing measurement thresholds —
  // see the TemplateEditError thrown by setNodeQuestionType when this is missing/false.
  @IsOptional() @IsBoolean() confirmDowngrade?: boolean
}
