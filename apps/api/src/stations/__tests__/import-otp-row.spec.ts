import { applyOtpRowToStation, type ResolvedStation, type ImportOtpTxClient } from '../import-otp-row'

function makeTx(overrides: Partial<{ agencyUpdateResult: { responsibleAgency: string } }> = {}): {
  tx: ImportOtpTxClient
  stationUpdate: jest.Mock
  checklistCreate: jest.Mock
  checklistUpdate: jest.Mock
} {
  const stationUpdate = jest.fn().mockResolvedValue(overrides.agencyUpdateResult ?? { responsibleAgency: 'ขบ.' })
  const checklistCreate = jest.fn().mockResolvedValue({ id: 'cl-new' })
  const checklistUpdate = jest.fn().mockResolvedValue({})
  return { tx: { station: { update: stationUpdate }, checklist: { create: checklistCreate, update: checklistUpdate } }, stationUpdate, checklistCreate, checklistUpdate }
}

function makeStation(overrides: Partial<ResolvedStation> = {}): ResolvedStation {
  return { id: 'st1', nameTh: 'สถานีทดสอบ', responsibleAgency: 'ขบ.', lastInspected: null, ...overrides }
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

  it('prefers a real agency over a stale อื่นๆ fallback', async () => {
    const { tx, stationUpdate } = makeTx({ agencyUpdateResult: { responsibleAgency: 'ขบ.' } })
    await applyOtpRowToStation(
      tx, makeStation({ responsibleAgency: 'อื่นๆ' }),
      { items: [], score: 80, lastInspected: '2026-01-01', responsibleAgency: 'ขบ.' }, 'admin-1', undefined,
    )
    expect(stationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { responsibleAgency: 'ขบ.' } }),
    )
  })

  it('does not touch agency when the incoming row is also อื่นๆ', async () => {
    const { tx, stationUpdate } = makeTx()
    await applyOtpRowToStation(
      tx, makeStation({ responsibleAgency: 'อื่นๆ', lastInspected: new Date('2027-01-01') }),
      { items: [], score: 80, lastInspected: '2020-01-01', responsibleAgency: 'อื่นๆ' }, 'admin-1', undefined,
    )
    expect(stationUpdate).not.toHaveBeenCalled()
  })
})
