import { IsArray, IsBoolean, IsString } from 'class-validator'

// Live feedback (2026-08-17) — the symmetric counterpart to AddAndPlaceDto: remove a canonical
// item's instances from N chosen templates in one action, instead of opening each template's own
// individual editor to delete one at a time. Same preview -> confirm two-step (`confirm: false`
// resolves and reports without writing) and same per-target skip-with-reason convention.
export class DeleteGroupDto {
  // The canonical item's own id from GET /admin/template-groups (facility-grouping.core.ts's
  // CanonicalItem, any depth) — identifies WHICH group to delete, not any single instance's code.
  @IsString() canonicalItemId: string

  @IsArray() @IsString({ each: true }) targetTemplateIds: string[]

  @IsBoolean() confirm: boolean
}
