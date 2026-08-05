// E-form redesign (Session E1, Parts A.3 / A2.4 / A.4) — seeds:
//   1. LawReference rows (Part A2.1)
//   2. 4 v1 ACTIVE ChecklistTemplate rows — converted from V1_TEMPLATE_GROUPS (today's in-code
//      form, see that file's header), item-for-item / code-for-code identical to the live form.
//   3. 4 v2 DRAFT ChecklistTemplate rows — apps/docs/Checklist_Utils/template_*_v2.json loaded
//      VERBATIM (not restructured/renumbered), validated against @repo/types' runtime validator.
//   4. Best-effort facility-catalog tagging (facilityCode/lawRefs/cabinetResolution/beyondLaw) on
//      every leaf of both v1 and v2 templates, by name-matching against FACILITY_CATALOG. Items
//      with no confident match are left untagged (facilityCode absent) — never force-matched.
//   5. Backfill: every pre-existing Checklist row with templateId IS NULL is stamped to its
//      station's mode's v1 ACTIVE template (id + version). New checklists created after this
//      script has run stamp the ACTIVE template themselves at creation time (see
//      ChecklistsService.submit/saveDraft) — this script only fixes up rows that predate that.
//
// Idempotent: safe to re-run (upserts by the (mode, variantKey, version) unique key and by
// LawReference.code; the backfill only touches rows where templateId IS NULL).
//
// Run after `prisma migrate deploy` has created the ChecklistTemplate/LawReference tables:
//   npx ts-node prisma/seed-templates.ts

import { PrismaClient, Prisma } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'
import {
  parseTemplateDefinition,
  applyEraOverrides,
  RAIL_TRAIN_VARIANT_KEY,
  RAIL_METRO_VARIANT_KEY,
  STANDARD_VARIANT_KEY,
  type ChecklistTemplateDefinition,
  type ChecklistTemplateGroupDef,
  type TemplateNode,
  FACILITY_CATALOG,
  LAW_REFERENCE_SEED,
  OPTIONAL_GROUP_CODES,
} from '@repo/types'
import { V1_TEMPLATE_GROUPS } from './v1-template-groups'

const prisma = new PrismaClient()

const MODES = ['ทางบก', 'ทางราง', 'ทางน้ำ', 'ทางอากาศ'] as const
type Mode = typeof MODES[number]

// Session E3, Part A — per-mode v2 DRAFT variant(s). Every mode but rail has exactly one variant
// ('standard'), keeping its pre-existing filename unchanged. Rail now has two: `rail_train`'s file
// is the same template_rail_v2.json seeded since Session E1/E2 (DECISION: that workbook IS the
// รถไฟ checklist) — no rename, so re-running this script against the migrated DB row still matches
// by (mode, variantKey, version). `rail_metro`'s workbook has not been delivered yet; its entry
// follows the template_{mode}_{variant}_v2.json / era_overrides_{mode}_{variant}.json convention
// for whenever it arrives — a missing file is a logged no-op, not an error (see the main loop).
interface VariantFiles { variantKey: string; file: string; overridesFile?: string }
const V2_VARIANTS: Record<Mode, VariantFiles[]> = {
  ทางบก:    [{ variantKey: STANDARD_VARIANT_KEY, file: 'template_land_v2.json',  overridesFile: 'era_overrides_land.json' }],
  ทางราง:   [
    { variantKey: RAIL_TRAIN_VARIANT_KEY, file: 'template_rail_v2.json', overridesFile: 'era_overrides_rail.json' },
    { variantKey: RAIL_METRO_VARIANT_KEY, file: 'template_rail_rail_metro_v2.json', overridesFile: 'era_overrides_rail_rail_metro.json' },
  ],
  ทางน้ำ:   [{ variantKey: STANDARD_VARIANT_KEY, file: 'template_water_v2.json', overridesFile: 'era_overrides_water.json' }],
  ทางอากาศ: [{ variantKey: STANDARD_VARIANT_KEY, file: 'template_air_v2.json',   overridesFile: 'era_overrides_air.json' }],
}

// v3-migration-cutover — candidate templates from the checklist-migration pipeline
// (tools/checklist-migration/).
//
// Session F3, Part G — era overrides ARE applied here now, exactly as in the v2 loop above. They
// previously were not, because applyEraOverrides() cannot read the migration pipeline's CANDIDATE
// file shape (per-law raw numbers keyed by leaf code) — that gap is now closed by an explicit
// converter, tools/checklist-migration/era_overrides_convert.py, which turns a candidate file
// into the `{ overrides: { code: { measurements: [...] } } }` shape this loop merges. Regenerate
// the files named below with that script; never hand-edit them.
const V3_VARIANTS: Record<Mode, VariantFiles[]> = {
  ทางบก:    [{ variantKey: STANDARD_VARIANT_KEY, file: 'template_land_v3.json', overridesFile: 'era_overrides_land_v3.json' }],
  ทางราง:   [
    { variantKey: RAIL_TRAIN_VARIANT_KEY, file: 'template_rail_rail_train_v3.json', overridesFile: 'era_overrides_rail_rail_train_v3.json' },
    { variantKey: RAIL_METRO_VARIANT_KEY, file: 'template_rail_rail_metro_v3.json', overridesFile: 'era_overrides_rail_rail_metro_v3.json' },
  ],
  ทางน้ำ:   [{ variantKey: STANDARD_VARIANT_KEY, file: 'template_water_v3.json', overridesFile: 'era_overrides_water_v3.json' }],
  ทางอากาศ: [{ variantKey: STANDARD_VARIANT_KEY, file: 'template_air_v3.json', overridesFile: 'era_overrides_air_v3.json' }],
}

