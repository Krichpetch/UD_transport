import { resolveStationMatch, type MasterlistStation } from '../masterlist-match'

function station(overrides: Partial<MasterlistStation>): MasterlistStation {
  return { id: 'id', mode: 'ทางบก', nameTh: 'สถานีทดสอบ', line: '', ...overrides }
}

describe('resolveStationMatch — tier 1 (exact)', () => {
  it('matches on literal (mode, name, line) equality', () => {
    const masterlist = [station({ id: 's1', mode: 'ทางบก', nameTh: 'สถานีขนส่งผู้โดยสารกรุงเทพ', line: '' })]
    const result = resolveStationMatch({ mode: 'ทางบก', nameTh: 'สถานีขนส่งผู้โดยสารกรุงเทพ', line: '' }, masterlist)
    expect(result.status).toBe('MATCHED')
    expect(result.tier).toBe('EXACT')
    expect(result.matchedStation?.id).toBe('s1')
  })
})

describe('resolveStationMatch — tier 2 (normalized name)', () => {
  it('matches through whitespace/paren variance', () => {
    const masterlist = [station({ id: 's1', nameTh: 'สถานีขนส่งผู้โดยสารกรุงเทพ (จตุจักร)' })]
    const result = resolveStationMatch({ mode: 'ทางบก', nameTh: 'สถานีขนส่งผู้โดยสารกรุงเทพจตุจักร' }, masterlist)
    expect(result.status).toBe('MATCHED')
    expect(result.tier).toBe('NORMALIZED')
    expect(result.matchedStation?.id).toBe('s1')
  })

  it('disambiguates same-name-different-line stations using the incoming row line', () => {
    const masterlist = [
      station({ id: 'green', mode: 'ทางราง', nameTh: 'กรุงธนบุรี', line: 'สายสีเขียว' }),
      station({ id: 'gold', mode: 'ทางราง', nameTh: 'กรุงธนบุรี', line: 'สายสีทอง' }),
    ]
    const result = resolveStationMatch({ mode: 'ทางราง', nameTh: 'กรุงธนบุรี', line: 'สายสีทอง' }, masterlist)
    expect(result.status).toBe('MATCHED')
    expect(result.matchedStation?.id).toBe('gold')
  })

  it('sends same-name-different-line to REVIEW when the incoming row has no line to disambiguate', () => {
    const masterlist = [
      station({ id: 'green', mode: 'ทางราง', nameTh: 'กรุงธนบุรี', line: 'สายสีเขียว' }),
      station({ id: 'gold', mode: 'ทางราง', nameTh: 'กรุงธนบุรี', line: 'สายสีทอง' }),
    ]
    const result = resolveStationMatch({ mode: 'ทางราง', nameTh: 'กรุงธนบุรี' }, masterlist)
    expect(result.status).toBe('REVIEW')
    expect(result.matchedStation).toBeNull()
  })
})

describe('resolveStationMatch — tier 3 (fuzzy)', () => {
  it('auto-matches at or above the 0.92 threshold and logs it as MATCHED_FUZZY', () => {
    // Real station names in this dataset carry a space between the generic descriptor and the
    // proper name (e.g. "สถานี บางซ่อน" appears literally in the real Match_Status data) --
    // this is the realistic shape a fuzzy-matchable variant takes, not a concatenated compound.
    const masterlist = [station({ id: 's1', mode: 'ทางราง', nameTh: 'สถานีรถไฟ บางซ่อน' })]
    const result = resolveStationMatch({ mode: 'ทางราง', nameTh: 'บางซ่อน' }, masterlist)
    expect(result.status).toBe('MATCHED_FUZZY')
    expect(result.tier).toBe('FUZZY')
    expect(result.matchedStation?.id).toBe('s1')
    expect(result.score).toBeGreaterThanOrEqual(0.92)
  })

  it('sends 0.75-0.92 scores to REVIEW', () => {
    const masterlist = [station({ id: 's1', mode: 'ทางบก', nameTh: 'สถานีขนส่งผู้โดยสาร เชียงใหม่ แห่งที่ 1' })]
    const result = resolveStationMatch({ mode: 'ทางบก', nameTh: 'สถานีขนส่ง เชียงใหม่ แห่งที่ 1' }, masterlist)
    expect(result.status).toBe('REVIEW')
    expect(result.score).toBeGreaterThanOrEqual(0.75)
    expect(result.score).toBeLessThan(0.92)
  })

  it('reports NOT_ON_MASTERLIST below 0.75 with no matched station attached', () => {
    const masterlist = [station({ id: 's1', mode: 'ทางอากาศ', nameTh: 'ท่าอากาศยานสุวรรณภูมิ' })]
    const result = resolveStationMatch({ mode: 'ทางอากาศ', nameTh: 'ท่าเรือคลองเตย' }, masterlist)
    expect(result.status).toBe('NOT_ON_MASTERLIST')
    expect(result.matchedStation).toBeNull()
  })

  it('reports NOT_ON_MASTERLIST when the masterlist has no stations of that mode at all', () => {
    const result = resolveStationMatch({ mode: 'ทางอากาศ', nameTh: 'ท่าอากาศยานสุวรรณภูมิ' }, [])
    expect(result.status).toBe('NOT_ON_MASTERLIST')
    expect(result.tier).toBeNull()
  })
})

describe('resolveStationMatch — ท่าช้าง cross-mode case (no cross-mode bleed)', () => {
  it('matches the pier and the rail station independently, never crossing modes', () => {
    const masterlist = [
      station({ id: 'pier', mode: 'ทางน้ำ', nameTh: 'ท่าช้าง' }),
      station({ id: 'rail', mode: 'ทางราง', nameTh: 'ท่าช้าง' }),
    ]
    const pierResult = resolveStationMatch({ mode: 'ทางน้ำ', nameTh: 'ท่าช้าง' }, masterlist)
    const railResult = resolveStationMatch({ mode: 'ทางราง', nameTh: 'ท่าช้าง' }, masterlist)
    expect(pierResult.matchedStation?.id).toBe('pier')
    expect(railResult.matchedStation?.id).toBe('rail')
  })

  it('an air-mode row with the same name matches neither and goes to REVIEW/NOT_ON_MASTERLIST, never the pier or rail row', () => {
    const masterlist = [
      station({ id: 'pier', mode: 'ทางน้ำ', nameTh: 'ท่าช้าง' }),
      station({ id: 'rail', mode: 'ทางราง', nameTh: 'ท่าช้าง' }),
    ]
    const result = resolveStationMatch({ mode: 'ทางอากาศ', nameTh: 'ท่าช้าง' }, masterlist)
    expect(result.matchedStation).toBeNull()
    expect(result.status).toBe('NOT_ON_MASTERLIST')
  })
})
