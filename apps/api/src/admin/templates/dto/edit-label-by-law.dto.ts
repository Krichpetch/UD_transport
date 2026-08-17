import { IsObject, IsOptional, IsString } from 'class-validator'

// Era-editor safety session, Part C — the labelByLaw sibling of EditEraDto. `entry: null` removes
// that law's override slice entirely (mirrors EditEraDto's own null-means-remove convention).
export class EditLabelByLawDto {
  @IsString() lawCode: string
  @IsOptional() @IsObject() entry?: { labelTh: string; sourceText?: string | null } | null
}