// tools/checklist_json/ is the real current home for these seed JSONs — moved here (from the
// original apps/docs/Checklist_Utils) by two prior refactors (commits c86e0c6, 66e3339). This
// path previously still pointed at apps/docs/Checklist_Utils, which no longer exists — every
// v2 file lookup was silently hitting the "missing file, skip" branch below. Fixed here.
const TEMPLATE_JSON_DIR = path.resolve(__dirname, '..', '..', '..', 'tools', 'checklist_json')

// ---- facility-catalog name matching (Part A2.4) --------------------------------------------

function normalize(s: string): string {
  return s.replace(/[（(][^)）]*[)）]/g, '').replace(/\s+/g, ' ').trim()
}

interface FacilityMatch { code: number; matchedText: string }

function matchFacility(labelTh: string): FacilityMatch | null {
  const normLabel = normalize(labelTh)
  let best: (FacilityMatch & { length: number }) | null = null
  for (const entry of FACILITY_CATALOG) {
    const alternatives = normalize(entry.nameTh).split('/').map(s => s.trim()).filter(s => s.length >= 4)
    for (const alt of alternatives) {
      const isMatch = normLabel === alt || normLabel.includes(alt) || alt.includes(normLabel)
      if (isMatch && (!best || alt.length > best.length)) {
        best = { code: entry.code, matchedText: alt, length: alt.length }
      }
    }
  }
  return best ? { code: best.code, matchedText: best.matchedText } : null
}

interface TagStats { total: number; tagged: number; unmatched: string[] }

function tagLeaves(def: ChecklistTemplateDefinition): TagStats {
  const stats: TagStats = { total: 0, tagged: 0, unmatched: [] }
  const visit = (node: TemplateNode) => {
    if (node.subItems && node.subItems.length > 0) {
      for (const child of node.subItems) visit(child)
      return
    }
    stats.total++
    const match = matchFacility(node.labelTh)
    if (!match) { stats.unmatched.push(node.labelTh); return }
    stats.tagged++
    const catalogEntry = FACILITY_CATALOG.find(e => e.code === match.code)!
    node.facilityCode = catalogEntry.code
    node.lawRefs = [...catalogEntry.lawRefs]
    if (catalogEntry.cabinetResolution) node.cabinetResolution = true
    if (catalogEntry.beyondLaw) node.beyondLaw = true
  }
  for (const g of def.groups) for (const item of g.items) visit(item)
  return stats
}

// ---- 2026-08-05 — container-level facility-catalog tagging (all 5 modes) -------------------
//
// Cross-mode comparison report (2026-08-05, tools/checklist_json/template_*_v3.json diff) found
// tagLeaves' per-leaf matching to be the root cause of the water-checklist byLaw/lawRefs bug: two
// sibling leaves under the SAME facility container could independently match (or fail to match)
// different catalog entries, so they could disagree about which laws gate them. Re-running the
// SAME matcher one level up — against the CONTAINER (the node directly under a group, e.g.
// 'A1.1') instead of each leaf — resolves 220/291 containers automatically and, critically, makes
// that disagreement structurally impossible: every leaf under a resolved container is stamped
// from the SAME facility entry, never independently re-matched.
//
// Piloted on rail_metro alone first (2026-08-05, explicit user decision: "fixing one mode first"),
// then extended to the remaining 4 modes same day once the mechanism was verified. Every v3
// mode/variant now calls tagContainers(); tagLeaves() itself is untouched and still backs the v1/v2
// loops, and is also tagContainers' own fallback for any container below that isn't decided yet.
interface ContainerFacilityOverride {
  facilityCode?: number  // omit alongside beyondLaw:true for a genuine beyond-law addition
  beyondLaw?: true
}

// Keyed by `${mode}:${variantKey}:${containerCode}`. Each entry is a container the automated
// matcher (matchFacility, same substring logic as tagLeaves) can't resolve on its own, decided by
// the user from the report's §03 "71 containers to map" table — applied as given ("session 3 can
// be let through without any changes"). Grouped by mode below for readability; rail carries both
// the rail_train and rail_metro variants under the one ทางราง mode.
function facilityKey(mode: string, variantKey: string, containerCode: string): string {
  return `${mode}:${variantKey}:${containerCode}`
}
const LAND_MODE = 'ทางบก'
const WATER_MODE = 'ทางน้ำ'
const AIR_MODE = 'ทางอากาศ'
const RAIL_MODE = 'ทางราง'

