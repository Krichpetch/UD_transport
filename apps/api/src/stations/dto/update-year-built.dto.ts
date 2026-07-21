import { IsInt } from 'class-validator'

// E-form redesign (Session E2, Part A) — the sanity range itself (2400..current+1) is enforced in
// StationsService.updateYearBuilt via @repo/types#isValidYearBuilt, not here: the upper bound is
// relative to "now", which a static class-validator decorator can't express.
export class UpdateYearBuiltDto {
  @IsInt() yearBuilt: number
}
