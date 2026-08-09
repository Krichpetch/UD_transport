import { IsBoolean } from 'class-validator'

// Session S4a, Part C — hide/unhide a node from the auditor form entirely, any status.
export class EditHiddenDto {
  @IsBoolean() hidden: boolean
}