const CONTAINER_FACILITY_OVERRIDES: Record<string, ContainerFacilityOverride> = {
  // ---- ทางบก (land, standard) ----
  [facilityKey(LAND_MODE, STANDARD_VARIANT_KEY, 'A2.3')]:  { facilityCode: 4 },   // บันได
  [facilityKey(LAND_MODE, STANDARD_VARIANT_KEY, 'B4.1')]:  { facilityCode: 4 },
  [facilityKey(LAND_MODE, STANDARD_VARIANT_KEY, 'B3.1')]:  { facilityCode: 10 },  // ลิฟต์
  [facilityKey(LAND_MODE, STANDARD_VARIANT_KEY, 'B1.6')]:  { facilityCode: 2 },   // ที่นั่งสำหรับคนพิการ
  [facilityKey(LAND_MODE, STANDARD_VARIANT_KEY, 'B6.1')]:  { facilityCode: 2 },
  [facilityKey(LAND_MODE, STANDARD_VARIANT_KEY, 'B1.7')]:  { facilityCode: 2 },   // พื้นที่จอดรถเข็น
  [facilityKey(LAND_MODE, STANDARD_VARIANT_KEY, 'B6.2')]:  { facilityCode: 2 },
  [facilityKey(LAND_MODE, STANDARD_VARIANT_KEY, 'B1.3')]:  { facilityCode: 16 },  // สถานีที่ติดต่อประชาสัมพันธ์
  [facilityKey(LAND_MODE, STANDARD_VARIANT_KEY, 'B1.18')]: { facilityCode: 33 },  // TTRS
  [facilityKey(LAND_MODE, STANDARD_VARIANT_KEY, 'B2.3')]:  { facilityCode: 32 },  // ที่เปลี่ยนผ้าอ้อมสำหรับเด็ก
  [facilityKey(LAND_MODE, STANDARD_VARIANT_KEY, 'B5.1')]:  { facilityCode: 13 },  // พื้นที่หนีภัย/หลบภัยของคนพิการ
  [facilityKey(LAND_MODE, STANDARD_VARIANT_KEY, 'C1.1')]:  { facilityCode: 19 },  // คู่มือการให้ความช่วยเหลือฯ
  [facilityKey(LAND_MODE, STANDARD_VARIANT_KEY, 'C2.1')]:  { facilityCode: 21 },  // เจ้าหน้าที่ผ่านการฝึกอบรมฯ
  [facilityKey(LAND_MODE, STANDARD_VARIANT_KEY, 'A2.8')]:  { facilityCode: 12 },  // จุดจอดรับ-ส่งคนพิการ
  [facilityKey(LAND_MODE, STANDARD_VARIANT_KEY, 'A2.9')]:  { beyondLaw: true },   // หลังคาป้องกันแดดและฝน

  // ---- ทางน้ำ (water, standard) ----
  [facilityKey(WATER_MODE, STANDARD_VARIANT_KEY, 'B3.1')]: { facilityCode: 2 },   // ที่นั่งสำหรับคนพิการ
  [facilityKey(WATER_MODE, STANDARD_VARIANT_KEY, 'B3.2')]: { facilityCode: 2 },   // พื้นที่จอดรถเข็น
  [facilityKey(WATER_MODE, STANDARD_VARIANT_KEY, 'B2.2')]: { facilityCode: 16 },  // สถานีที่ติดต่อประชาสัมพันธ์
  [facilityKey(WATER_MODE, STANDARD_VARIANT_KEY, 'B4.2')]: { beyondLaw: true },   // หลังคาป้องกันแดดและฝน
  [facilityKey(WATER_MODE, STANDARD_VARIANT_KEY, 'C1.1')]: { facilityCode: 19 },  // คู่มือการให้ความช่วยเหลือฯ
  [facilityKey(WATER_MODE, STANDARD_VARIANT_KEY, 'C2.1')]: { facilityCode: 21 },  // เจ้าหน้าที่ผ่านการฝึกอบรมฯ

  // ---- ทางอากาศ (air, standard) ----
  [facilityKey(AIR_MODE, STANDARD_VARIANT_KEY, 'A2.5')]:  { facilityCode: 4 },   // บันได
  [facilityKey(AIR_MODE, STANDARD_VARIANT_KEY, 'B6.1')]:  { facilityCode: 4 },
  [facilityKey(AIR_MODE, STANDARD_VARIANT_KEY, 'B1.6')]:  { facilityCode: 4 },   // บันได...ราวจับบนทางราบ
  [facilityKey(AIR_MODE, STANDARD_VARIANT_KEY, 'B5.1')]:  { facilityCode: 10 },  // ลิฟต์
  [facilityKey(AIR_MODE, STANDARD_VARIANT_KEY, 'B2.8')]:  { facilityCode: 2 },   // ที่นั่งสำหรับคนพิการ
  [facilityKey(AIR_MODE, STANDARD_VARIANT_KEY, 'B3.1')]:  { facilityCode: 2 },
  [facilityKey(AIR_MODE, STANDARD_VARIANT_KEY, 'B2.9')]:  { facilityCode: 2 },   // พื้นที่จอดรถเข็น
  [facilityKey(AIR_MODE, STANDARD_VARIANT_KEY, 'B3.2')]:  { facilityCode: 2 },
  [facilityKey(AIR_MODE, STANDARD_VARIANT_KEY, 'B2.1')]:  { facilityCode: 16 },  // สถานีที่ติดต่อประชาสัมพันธ์
  [facilityKey(AIR_MODE, STANDARD_VARIANT_KEY, 'B2.2')]:  { facilityCode: 16 },  // จุดบริการให้ข้อมูลการเดินทาง
  [facilityKey(AIR_MODE, STANDARD_VARIANT_KEY, 'B3.11')]: { facilityCode: 33 },  // TTRS
  [facilityKey(AIR_MODE, STANDARD_VARIANT_KEY, 'B4.3')]:  { facilityCode: 32 },  // ที่เปลี่ยนผ้าอ้อมสำหรับเด็ก
  [facilityKey(AIR_MODE, STANDARD_VARIANT_KEY, 'B7.1')]:  { facilityCode: 13 },  // พื้นที่หนีภัย/หลบภัยของคนพิการ
  [facilityKey(AIR_MODE, STANDARD_VARIANT_KEY, 'C1.1')]:  { facilityCode: 19 },  // คู่มือการให้ความช่วยเหลือฯ
  [facilityKey(AIR_MODE, STANDARD_VARIANT_KEY, 'C2.1')]:  { facilityCode: 21 },  // เจ้าหน้าที่ผ่านการฝึกอบรมฯ
  [facilityKey(AIR_MODE, STANDARD_VARIANT_KEY, 'A2.8')]:  { facilityCode: 12 },  // จุดจอดรับ-ส่งคนพิการ
  [facilityKey(AIR_MODE, STANDARD_VARIANT_KEY, 'A2.9')]:  { beyondLaw: true },   // หลังคาป้องกันแดดและฝน
  [facilityKey(AIR_MODE, STANDARD_VARIANT_KEY, 'B2.4')]:  { facilityCode: 6 },   // เคาน์เตอร์เช็คอิน (report flagged "6, or a new code" — 6 chosen)

  // ---- ทางราง / rail_train ----
  [facilityKey(RAIL_MODE, RAIL_TRAIN_VARIANT_KEY, 'A2.3')]:  { facilityCode: 4 },   // บันได
  [facilityKey(RAIL_MODE, RAIL_TRAIN_VARIANT_KEY, 'B5.1')]:  { facilityCode: 4 },
  [facilityKey(RAIL_MODE, RAIL_TRAIN_VARIANT_KEY, 'B4.1')]:  { facilityCode: 10 },  // ลิฟต์
  [facilityKey(RAIL_MODE, RAIL_TRAIN_VARIANT_KEY, 'B2.5')]:  { facilityCode: 2 },   // ที่นั่งสำหรับคนพิการ
  [facilityKey(RAIL_MODE, RAIL_TRAIN_VARIANT_KEY, 'B7.1')]:  { facilityCode: 2 },
  [facilityKey(RAIL_MODE, RAIL_TRAIN_VARIANT_KEY, 'B2.6')]:  { facilityCode: 2 },   // พื้นที่จอดรถเข็น
  [facilityKey(RAIL_MODE, RAIL_TRAIN_VARIANT_KEY, 'B7.2')]:  { facilityCode: 2 },
  [facilityKey(RAIL_MODE, RAIL_TRAIN_VARIANT_KEY, 'B2.2')]:  { facilityCode: 16 },  // สถานีที่ติดต่อประชาสัมพันธ์
  [facilityKey(RAIL_MODE, RAIL_TRAIN_VARIANT_KEY, 'B2.17')]: { facilityCode: 33 },  // TTRS
  [facilityKey(RAIL_MODE, RAIL_TRAIN_VARIANT_KEY, 'B3.3')]:  { facilityCode: 32 },  // ที่เปลี่ยนผ้าอ้อมสำหรับเด็ก
  [facilityKey(RAIL_MODE, RAIL_TRAIN_VARIANT_KEY, 'B6.1')]:  { facilityCode: 13 },  // พื้นที่หนีภัย/หลบภัยของคนพิการ
  [facilityKey(RAIL_MODE, RAIL_TRAIN_VARIANT_KEY, 'C1.1')]:  { facilityCode: 19 },  // คู่มือการให้ความช่วยเหลือฯ
  [facilityKey(RAIL_MODE, RAIL_TRAIN_VARIANT_KEY, 'C2.1')]:  { facilityCode: 21 },  // เจ้าหน้าที่ผ่านการฝึกอบรมฯ
  [facilityKey(RAIL_MODE, RAIL_TRAIN_VARIANT_KEY, 'A2.8')]:  { facilityCode: 12 },  // จุดจอดรับ-ส่งคนพิการ
  [facilityKey(RAIL_MODE, RAIL_TRAIN_VARIANT_KEY, 'A2.9')]:  { beyondLaw: true },   // หลังคาป้องกันแดดและฝน

  // ---- ทางราง / rail_metro ----
  [facilityKey(RAIL_MODE, RAIL_METRO_VARIANT_KEY, 'A2.3')]:  { facilityCode: 4 },   // บันได
  [facilityKey(RAIL_MODE, RAIL_METRO_VARIANT_KEY, 'A3.2')]:  { facilityCode: 4 },
  [facilityKey(RAIL_MODE, RAIL_METRO_VARIANT_KEY, 'B5.1')]:  { facilityCode: 4 },
  [facilityKey(RAIL_MODE, RAIL_METRO_VARIANT_KEY, 'A3.1')]:  { facilityCode: 10 },  // ลิฟต์
  [facilityKey(RAIL_MODE, RAIL_METRO_VARIANT_KEY, 'B4.1')]:  { facilityCode: 10 },
  [facilityKey(RAIL_MODE, RAIL_METRO_VARIANT_KEY, 'B2.6')]:  { facilityCode: 2 },   // ที่นั่งสำหรับคนพิการ
  [facilityKey(RAIL_MODE, RAIL_METRO_VARIANT_KEY, 'B7.1')]:  { facilityCode: 2 },
  [facilityKey(RAIL_MODE, RAIL_METRO_VARIANT_KEY, 'B2.7')]:  { facilityCode: 2 },   // พื้นที่จอดรถเข็น
  [facilityKey(RAIL_MODE, RAIL_METRO_VARIANT_KEY, 'B7.2')]:  { facilityCode: 2 },
  [facilityKey(RAIL_MODE, RAIL_METRO_VARIANT_KEY, 'B2.3')]:  { facilityCode: 16 },  // สถานีที่ติดต่อประชาสัมพันธ์
  [facilityKey(RAIL_MODE, RAIL_METRO_VARIANT_KEY, 'B2.18')]: { facilityCode: 33 },  // TTRS
  [facilityKey(RAIL_MODE, RAIL_METRO_VARIANT_KEY, 'B3.3')]:  { facilityCode: 32 },  // ที่เปลี่ยนผ้าอ้อมสำหรับเด็ก
  [facilityKey(RAIL_MODE, RAIL_METRO_VARIANT_KEY, 'B6.1')]:  { facilityCode: 13 },  // พื้นที่หนีภัย/หลบภัยของคนพิการ
  [facilityKey(RAIL_MODE, RAIL_METRO_VARIANT_KEY, 'C1.1')]:  { facilityCode: 19 },  // คู่มือการให้ความช่วยเหลือฯ
  [facilityKey(RAIL_MODE, RAIL_METRO_VARIANT_KEY, 'C2.1')]:  { facilityCode: 21 },  // เจ้าหน้าที่ผ่านการฝึกอบรมฯ
  [facilityKey(RAIL_MODE, RAIL_METRO_VARIANT_KEY, 'A2.8')]:  { facilityCode: 12 },  // จุดจอดรับ-ส่งคนพิการ
  [facilityKey(RAIL_MODE, RAIL_METRO_VARIANT_KEY, 'A2.9')]:  { beyondLaw: true },   // หลังคาป้องกันแดดและฝน
}

