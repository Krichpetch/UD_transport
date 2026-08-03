import { IsArray, IsBoolean, IsString } from 'class-validator'

// Session S3b, Part D — editable on DRAFT AND ACTIVE (applicability data, not structure).
export class EditLawRefsDto {
  @IsArray() @IsString({ each: true }) lawRefs: string[]
  @IsBoolean() beyondLaw: boolean
}
