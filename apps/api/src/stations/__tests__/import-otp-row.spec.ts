import { applyOtpRowToStation, type ResolvedStation, type ImportOtpTxClient } from '../import-otp-row'
import { OTHER_AGENCY } from '@repo/types'

function makeTx(overrides: Partial<{ agencyUpdateResult: { responsibleAgency: string } }> = {}): {
  tx: ImportOtpTxClient
  stationUpdate: jest.Mock
  checklistCreate: jest.Mock
  checklistUpdate: jest.Mock
} {
  const stationUpdate = jest.fn().mockResolvedValue(overrides.agencyUpdateResult ?? { responsibleAgency: 'กรมการขนส่งทางบก (ขบ.)' })
  const checklistCreate = jest.fn().mockResolvedValue({ id: 'cl-new' })
  const checklistUpdate = jest.fn().mockResolvedValue({})
  return { tx: { station: { update: stationUpdate }, checklist: { create: checklistCreate, update: checklistUpdate } }, stationUpdate, checklistCreate, checklistUpdate }
}

function makeStation(overrides: Partial<ResolvedStation> = {}): ResolvedStation {
  return { id: 'st1', nameTh: 'สถานีทดสอบ', responsibleAgency: 'กรมการขนส่งทางบก (ขบ.)', lastInspected: null, ...overrides }
}

describe('applyOtpRowToStation', () => {
  it('never creates a station -- only updates checklist + station metadata', async () => {
    const { tx, checklistCreate } = makeTx()
    const result = await applyOtpRowToStation(
      tx, makeStation(), { items: [], score: 80, lastInspected: '2026-01-01' }, 'admin-1', undefined,
    )
    expect(result).toEqual({ id: 'st1', nameTh: 'สถานีทดสอบ' })
    expect(checklistCreate).toHaveBeenCalledTimes(1)
  })

  it('creates a checklist when none exists for that station/year', async () => {
    const { tx, checklistCreate, checklistUpdate } = makeTx()
    await applyOtpRowToStation(tx, makeStation(), { items: [], score: 80, lastInspected: '2026-01-01' }, 'admin-1', undefined)
    expect(checklistCreate).toHaveBeenCalledTimes(1)
    expect(checklistUpdate).not.toHaveBeenCalled()
  })

  it('updates an existing checklist instead of creating a duplicate', async () => {
    const { tx, checklistCreate, checklistUpdate } = makeTx()
    await applyOtpRowToStation(
      tx, makeStation(), { items: [], score: 80, lastInspected: '2026-01-01' }, 'admin-1',
      { id: 'existing-cl', stationId: 'st1' },
    )
    expect(checklistUpdate).toHaveBeenCalledTimes(1)
    expect(checklistCreate).not.toHaveBeenCalled()
  })

  it('re-derives score from items rather than trusting row.score', async () => {
    const { tx, checklistCreate } = makeTx()
    // computeScoreFromItems([]) -- empty items -> 0, regardless of the claimed row.score of 999.
    await applyOtpRowToStation(tx, makeStation(), { items: [], score: 999, lastInspected: '2026-01-01' }, 'admin-1', undefined)
    const callArg = checklistCreate.mock.calls[0][0]
    expect(callArg.data.score).not.toBe(999)
  })

  it('refreshes station score/status/lastInspected when this row is the most recent', async () => {
    const { tx, stationUpdate } = makeTx()
    await applyOtpRowToStation(
      tx, makeStation({ lastInspected: new Date('2020-01-01') }),
      { items: [], score: 80, lastInspected: '2026-01-01' }, 'admin-1', undefined,
    )
    expect(stationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastInspected: new Date('2026-01-01') }) }),
    )
  })

  it('does not refresh station score when this row is OLDER than lastInspected', async () => {
    const { tx, stationUpdate } = makeTx()
    await applyOtpRowToStation(
      tx, makeStation({ lastInspected: new Date('2026-06-01') }),
      { items: [], score: 80, lastInspected: '2020-01-01' }, 'admin-1', undefined,
    )
    expect(stationUpdate).not.toHaveBeenCalled()
  })

  it('prefers a real agency over a stale OTHER_AGENCY fallback', async () => {
    const { tx, stationUpdate } = makeTx({ agencyUpdateResult: { responsibleAgency: 'กรมการขนส่งทางบก (ขบ.)' } })
    await applyOtpRowToStation(
      tx, makeStation({ responsibleAgency: OTHER_AGENCY }),
      { items: [], score: 80, lastInspected: '2026-01-01', responsibleAgency: 'กรมการขนส่งทางบก (ขบ.)' }, 'admin-1', undefined,
    )
    expect(stationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { responsibleAgency: 'กรมการขนส่งทางบก (ขบ.)' } }),
    )
  })

  it('does not touch agency when the incoming row is also OTHER_AGENCY', async () => {
    const { tx, stationUpdate } = makeTx()
    await applyOtpRowToStation(
      tx, makeStation({ responsibleAgency: OTHER_AGENCY, lastInspected: new Date('2027-01-01') }),
      { items: [], score: 80, lastInspected: '2020-01-01', responsibleAgency: OTHER_AGENCY }, 'admin-1', undefined,
    )
    expect(stationUpdate).not.toHaveBeenCalled()
  })
})