interface ContainerTagStats extends TagStats {
  containersAutoMatched: number
  containersOverridden: number
  containersFallenBackToLeaf: number
}

// Stamps every LEAF beneath `container` (recursively) with the same facility identity — never the
// container node itself, preserving the existing "facilityCode/lawRefs live on leaves only"
// invariant every other reader (era-resolution.ts, the admin lawRefs editor, summarizeTemplate)
// already assumes.
function stampFacilityOnLeaves(
  container: TemplateNode,
  tag: { facilityCode?: number; lawRefs?: readonly string[]; cabinetResolution?: boolean; beyondLaw?: boolean },
  stats: TagStats,
): void {
  const visit = (node: TemplateNode) => {
    if (node.subItems && node.subItems.length > 0) {
      for (const child of node.subItems) visit(child)
      return
    }
    stats.total++
    stats.tagged++
    if (tag.facilityCode !== undefined) node.facilityCode = tag.facilityCode
    if (tag.lawRefs) node.lawRefs = [...tag.lawRefs]
    if (tag.cabinetResolution) node.cabinetResolution = true
    if (tag.beyondLaw) node.beyondLaw = true
  }
  visit(container)
}

function tagContainers(def: ChecklistTemplateDefinition, mode: string, variantKey: string): ContainerTagStats {
  const stats: ContainerTagStats = {
    total: 0, tagged: 0, unmatched: [],
    containersAutoMatched: 0, containersOverridden: 0, containersFallenBackToLeaf: 0,
  }

  for (const g of def.groups) {
    for (const container of g.items) {
      const override = CONTAINER_FACILITY_OVERRIDES[facilityKey(mode, variantKey, container.code)]
      if (override) {
        stats.containersOverridden++
        if (override.beyondLaw) {
          stampFacilityOnLeaves(container, { beyondLaw: true }, stats)
        } else if (override.facilityCode !== undefined) {
          const entry = FACILITY_CATALOG.find(e => e.code === override.facilityCode)!
          stampFacilityOnLeaves(container, { facilityCode: entry.code, lawRefs: entry.lawRefs, cabinetResolution: entry.cabinetResolution, beyondLaw: entry.beyondLaw }, stats)
        }
        continue
      }

      const match = matchFacility(container.labelTh)
      if (match) {
        stats.containersAutoMatched++
        const entry = FACILITY_CATALOG.find(e => e.code === match.code)!
        stampFacilityOnLeaves(container, { facilityCode: entry.code, lawRefs: entry.lawRefs, cabinetResolution: entry.cabinetResolution, beyondLaw: entry.beyondLaw }, stats)
        continue
      }

      // Neither an override nor an auto-match at container level — fall back to the ORIGINAL
      // per-leaf matcher for this one container's subtree, so anything not yet reviewed behaves
      // exactly as tagLeaves() already did (no regression for the un-decided remainder).
      stats.containersFallenBackToLeaf++
      const visit = (node: TemplateNode) => {
        if (node.subItems && node.subItems.length > 0) {
          for (const child of node.subItems) visit(child)
          return
        }
        stats.total++
        const leafMatch = matchFacility(node.labelTh)
        if (!leafMatch) { stats.unmatched.push(node.labelTh); return }
        stats.tagged++
        const catalogEntry = FACILITY_CATALOG.find(e => e.code === leafMatch.code)!
        node.facilityCode = catalogEntry.code
        node.lawRefs = [...catalogEntry.lawRefs]
        if (catalogEntry.cabinetResolution) node.cabinetResolution = true
        if (catalogEntry.beyondLaw) node.beyondLaw = true
      }
      visit(container)
    }
  }
  return stats
}

