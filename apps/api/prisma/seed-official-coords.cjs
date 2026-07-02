'use strict'
const { PrismaClient } = require('@prisma/client')
const fs   = require('fs')
const path = require('path')
const staging = require('./seed-data/stations_master_staging.json')
const prisma = new PrismaClient()

// ── mode mapping ─────────────────────────────────────────────────────────────
const STAGING_TO_DB = {
  bus:     { mode: 'ทางบก',    railSubtype: null        },
  subway:  { mode: 'ทางราง',   railSubtype: 'รถไฟฟ้า'   },
  train:   { mode: 'ทางราง',   railSubtype: 'รถไฟ'      },
  airport: { mode: 'ทางอากาศ', railSubtype: null        },
}

// ── airport English → Thai keyword that appears in DB nameTh ─────────────────
const AIRPORT_EN_TO_THAI = {
  Maehongson:       'แม่ฮ่องสอน',
  Lampang:          'ลำปาง',
  Phrae:            'แพร่',
  Nannakhon:        'น่าน',
  Phitsanulok:      'พิษณุโลก',
  Phetchaboon:      'เพชรบูรณ์',
  Tak:              'ตาก',
  Maesot:           'แม่สอด',
  Ubonratchathani:  'อุบลราชธานี',
  Udornthani:       'อุดรธานี',
  Khonkhaen:        'ขอนแก่น',
  Sakonakhon:       'สกลนคร',
  Loei:             'เลย',
  Nakhonratchasima: 'นครราชสีมา',
  Nakhonphanom:     'นครพนม',
  Buriram:          'บุรีรัมย์',
  'Roi Et':         'ร้อยเอ็ด',
  Huahin:           'หัวหิน',
  Ranong:           'ระนอง',
  Chumporn:         'ชุมพร',
  Suratthani:       'สุราษฎร์ธานี',
  Nakhonsrithammarat: 'นครศรีธรรมราช',
  Trang:            'ตรัง',
  Pattani:          'ปัตตานี',
  Narathiwas:       'นราธิวาส',
  Krabi:            'กระบี่',
  Pai:              'ปาย',
  'Mae Sariang':    'แม่สะเรียง',
}

// ── helpers ───────────────────────────────────────────────────────────────────
const norm = s => (s || '').trim().replace(/\s+/g, ' ')

// Extract the disambiguation text inside the FIRST (…) in a DB bus nameTh.
// e.g. "ขอนแก่น (ชุมแพ)" → "ชุมแพ"
function extractParens(nameTh) {
  const m = nameTh.match(/\(([^)]+)\)/)
  return m ? norm(m[1]) : ''
}

// Strip the สถานี prefix used on all subway DB nameTh values.
function stripStation(nameTh) {
  return norm(nameTh.replace(/^สถานี/, ''))
}

// Strip the ท่าอากาศยาน prefix and trailing " 1", " 2" variants from airport DB nameTh.
function stripAirport(nameTh) {
  return norm(nameTh.replace(/^ท่าอากาศยาน/, '').replace(/\s+\d+$/, ''))
}

// Bangkok bus province mapping: staging uses "กรุงเทพมหานคร", DB uses "ไม่ระบุจังหวัด"
function normProvince(province_th) {
  if (!province_th) return ''
  const p = norm(province_th)
  if (p === 'กรุงเทพมหานคร' || p === 'กรุงเทพฯ') return 'ไม่ระบุจังหวัด'
  return p
}

