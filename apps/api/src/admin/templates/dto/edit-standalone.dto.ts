import { IsBoolean } from 'class-validator'

// Session S4b-fix, Fix 4 — detach (true) / re-attach (false) a leaf from the facility-grouped
// editor's canonical pooling, any status.
export class EditStandaloneDto {
  @IsBoolean() standalone: boolean
}