// ---- Session F3, Part G.1 — era-override application, loudly ---------------------------------
//
// A DECLARED-but-missing overrides file used to be a silent no-op: `if (fs.existsSync(path))`
// with no else. Four of the five v2 files named in V2_VARIANTS have never existed, so four modes
// were seeded with no era overrides at all while the seed report said nothing — which is the
// entire reason "era overrides don't work" went unnoticed for three sessions.
//
// Now a missing declared file is reported as a WARNING line, collected and re-printed as a block
// at the end of the run so it cannot scroll past unnoticed. Deliberately a warning, not a hard
// failure: `pnpm db:seed` must stay runnable on a fresh checkout where the (gitignored, สนข.-
// derived) override files have not been generated yet — see era_overrides_convert.py. Making it
// fatal would block every developer from seeding at all over data they may not be allowed to hold.
// The one thing it must never do again is pass silently.
function applyOverridesFile(
  def: ChecklistTemplateDefinition,
  variant: VariantFiles,
  label: string,
  report: string[],
  warnings: string[],
): ChecklistTemplateDefinition {
  if (!variant.overridesFile) return def

  const overridesPath = path.join(TEMPLATE_JSON_DIR, variant.overridesFile)
  if (!fs.existsSync(overridesPath)) {
    const warning = `${label}: era overrides DECLARED but MISSING — ${variant.overridesFile} not found in ${TEMPLATE_JSON_DIR}. This template was seeded with NO era overrides.`
    warnings.push(warning)
    report.push(`  ⚠ ${warning}`)
    return def
  }

  const overridesRaw = JSON.parse(fs.readFileSync(overridesPath, 'utf-8'))
  const merged = applyEraOverrides(def, overridesRaw)
  const count = Object.keys(overridesRaw.overrides ?? {}).length
  if (count === 0) {
    const warning = `${label}: ${variant.overridesFile} exists but declares ZERO overrides — nothing was applied.`
    warnings.push(warning)
    report.push(`  ⚠ ${warning}`)
    return merged
  }
  report.push(`${label}: applied era overrides from ${variant.overridesFile} (${count} leaf(ves))`)
  return merged
}

