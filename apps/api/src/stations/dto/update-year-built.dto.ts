import { IsDateString, IsInt, IsOptional } from 'class-validator'

// E-form redesign (Session E2, Part A) — the sanity range itself (2400..current+1) is enforced in
// StationsService.updateYearBuilt via @repo/types#isValidYearBuilt, not here: the upper bound is
// relative to "now", which a static class-validator decorator can't express.
export class UpdateYearBuiltDto {
  @IsInt() yearBuilt: number

  // 2026-08-05, revised same day after PM review — building-permit-application MONTH, at
  // month/year precision only (day-of-month was never asked for; era resolution ignores it — see
  // @repo/types#isLawInForce). Sent as a full ISO yyyy-mm-dd string (day fixed to 01) so the
  // existing DATE column/validation need no schema change; GREGORIAN, from the auditor's native
  // HTML month input. Optional refinement captured when the auditor can find a permit record —
  // yearBuilt alone stays sufficient to start an audit. Server-side validated for internal
  // consistency against yearBuilt in StationsService.updateYearBuilt, not here — same "range check
  // needs runtime context" reasoning as yearBuilt's own bound above.
  @IsOptional() @IsDateString() yearBuiltDate?: string
}
