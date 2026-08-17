import { IsObject, IsOptional, IsString } from 'class-validator'

// `entry` is deliberately untyped/shallow here (like ReimportRowsDto's `items`) — the real shape
// check is templates.core.ts#editEraOverride's downstream parseTemplateDefinition call. `null`
// means "remove this law's override" (Part C.1); omitted is treated the same as null by the
// service (see TemplatesController.editEra).
export class EditEraDto {
  @IsString() lawCode: string
  @IsOptional() @IsObject() entry?: { value?: number | null; value2?: number | null; tiers?: unknown[]; sourceText?: string | null; labelTh?: string | null } | null
}