// Part G.5 — honest byLaw coverage, counted on the template as it will actually be stored.
function countByLawLeaves(def: ChecklistTemplateDefinition): number {
  let n = 0
  const visit = (node: TemplateNode) => {
    if (node.measurements?.some((m) => m.byLaw && Object.keys(m.byLaw).length > 0)) n++
    for (const child of node.subItems ?? []) visit(child)
  }
  for (const g of def.groups) for (const item of g.items) visit(item)
  return n
}

// ---- Session F3, Part C.1 — optional-group stamping ----------------------------------------
//
// Marks every group whose code is in OPTIONAL_GROUP_CODES (C1/C2) as `optional: true`, on EVERY
// version this script seeds — v1, v2 and v3 alike. The auditor submit gate reads that per-group
// flag, never a `/^C/` test, so which groups are optional stays a property of the checklist
// definition rather than a hardcoded rule in the form.
//
// Purely additive: a template with no matching group codes is returned unchanged, and the flag is
// only ever set to `true` (never written as `false`), so untouched templates still round-trip
// byte-identically through the admin editor.
//
// Coverage note (verified 2026-08-04): v2 and v3 carry C1+C2 for every mode/variant. v1 does NOT
// — only ทางบก has C groups at all; v1 ทางราง/ทางน้ำ/ทางอากาศ have none, so this is a no-op there.
function markOptionalGroups(def: ChecklistTemplateDefinition): number {
  let marked = 0
  for (const g of def.groups) {
    if (OPTIONAL_GROUP_CODES.includes(g.code)) {
      g.optional = true
      marked++
    }
  }
  return marked
}

