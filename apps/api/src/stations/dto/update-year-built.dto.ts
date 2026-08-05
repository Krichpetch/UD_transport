import { IsDateString, IsInt, IsOptional } from 'class-validator'

// E-form redesign (Session E2, Part A) — the sanity range itself (2400..current+1) is enforced in
// StationsService.updateYearBuilt via @repo/types#isValidYearBuilt, not here: the upper bound is
// relative to "now", which a static class-validator decorator can't express.
export class UpdateYearBuiltDto {
  @IsInt() yearBuilt: number

  // 2026-08-05 — exact building-permit-application date, ISO yyyy-mm-dd, GREGORIAN (native HTML
  // date input format). Optional refinement captured by the auditor when they can find one (e.g.
  // on a permit placard) — yearBuilt alone stays sufficient to start an audit. Server-side
  // validated for internal consistency against yearBuilt in StationsService.updateYearBuilt, not
  // here — same "range check needs runtime context" reasoning as yearBuilt's own bound above.
  @IsOptional() @IsDateString() yearBuiltDate?: string
}