// ── matcher ───────────────────────────────────────────────────────────────────
function matchStation(row, dbByMode) {
  const mapping = STAGING_TO_DB[row.mode]
  if (!mapping) return null

  const key = mapping.railSubtype
    ? `${mapping.mode}/${mapping.railSubtype}`
    : mapping.mode
  const candidates = dbByMode[key] || []

  if (row.mode === 'bus') {
    const province = normProvince(row.province_th)
    const amphoe   = norm(row.amphoe_th)
    const inProvince = candidates.filter(s => norm(s.province) === province)

    if (inProvince.length === 1) return inProvince[0]
    if (inProvince.length > 1 && amphoe) {
      // Try exact amphoe match in parens
      const byAmphoe = inProvince.filter(s => extractParens(s.nameTh) === amphoe)
      if (byAmphoe.length === 1) return byAmphoe[0]
      // Fallback: amphoe substring in full nameTh
      const bySub = inProvince.filter(s => s.nameTh.includes(amphoe))
      if (bySub.length === 1) return bySub[0]
    }
    return null // ambiguous or not found
  }

  if (row.mode === 'subway') {
    const target = norm(row.name_th)
    const hits = candidates.filter(s => stripStation(s.nameTh) === target)
    if (hits.length === 1) return hits[0]
    // If multiple (shouldn't happen), return null — ambiguous
    return hits.length === 0 ? null : null
  }

  if (row.mode === 'train') {
    const target   = norm(row.name_th)
    const province = normProvince(row.province_th)
    const byName = candidates.filter(s => norm(s.nameTh) === target)
    if (byName.length === 1) return byName[0]
    if (byName.length > 1 && province) {
      const byProv = byName.filter(s => norm(s.province) === province)
      if (byProv.length === 1) return byProv[0]
    }
    return null
  }

  if (row.mode === 'airport') {
    const thaiKeyword = AIRPORT_EN_TO_THAI[norm(row.name_en)]
    if (!thaiKeyword) return null
    // DB airport nameTh is "ท่าอากาศยานXXX [N]" — strip and match keyword prefix
    const hits = candidates.filter(s => {
      const stripped = stripAirport(s.nameTh)
      return stripped === thaiKeyword || stripped.startsWith(thaiKeyword)
    })
    // Prefer exact match (not " 1" variant) but take any if only 1
    const exact = hits.filter(s => stripAirport(s.nameTh) === thaiKeyword)
    if (exact.length === 1) return exact[0]
    if (hits.length === 1) return hits[0]
    return null
  }

  return null
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  // Load all DB stations once
  const allStations = await prisma.station.findMany({
    select: {
      id: true, nameTh: true, province: true,
      mode: true, railSubtype: true, coordSource: true,
    },
  })

  // Index by mode key for O(1) lookup
  const dbByMode = {}
  for (const s of allStations) {
    const key = s.railSubtype ? `${s.mode}/${s.railSubtype}` : s.mode
    if (!dbByMode[key]) dbByMode[key] = []
    dbByMode[key].push(s)
  }

  let updated = 0
  let alreadyOfficial = 0
  const unmatched = []

  for (const row of staging) {
    if (row.coord_status !== 'OK') continue
    if (!row.lat || !row.lng) continue

    const match = matchStation(row, dbByMode)
    if (!match) {
      unmatched.push({ mode: row.mode, name_th: row.name_th, name_en: row.name_en, province_th: row.province_th, source_id: row.source_id })
      continue
    }

    // Never downgrade existing OFFICIAL coords
    if (match.coordSource === 'OFFICIAL') {
      alreadyOfficial++
      continue
    }

    await prisma.station.update({
      where: { id: match.id },
      data: {
        lat:         row.lat,
        lng:         row.lng,
        coordSource: 'OFFICIAL',
        coordStatus: 'OK',
        sourceFile:  row.source,
        sourceId:    String(row.source_id),
      },
    })
    updated++
  }

  // ── verification queries ──────────────────────────────────────────────────
  const dist = await prisma.$queryRaw`
    SELECT "coordStatus", "coordSource", COUNT(*) AS n
    FROM "Station"
    GROUP BY "coordStatus", "coordSource"
    ORDER BY n DESC
  `
  const bkk = await prisma.$queryRaw`
    SELECT COUNT(*) AS n FROM "Station"
    WHERE lat = 13.7563 AND lng = 100.5018
  `
  const shared = await prisma.$queryRaw`
    SELECT lat::text, lng::text, COUNT(*) AS n
    FROM "Station"
    WHERE lat IS NOT NULL AND lng IS NOT NULL
    GROUP BY lat, lng
    HAVING COUNT(*) > 1
    ORDER BY n DESC
    LIMIT 5
  `

  // ── unmatched breakdown ───────────────────────────────────────────────────
  const unmatchedByMode = {}
  for (const r of unmatched) {
    unmatchedByMode[r.mode] = (unmatchedByMode[r.mode] || 0) + 1
  }

  // ── APPROXIMATE stations (no official coord found) ────────────────────────
  const approxByMode = await prisma.$queryRaw`
    SELECT mode, "railSubtype", COUNT(*) AS n
    FROM "Station"
    WHERE "coordStatus" = 'APPROXIMATE'
    GROUP BY mode, "railSubtype"
    ORDER BY n DESC
  `

  const report = {
    updated,
    alreadyOfficial,
    unmatchedTotal: unmatched.length,
    unmatchedByMode,
    coordStatusDist: dist.map(r => ({ ...r, n: Number(r.n) })),
    bangkokCentroidRemaining: Number(bkk[0].n),
    topSharedPoints: shared.map(r => ({ lat: r.lat, lng: r.lng, n: Number(r.n) })),
    approximateByMode: approxByMode.map(r => ({ mode: r.mode, railSubtype: r.railSubtype, n: Number(r.n) })),
    unmatchedSamples: unmatched.slice(0, 20),
  }

  const outFile = path.join(__dirname, 'seed-official-coords-report.json')
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8')
  console.log(JSON.stringify(report, null, 2))

  await prisma.$disconnect()
}

main().catch(e => { console.error(e.message); process.exit(1) })