// ---- v1 definition construction ------------------------------------------------------------

function buildV1Definition(mode: Mode): ChecklistTemplateDefinition {
  const groups: ChecklistTemplateGroupDef[] = V1_TEMPLATE_GROUPS[mode].map(g => ({
    code: g.code,
    labelTh: g.labelTh,
    items: g.items.map(it => ({ code: it.code, labelTh: it.labelTh, answerType: 'choice' as const })),
  }))
  return { schemaVersion: 1, mode, provisional: false, groups }
}

// 2026-08-06 — `status` is deliberately absent from `update`, present only in `create`. Found via
// a real report: an admin activated rail_metro v3, then a later reseed silently reset it back to
// DRAFT — because this upsert used to write `status` unconditionally on EVERY run, from the
// caller's hardcoded per-version default (v1→ACTIVE, v2/v3→DRAFT, always). That default is only
// correct for a row's very first insert; once a row exists, its status is an ADMIN DECISION
// (activateTemplate.ts / the admin activate endpoint / a manual retirement) that seeding has no
// business overwriting — seeding's job is refreshing CONTENT, never making activation calls. This
// bug was silent and total: it affected every mode, not just rail, and would have reverted
// tomorrow's activation the moment anyone reseeded afterward for any reason.
async function upsertTemplate(
  mode: Mode,
  variantKey: string,
  version: number,
  status: 'ACTIVE' | 'DRAFT',
  def: ChecklistTemplateDefinition,
  notes: string,
) {
  await prisma.checklistTemplate.upsert({
    where: { mode_variantKey_version: { mode, variantKey, version } },
    update: { definition: def as unknown as Prisma.InputJsonValue, notes },
    create: { mode, variantKey, version, status, definition: def as unknown as Prisma.InputJsonValue, notes },
  })
}

