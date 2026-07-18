// E-form redesign (Session E1, Part C) — the checklist submit/draft endpoints previously typed
// their @Body() as a plain TS interface (see git history of checklists.controller.ts), which the
// global ValidationPipe never runs class-validator against (it only validates class instances,
// not structural interfaces) — items/gps/score were effectively unvalidated at the HTTP boundary.
//
// Deep structural validation of `items` (array depth, known codes against the checklist's
// stamped template, answer values legal for each leaf's answerType, measured values numeric) is
// NOT duplicated here as a parallel tree of class-validator decorators — @repo/types'
// parseChecklistItems (Part B) already is that validator, and is the single source of truth for
// "what a well-formed items tree looks like." ChecklistsService calls it and turns a thrown
// ChecklistItemsParseError into a 400 naming the offending path/code (see checklists.service.ts).
// This DTO only covers the flat fields class-validator is a good fit for.
import { IsArray, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'

export class SubmitGpsDto {
  @IsNumber() @Min(-90) @Max(90) lat: number
  @IsNumber() @Min(-180) @Max(180) lng: number
  @IsOptional() @IsNumber() @Min(0) accuracy?: number
}

const FINAL_THOUGHTS_MAX_LENGTH = 4000

export class SaveDraftChecklistDto {
  @IsArray() items: object[]
}

export class SubmitChecklistDto {
  @IsArray() items: object[]
  @IsOptional() @IsNumber() score?: number
  @IsOptional() @ValidateNested() @Type(() => SubmitGpsDto) gps?: SubmitGpsDto
  @IsOptional() @IsString() @MaxLength(FINAL_THOUGHTS_MAX_LENGTH) finalThoughts?: string
}
