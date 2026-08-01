/**
 * migrate-agency-names.ts renames the old bare-abbreviation responsibleAgency/agency values to
 * the new canonical "full name (abbreviation)" list. Two things matter most: (1) all 11 known
 * legacy values map exactly onto their new canonical counterpart, and (2) anything NOT in that
 * known set is flagged (confident: false) and falls back to OTHER_AGENCY rather than being
 * silently dropped or left untouched — the caller (main()) uses that flag to warn before
 * --apply actually writes.
 */
import { OTHER_AGENCY, RESPONSIBLE_AGENCIES } from '@repo/types'
import {
  LEGACY_AGENCY_MAP,
  planAgencyMigration,
  applyAgencyMigration,
  type MigrationClient,
} from '../migrate-agency-names'

function makeClient(stationAgencies: string[], userAgencies: (string | null)[]): {
  client: MigrationClient
  stationUpdateMany: jest.Mock
  userUpdateMany: jest.Mock
} {
  const stationUpdateMany = jest.fn().mockResolvedValue({ count: 0 })
  const userUpdateMany = jest.fn().mockResolvedValue({ count: 0 })
  return {
    client: {
      station: {
        findMany: jest.fn().mockResolvedValue(stationAgencies.map((responsibleAgency) => ({ responsibleAgency }))),
        updateMany: stationUpdateMany,
      },
      user: {
        findMany: jest.fn().mockResolvedValue(userAgencies.map((agency) => ({ agency }))),
        updateMany: userUpdateMany,
      },
    },
    stationUpdateMany,
    userUpdateMany,
  }
}

describe('LEGACY_AGENCY_MAP', () => {
  it('every legacy value maps onto a real entry in the new canonical RESPONSIBLE_AGENCIES', () => {
    for (const newValue of Object.values(LEGACY_AGENCY_MAP)) {
      expect(RESPONSIBLE_AGENCIES).toContain(newValue)
    }
  })

  it('covers exactly the 11 old bare abbreviations, position-for-position with the old list', () => {
    expect(Object.keys(LEGACY_AGENCY_MAP).sort()).toEqual(
      ['ขบ.', 'ขสมก.', 'บขส.', 'รฟท.', 'รฟม.', 'รฟฟท.', 'BEM', 'จท.', 'ทย.', 'ทอท.', 'อื่นๆ'].sort(),
    )
  })
})

describe('planAgencyMigration', () => {
  it('maps a known legacy value with confident: true', async () => {
    const { client } = makeClient(['ขบ.', 'ขบ.', 'ขบ.'], [])
    const plan = await planAgencyMigration(client)
    expect(plan.stationRows).toEqual([
      { oldValue: 'ขบ.', newValue: 'กรมการขนส่งทางบก (ขบ.)', count: 3, confident: true },
    ])
  })

  it('falls back an unknown value to OTHER_AGENCY with confident: false', async () => {
    const { client } = makeClient(['หน่วยงานลึกลับ'], [])
    const plan = await planAgencyMigration(client)
    expect(plan.stationRows).toEqual([
      { oldValue: 'หน่วยงานลึกลับ', newValue: OTHER_AGENCY, count: 1, confident: false },
    ])
  })

  it('drops rows that are already canonical (idempotent re-run after --apply)', async () => {
    const { client } = makeClient(['กรมการขนส่งทางบก (ขบ.)'], [])
    const plan = await planAgencyMigration(client)
    expect(plan.stationRows).toEqual([])
  })

  it('ignores null User.agency rows (nullable field, no admin-assigned agency yet)', async () => {
    const { client } = makeClient([], [null, 'รฟท.', null])
    const plan = await planAgencyMigration(client)
    expect(plan.userRows).toEqual([
      { oldValue: 'รฟท.', newValue: 'การรถไฟแห่งประเทศไทย (รฟท.)', count: 1, confident: true },
    ])
  })

  it('sorts by count descending', async () => {
    const { client } = makeClient(['ทย.', 'ขบ.', 'ขบ.', 'ขบ.'], [])
    const plan = await planAgencyMigration(client)
    expect(plan.stationRows.map((r) => r.oldValue)).toEqual(['ขบ.', 'ทย.'])
  })
})

describe('applyAgencyMigration', () => {
  it('issues one updateMany per plan row, station and user separately', async () => {
    const { client, stationUpdateMany, userUpdateMany } = makeClient(['ขบ.'], ['รฟท.'])
    const plan = await planAgencyMigration(client)
    await applyAgencyMigration(client, plan)

    expect(stationUpdateMany).toHaveBeenCalledWith({
      where: { responsibleAgency: 'ขบ.' },
      data: { responsibleAgency: 'กรมการขนส่งทางบก (ขบ.)' },
    })
    expect(userUpdateMany).toHaveBeenCalledWith({
      where: { agency: 'รฟท.' },
      data: { agency: 'การรถไฟแห่งประเทศไทย (รฟท.)' },
    })
  })

  it('writes nothing when the plan is empty', async () => {
    const { client, stationUpdateMany, userUpdateMany } = makeClient([], [])
    const plan = await planAgencyMigration(client)
    await applyAgencyMigration(client, plan)
    expect(stationUpdateMany).not.toHaveBeenCalled()
    expect(userUpdateMany).not.toHaveBeenCalled()
  })
})
