import { IsString } from 'class-validator'

// Session S5, Part C.3 — attach a node to a master criterion, wholesale-overwriting the node's
// write-through values from the master's current state (no diff prompt). Used both for a node's
// FIRST attach (any unattached node, admin names the target masterId explicitly) and for D3's
// re-attach (a previously-detached node re-linking, typically to the same master it came from,
// found via its own detachedFromMasterId breadcrumb) — mechanically identical (see
// master-criteria.service.ts#attachToMaster's doc for why these were consolidated into one action).
export class AttachMasterDto {
  @IsString() masterId: string
}