async function main() {
  const report: string[] = []
  // Session F3, Part G.1 — collected separately from `report` so declared-but-missing override
  // files are re-printed as a block at the very end. Inline warnings scroll past in a seed run
  // that prints a line per mode per version; that is exactly how this went unnoticed before.
  const warnings: string[] = []

  // ---- 1. LawReference ----
  for (const law of LAW_REFERENCE_SEED) {
    // effectiveDate is ISO yyyy-mm-dd (Gregorian) in the seed source, DateTime in the DB.
    const effectiveDate = law.effectiveDate ? new Date(law.effectiveDate) : null
    await prisma.lawReference.upsert({
      where: { code: law.code },
      update: { nameTh: law.nameTh, ministry: law.ministry, buddhistYear: law.buddhistYear, effectiveYear: law.effectiveYear ?? null, effectiveDate, notes: law.notes ?? null },
      create: { code: law.code, nameTh: law.nameTh, ministry: law.ministry, buddhistYear: law.buddhistYear, effectiveYear: law.effectiveYear ?? null, effectiveDate, notes: law.notes ?? null },
    })
  }
  report.push(`LawReference: seeded ${LAW_REFERENCE_SEED.length} rows`)

  // ---- 2/3/4. Templates ----
  for (const mode of MODES) {
    const v1def = parseTemplateDefinition(buildV1Definition(mode)) // round-trip through the validator as a sanity check
    const v1stats = tagLeaves(v1def)
    const v1optional = markOptionalGroups(v1def)
    // v1 is NOT split by variant (Session E3, Part A decision) — the live parity anchor stays at
    // variantKey='standard' for every mode, rail included, until v2 activation.
    await upsertTemplate(mode, STANDARD_VARIANT_KEY, 1, 'ACTIVE', v1def, 'v1 parity anchor — item-for-item, code-for-code with the pre-E1 in-code form (apps/web/lib/constants.ts)')
    report.push(`v1 ${mode}: ${v1stats.total} items, ${v1stats.tagged}/${v1stats.total} facility-tagged, ${v1optional} optional group(s)`)
    if (v1stats.unmatched.length) report.push(`  v1 ${mode} unmatched: ${v1stats.unmatched.join(' | ')}`)

    // v2 DRAFT(s) — one per declared variant; a missing source file is a logged no-op (Session
    // E3, Part A: the pipeline must be ready for a variant's workbook without being blocked by
    // its absence).
    for (const variant of V2_VARIANTS[mode]) {
      const rawPath = path.join(TEMPLATE_JSON_DIR, variant.file)
      if (!fs.existsSync(rawPath)) {
        report.push(`v2 ${mode} [${variant.variantKey}]: SKIPPED — ${variant.file} not found (workbook not authored yet)`)
        continue
      }
      const raw = JSON.parse(fs.readFileSync(rawPath, 'utf-8'))
      // template_water_v2.json's `mode` field already says "ทางน้ำ", the source workbook's own
      // term, which is also this project's canonical TransportMode value — no fixup needed here
      // (there used to be one, when the canonical value was "ทางเรือ").
      let v2def = parseTemplateDefinition(raw) // throws loudly on any mismatch — v2 files are loaded verbatim, never coerced

      v2def = applyOverridesFile(v2def, variant, `v2 ${mode} [${variant.variantKey}]`, report, warnings)

      const v2stats = tagLeaves(v2def)
      const v2optional = markOptionalGroups(v2def)
      await upsertTemplate(mode, variant.variantKey, 2, 'DRAFT', v2def, 'PROVISIONAL — see apps/docs/Checklist_Utils/DATA_DICTIONARY_v2.md; NOT activated in Session E1')
      report.push(`v2 ${mode} [${variant.variantKey}]: ${v2stats.total} leaves, ${v2stats.tagged}/${v2stats.total} facility-tagged, ${v2optional} optional group(s), ${countByLawLeaves(v2def)} byLaw leaf(ves)`)
      if (v2stats.unmatched.length) {
        report.push(`  v2 ${mode} [${variant.variantKey}] unmatched (${v2stats.unmatched.length}): ${v2stats.unmatched.slice(0, 30).join(' | ')}${v2stats.unmatched.length > 30 ? ' ...' : ''}`)
      }
    }

    // v3 DRAFT(s) — candidates from the checklist-migration pipeline. Mirrors the v2 loop
    // exactly, era-override application included (Session F3, Part G.3).
    for (const variant of V3_VARIANTS[mode]) {
      const rawPath = path.join(TEMPLATE_JSON_DIR, variant.file)
      if (!fs.existsSync(rawPath)) {
        report.push(`v3 ${mode} [${variant.variantKey}]: SKIPPED — ${variant.file} not found`)
        continue
      }
      const raw = JSON.parse(fs.readFileSync(rawPath, 'utf-8'))
      let v3def = parseTemplateDefinition(raw) // throws loudly on any mismatch — v3 files are loaded verbatim, never coerced

      v3def = applyOverridesFile(v3def, variant, `v3 ${mode} [${variant.variantKey}]`, report, warnings)

      // 2026-08-05 — every v3 mode/variant now uses container-level tagging (see tagContainers'
      // doc). v1/v2 still use the original per-leaf tagLeaves() — out of scope, both superseded.
      const v3stats = tagContainers(v3def, mode, variant.variantKey)
      const v3optional = markOptionalGroups(v3def)
      await upsertTemplate(mode, variant.variantKey, 3, 'DRAFT', v3def, 'PROVISIONAL — checklist-migration pipeline candidate; NOT activated')
      report.push(`v3 ${mode} [${variant.variantKey}]: ${v3stats.total} leaves, ${v3stats.tagged}/${v3stats.total} facility-tagged, ${v3optional} optional group(s), ${countByLawLeaves(v3def)} byLaw leaf(ves)`)
      report.push(`  v3 ${mode} [${variant.variantKey}] container-level: ${v3stats.containersOverridden} overridden, ${v3stats.containersAutoMatched} auto-matched, ${v3stats.containersFallenBackToLeaf} fell back to per-leaf matching`)
      if (v3stats.unmatched.length) {
        report.push(`  v3 ${mode} [${variant.variantKey}] unmatched (${v3stats.unmatched.length}): ${v3stats.unmatched.slice(0, 30).join(' | ')}${v3stats.unmatched.length > 30 ? ' ...' : ''}`)
      }
    }
  }

  // ---- 5. Backfill existing Checklist rows ----
  const v1Templates = await prisma.checklistTemplate.findMany({ where: { variantKey: 'standard', version: 1, status: 'ACTIVE' } })
  const templateByMode = new Map(v1Templates.map(t => [t.mode, t]))

  const unbackfilled = await prisma.checklist.findMany({
    where: { templateId: null },
    select: { id: true, station: { select: { mode: true } } },
  })
  let backfilled = 0
  for (const cl of unbackfilled) {
    const t = templateByMode.get(cl.station.mode)
    if (!t) continue
    await prisma.checklist.update({ where: { id: cl.id }, data: { templateId: t.id, templateVersion: t.version } })
    backfilled++
  }
  report.push(`Backfill: ${backfilled}/${unbackfilled.length} pre-existing Checklist rows stamped to their mode's v1 ACTIVE template`)

  console.log(report.join('\n'))

  // Part G.1 — the block that makes a silent no-op impossible to miss.
  if (warnings.length > 0) {
    console.warn(
      `\n${'='.repeat(78)}\n` +
      `⚠  ERA OVERRIDES: ${warnings.length} declared file(s) were NOT applied\n` +
      `${'='.repeat(78)}\n` +
      warnings.map((w) => `  • ${w}`).join('\n') +
      `\n\nGenerate the missing file(s) with:\n` +
      `  python tools/checklist-migration/era_overrides_convert.py \\\n` +
      `      <candidates.json> <template.json> tools/checklist_json/<overrides.json>\n` +
      `${'='.repeat(78)}\n`
    )
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
