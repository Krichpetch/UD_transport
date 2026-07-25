import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  reconciliationToCsv,
  reconciliationFilename,
  writeReconciliationCsv,
  parseReviewDecisions,
  type ReconciliationRow,
} from '../import-reconciliation'

function row(overrides: Partial<ReconciliationRow> = {}): ReconciliationRow {
  return {
    index: 0, nameTh: 'สถานีทดสอบ', mode: 'ทางบก', line: '', tier: 'EXACT',
    status: 'MATCHED', matchedStationId: 'st1', score: 1, ...overrides,
  }
}

describe('reconciliationFilename', () => {
  it('follows the import_reconciliation_{source}_{date}.csv convention', () => {
    expect(reconciliationFilename('batch-otp', new Date('2026-07-26T10:00:00Z'))).toBe(
      'import_reconciliation_batch-otp_2026-07-26.csv',
    )
  })
})

describe('reconciliationToCsv', () => {
  it('emits one row per record with a blank decision column', () => {
    const csv = reconciliationToCsv([row({ index: 0 }), row({ index: 1, status: 'NOT_ON_MASTERLIST', matchedStationId: null, tier: null })])
    const lines = csv.trim().split('\n')
    expect(lines).toHaveLength(3) // header + 2 rows
    expect(lines[0]).toBe('index,nameTh,mode,line,tier,status,matchedStationId,score,decision')
    expect(lines[1]!.endsWith(',')).toBe(true) // trailing decision column is blank
  })

  it('quotes fields containing commas', () => {
    const csv = reconciliationToCsv([row({ nameTh: 'สถานี, ทดสอบ' })])
    expect(csv).toContain('"สถานี, ทดสอบ"')
  })
})

describe('writeReconciliationCsv', () => {
  it('writes the file and creates the directory if needed', () => {
    const tmpDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reconciliation-test-')), 'nested')
    const filePath = writeReconciliationCsv('batch-otp', [row()], tmpDir, new Date('2026-07-26'))
    expect(fs.existsSync(filePath)).toBe(true)
    expect(path.basename(filePath)).toBe('import_reconciliation_batch-otp_2026-07-26.csv')
  })
})

describe('parseReviewDecisions', () => {
  it('parses accept decisions', () => {
    const csv = [
      'index,nameTh,mode,line,tier,status,matchedStationId,score,decision',
      '0,สถานี A,ทางบก,,FUZZY,REVIEW,st5,0.8,accept',
    ].join('\n')
    const decisions = parseReviewDecisions(csv)
    expect(decisions).toEqual([{ index: 0, decision: 'accept' }])
  })

  it('parses map_to decisions', () => {
    const csv = [
      'index,nameTh,mode,line,tier,status,matchedStationId,score,decision',
      '1,สถานี B,ทางบก,,,NOT_ON_MASTERLIST,,0,map_to:st99',
    ].join('\n')
    const decisions = parseReviewDecisions(csv)
    expect(decisions).toEqual([{ index: 1, decision: { mapToStationId: 'st99' } }])
  })

  it('skips rows with a blank decision', () => {
    const csv = [
      'index,nameTh,mode,line,tier,status,matchedStationId,score,decision',
      '0,สถานี A,ทางบก,,,REVIEW,,0.8,',
    ].join('\n')
    expect(parseReviewDecisions(csv)).toEqual([])
  })

  it('ignores unrecognized decision text rather than guessing', () => {
    const csv = [
      'index,nameTh,mode,line,tier,status,matchedStationId,score,decision',
      '0,สถานี A,ทางบก,,,REVIEW,,0.8,maybe?',
    ].join('\n')
    expect(parseReviewDecisions(csv)).toEqual([])
  })

  it('handles quoted fields containing commas', () => {
    const csv = [
      'index,nameTh,mode,line,tier,status,matchedStationId,score,decision',
      '0,"สถานี, ก",ทางบก,,,REVIEW,,0.8,accept',
    ].join('\n')
    expect(parseReviewDecisions(csv)).toEqual([{ index: 0, decision: 'accept' }])
  })
})
