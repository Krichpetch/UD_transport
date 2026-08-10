import { IsIn, IsOptional, IsString } from 'class-validator'

// Session S4b, Part 2.2 — the two allowed resolutions for one canonical-item conflict. 'winner'
// requires the exact `signature` string from the conflict list's `variants[]` (echoed back — see
// facility-grouping.core.ts#ItemConflict) so the admin's choice is unambiguous even if the
// underlying data description is long; the service re-validates it's still a live variant of this
// conflict before writing anything.
export class ResolveConflictDto {
  @IsIn(['winner', 'split']) resolution: 'winner' | 'split'
  @IsOptional() @IsString() winnerSignature?: string
  @IsOptional() @IsString() notes?: string
}
