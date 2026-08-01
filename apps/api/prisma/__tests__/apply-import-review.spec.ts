import { applyReviewDecisions, type ApplyReviewClient } from '../apply-import-review'
import type { OtpRowDto } from '../../src/stations/dto/otp-row.dto'

function makeRow(nameTh: string): OtpRowDto {
  return {
    station: { nameTh, name: nameTh, mode: 'ทางบก', province: 'กรุงเทพมหานคร', region: 'กลาง', responsibleAgency: 'กรมการขนส่งทางบก (ขบ.)', lat: 13.75, lng: 100.5 },
    items: [], score: 80, status: 'ผ่านมาตรฐาน', lastInspected: '2026-01-01',
  } as unknown as OtpRowDto
}

function makeClient(overrides: Partial<{ station: Record<string, unknown> | null }> = {}) {
  const stationFindUnique = jest.fn().mockResolvedValue(
    overrides.station === undefined
      ? { id: 'st1', nameTh: 'สถานี A', responsibleAgency: 'กรมการขนส่งทางบก (ขบ.)', lastInspected: null }
      : overrides.station,
  )
  const checklistFindFirst = jest.fn().mockResolvedValue(null)
  const checklistCreate = jest.fn().mockResolvedValue({ id: 'cl-new' })
  const stationUpdate = jest.fn().mockResolvedValue({ responsibleAgency: 'กรมการขนส่งทางบก (ขบ.)' })
  const client: ApplyReviewClient = {
    station: { findUnique: stationFindUnique },
    checklist: { findFirst: checklistFindFirst },
    $transaction: jest.fn(async (fn) => fn({ station: { update: stationUpdate }, checklist: { create: checklistCreate, update: jest.fn() } })),
  }
  return { client, stationFindUnique, checklistFindFirst, checklistCreate, stationUpdate }
}

const HEADER = 'index,nameTh,mode,line,tier,status,matchedStationId,score,decision'
function csvOf(row: string): string {
  return [HEADER, row].join('\n')
}

describe('applyReviewDecisions', () => {
  it('applies an "accept" decision using the CSV\'s own matchedStationId', async () => {
    const { client, stationFindUnique, checklistCreate } = makeClient()
    const results = await applyReviewDecisions(
      client, csvOf('0,สถานี A,ทางบก,,FUZZY,REVIEW,st1,0.8,accept'), [{ index: 0, row: makeRow('สถานี A') }],
      new Map([[0, 'st1']]), 'admin-1',
    )
    expect(stationFindUnique).toHaveBeenCalledWith({ where: { id: 'st1' } })
    expect(checklistCreate).toHaveBeenCalledTimes(1)
    expect(results).toEqual([{ index: 0, outcome: 'applied' }])
  })

  it('applies a "map_to:<id>" decision, overriding whatever the CSV guessed', async () => {
    const { client, stationFindUnique } = makeClient()
    const results = await applyReviewDecisions(
      client, csvOf('1,สถานี B,ทางบก,,,NOT_ON_MASTERLIST,,0,map_to:st2'), [{ index: 1, row: makeRow('สถานี B') }],
      new Map([[1, null]]), 'admin-1',
    )
    expect(stationFindUnique).toHaveBeenCalledWith({ where: { id: 'st2' } })
    expect(results).toEqual([{ index: 1, outcome: 'applied' }])
  })

  it('ignores rows with no decision filled in', async () => {
    const { client } = makeClient()
    const results = await applyReviewDecisions(
      client, csvOf('2,สถานี C,ทางบก,,,REVIEW,st9,0.8,'), [{ index: 2, row: makeRow('สถานี C') }],
      new Map([[2, 'st9']]), 'admin-1',
    )
    expect(results).toEqual([])
  })

  it('skips (never inserts) when the decided target station does not exist', async () => {
    const { client } = makeClient({ station: null })
    const results = await applyReviewDecisions(
      client, csvOf('0,สถานี A,ทางบก,,FUZZY,REVIEW,st1,0.8,accept'), [{ index: 0, row: makeRow('สถานี A') }],
      new Map([[0, 'st1']]), 'admin-1',
    )
    expect(results).toEqual([{ index: 0, outcome: 'skipped_no_target', detail: 'station st1 not found' }])
  })

  it('skips when there is no cached payload for the decided row', async () => {
    const { client } = makeClient()
    const results = await applyReviewDecisions(
      client, csvOf('0,สถานี A,ทางบก,,FUZZY,REVIEW,st1,0.8,accept'), [], new Map([[0, 'st1']]), 'admin-1',
    )
    expect(results).toEqual([{ index: 0, outcome: 'skipped_no_target', detail: 'no cached payload for this row' }])
  })

  it('reports an error outcome without throwing when the transaction fails', async () => {
    const { client } = makeClient()
    ;(client.$transaction as jest.Mock).mockRejectedValueOnce(new Error('db down'))
    const results = await applyReviewDecisions(
      client, csvOf('0,สถานี A,ทางบก,,FUZZY,REVIEW,st1,0.8,accept'), [{ index: 0, row: makeRow('สถานี A') }],
      new Map([[0, 'st1']]), 'admin-1',
    )
    expect(results).toEqual([{ index: 0, outcome: 'error', detail: 'db down' }])
  })
})
