'use client'

import * as React from 'react'
import {
  mockStations,
  checklistTemplates,
  getChecklistTemplate,
  getTransportLabel,
  type ChecklistGroup,
  type ChecklistValue,
} from '@/lib/mock-data'
import { ChevronLeft, Download, Send, Save, Upload, FileText, AlertCircle, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react'
import Link from 'next/link'

// ---- Value button styles ----
const VALUE_STYLES: Record<string, string> = {
  'มี':            'bg-blue-50 text-blue-700 border-blue-200',
  'ไม่มี':         'bg-red-50 text-red-600 border-red-200',
  'ได้มาตรฐาน':   'bg-green-50 text-green-700 border-green-200',
}
const VALUE_OPTIONS: ChecklistValue[] = ['มี', 'ไม่มี', 'ได้มาตรฐาน']

// ---- Score Circle ----
function ScoreCircle({ score }: { score: number }) {
  const r = 36
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - score / 100)
  const color = score >= 75 ? '#52aa4e' : score >= 50 ? '#ffc107' : '#f44336'
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="90" height="90" viewBox="0 0 90 90">
        <circle cx="45" cy="45" r={r} fill="none" stroke="var(--secondary)" strokeWidth="7" />
        <circle cx="45" cy="45" r={r} fill="none" stroke={color} strokeWidth="7"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          transform="rotate(-90 45 45)" style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
        <text x="45" y="50" textAnchor="middle" fontSize="18" fontWeight="bold" fill={color}>{score}</text>
      </svg>
      <p className="text-muted-foreground text-xs">คะแนน UD</p>
    </div>
  )
}

// ---- Bulk Import Modal ----
type ImportResult = { row: number; id: string; label: string; value: string; valid: boolean; error?: string }

function BulkImportModal({
  onClose,
  onApply,
  groups,
}: {
  onClose: () => void
  onApply: (updates: Record<string, ChecklistValue>) => void
  groups: ChecklistGroup[]
}) {
  const [tab, setTab] = React.useState<'paste' | 'file'>('paste')
  const [csvText, setCsvText] = React.useState('')
  const [results, setResults] = React.useState<ImportResult[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)

  // Build lookup: sub_group_id → label for validation feedback
  const itemLookup = React.useMemo(() => {
    const map: Record<string, string> = {}
    groups.forEach(g => g.items.forEach(i => { map[i.id] = i.labelTh }))
    return map
  }, [groups])

  const VALID_VALUES = new Set(['มี', 'ไม่มี', 'ได้มาตรฐาน'])

  function parseCsv(text: string): ImportResult[] {
    const lines = text.trim().split('\n').filter(l => l.trim())
    // Skip header if present
    const dataLines = lines[0]?.toLowerCase().includes('id') ? lines.slice(1) : lines
    return dataLines.map((line, idx) => {
      const [rawId, rawValue] = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''))
      const id = rawId ?? ''
      const value = rawValue ?? ''
      const label = itemLookup[id]
      if (!label) return { row: idx + 1, id, label: '—', value, valid: false, error: `ไม่พบรหัส "${id}"` }
      if (!VALID_VALUES.has(value)) return { row: idx + 1, id, label, value, valid: false, error: `ค่า "${value}" ไม่ถูกต้อง` }
      return { row: idx + 1, id, label, value, valid: true }
    })
  }

  function handleParse() {
    setError(null)
    if (!csvText.trim()) { setError('กรุณาวางข้อมูล CSV ก่อน'); return }
    setResults(parseCsv(csvText))
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      setCsvText(text)
      setResults(parseCsv(text))
    }
    reader.readAsText(file)
  }

  function handleApply() {
    if (!results) return
    const updates: Record<string, ChecklistValue> = {}
    results.filter(r => r.valid).forEach(r => { updates[r.id] = r.value as ChecklistValue })
    onApply(updates)
    onClose()
  }

  const validCount = results?.filter(r => r.valid).length ?? 0
  const errorCount = results?.filter(r => !r.valid).length ?? 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-card border-border flex h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border shadow-2xl">

        {/* Header */}
        <div className="border-border flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-foreground text-base font-bold">นำเข้าข้อมูล Checklist (Bulk Import)</h2>
            <p className="text-muted-foreground mt-0.5 text-xs">รองรับไฟล์ CSV รูปแบบ: sub_group_id, ค่า (มี/ไม่มี/ได้มาตรฐาน)</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-lg leading-none">✕</button>
        </div>

        {/* Body */}
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">

          {/* Tab switcher */}
          <div className="border-border flex gap-1 rounded-lg border p-1">
            {(['paste', 'file'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                  tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'
                }`}
              >
                {t === 'paste' ? '📋 วาง CSV' : '📁 อัปโหลดไฟล์'}
              </button>
            ))}
          </div>

          {tab === 'paste' ? (
            <div className="space-y-2">
              <label className="text-foreground text-xs font-medium">วางข้อมูล CSV ที่นี่</label>
              <textarea
                className="border-input bg-background placeholder:text-muted-foreground focus:ring-ring w-full rounded-lg border p-3 font-mono text-xs focus:outline-none focus:ring-1"
                rows={8}
                placeholder={`sub_group_id,value\nA1.1,มี\nA1.2,ได้มาตรฐาน\nB2.1,ไม่มี`}
                value={csvText}
                onChange={e => { setCsvText(e.target.value); setResults(null) }}
              />
              <button
                onClick={handleParse}
                className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-xs font-medium"
              >
                ตรวจสอบข้อมูล
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="text-foreground text-xs font-medium">เลือกไฟล์ CSV</label>
              <div
                onClick={() => fileRef.current?.click()}
                className="border-border hover:bg-secondary flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed py-10 transition-colors"
              >
                <Upload size={24} className="text-muted-foreground" />
                <p className="text-foreground text-sm font-medium">คลิกเพื่อเลือกไฟล์</p>
                <p className="text-muted-foreground text-xs">รองรับ .csv เท่านั้น</p>
                <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
              </div>

              {/* CSV Format reference */}
              <div className="bg-secondary/50 rounded-lg p-3">
                <p className="text-foreground mb-2 text-xs font-semibold">รูปแบบไฟล์ CSV</p>
                <pre className="text-muted-foreground text-[11px] leading-relaxed">{`sub_group_id,value\nA1.1,มี\nA1.2,ได้มาตรฐาน\nB2.1,ไม่มี`}</pre>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
              <AlertCircle size={13} /> {error}
            </div>
          )}

          {/* Results preview */}
          {results && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1 text-green-700">
                  <CheckCircle2 size={13} /> {validCount} รายการถูกต้อง
                </span>
                {errorCount > 0 && (
                  <span className="flex items-center gap-1 text-red-600">
                    <AlertCircle size={13} /> {errorCount} รายการผิดพลาด
                  </span>
                )}
              </div>
              <div className="border-border overflow-hidden rounded-lg border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-secondary/40 border-border border-b">
                      <th className="text-muted-foreground px-3 py-2 text-left font-medium">แถว</th>
                      <th className="text-muted-foreground px-3 py-2 text-left font-medium">รหัส</th>
                      <th className="text-muted-foreground px-3 py-2 text-left font-medium">รายการ</th>
                      <th className="text-muted-foreground px-3 py-2 text-left font-medium">ค่า</th>
                      <th className="text-muted-foreground px-3 py-2 text-left font-medium">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map(r => (
                      <tr key={r.row} className={`border-border border-b last:border-0 ${r.valid ? '' : 'bg-red-50/30'}`}>
                        <td className="text-muted-foreground px-3 py-2">{r.row}</td>
                        <td className="px-3 py-2 font-mono">{r.id}</td>
                        <td className="text-foreground px-3 py-2">{r.label}</td>
                        <td className="px-3 py-2">
                          {r.valid ? (
                            <span className={`rounded-full px-2 py-0.5 font-medium ${VALUE_STYLES[r.value] ?? ''}`}>{r.value}</span>
                          ) : (
                            <span className="text-red-500">{r.value || '—'}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {r.valid
                            ? <span className="text-green-600">✓ ถูกต้อง</span>
                            : <span className="text-red-500">✗ {r.error}</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-border flex items-center justify-end gap-3 border-t px-6 py-4">
          <button onClick={onClose} className="border-border text-muted-foreground hover:bg-secondary rounded-lg border px-4 py-2 text-xs">
            ยกเลิก
          </button>
          <button
            onClick={handleApply}
            disabled={!results || validCount === 0}
            className="bg-primary text-primary-foreground disabled:opacity-40 rounded-lg px-4 py-2 text-xs font-medium"
          >
            นำเข้า {validCount > 0 ? `${validCount} รายการ` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- Main Page ----
export default function StationChecklistPage({ params }: { params: { id: string } }) {
  const station = mockStations.find(s => s.id === params.id) ?? mockStations[0]!
  const [groups, setGroups] = React.useState<ChecklistGroup[]>(() => getChecklistTemplate(station.mode))
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>({ A1: true })
  const [showImport, setShowImport] = React.useState(false)

  // Flatten all items for score calc
  const allItems = groups.flatMap(g => g.items)
  const answered = allItems.filter(i => i.value !== null).length
  const score = allItems.length > 0
    ? Math.round((allItems.filter(i => i.value === 'มี' || i.value === 'ได้มาตรฐาน').length / allItems.length) * 100)
    : 0

  function toggleGroup(id: string) {
    setOpenGroups(prev => ({ ...prev, [id]: !prev[id] }))
  }

  function setItemValue(groupId: string, itemId: string, value: ChecklistValue) {
    setGroups(prev => prev.map(g =>
      g.groupId !== groupId ? g : {
        ...g,
        items: g.items.map(i => i.id === itemId ? { ...i, value } : i),
      }
    ))
  }

  function applyBulkImport(updates: Record<string, ChecklistValue>) {
    setGroups(prev => prev.map(g => ({
      ...g,
      items: g.items.map(i => i.id in updates ? { ...i, value: updates[i.id]! } : i),
    })))
  }

  const transportLabel = getTransportLabel(station)

  return (
    <div className="space-y-6">
      {showImport && (
        <BulkImportModal
          groups={groups}
          onClose={() => setShowImport(false)}
          onApply={applyBulkImport}
        />
      )}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/stations" className="text-muted-foreground hover:text-foreground mb-2 flex items-center gap-1 text-xs">
            <ChevronLeft size={13} /> กลับรายการสถานี
          </Link>
          <h1 className="text-foreground text-xl font-bold">{station.nameTh}</h1>
          <div className="mt-1 flex items-center gap-2">
            <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium">{station.mode}</span>
            {station.railSubtype && (
              <span className="bg-accent/10 text-accent rounded-full px-2 py-0.5 text-xs font-medium">{station.railSubtype}</span>
            )}
            <span className="text-muted-foreground text-xs">{station.province}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="border-border text-foreground hover:bg-secondary flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors"
          >
            <Upload size={13} /> นำเข้าข้อมูล CSV
          </button>
          <button className="border-border text-muted-foreground hover:bg-secondary flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors">
            <Save size={13} /> บันทึกร่าง
          </button>
          <button className="border-border text-muted-foreground hover:bg-secondary flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors">
            <Download size={13} /> ส่งออก
          </button>
          <button className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-opacity">
            <Send size={13} /> ส่งรายงาน
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        {/* Checklist groups */}
        <div className="space-y-3 lg:col-span-3">
          {groups.map(group => {
            const groupAnswered = group.items.filter(i => i.value !== null).length
            const isOpen = openGroups[group.groupId] ?? false
            return (
              <div key={group.groupId} className="bg-card border-border overflow-hidden rounded-xl border">
                {/* Group header — clickable to collapse */}
                <button
                  onClick={() => toggleGroup(group.groupId)}
                  className="hover:bg-secondary/30 flex w-full items-center justify-between px-5 py-3.5 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground bg-secondary rounded px-2 py-0.5 font-mono text-[10px] font-bold">
                      {group.groupId}
                    </span>
                    <span className="text-foreground text-sm font-semibold text-left">{group.groupName}</span>
                    <span className="text-muted-foreground text-xs">
                      {groupAnswered}/{group.items.length}
                    </span>
                  </div>
                  {isOpen
                    ? <ChevronUp size={14} className="text-muted-foreground shrink-0" />
                    : <ChevronDown size={14} className="text-muted-foreground shrink-0" />
                  }
                </button>

                {/* Items */}
                {isOpen && (
                  <div className="divide-border divide-y border-t">
                    {group.items.map(item => (
                      <div key={item.id} className="flex items-center justify-between gap-4 px-5 py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground bg-secondary shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]">
                              {item.id}
                            </span>
                            <p className="text-foreground text-sm leading-snug">{item.labelTh}</p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {VALUE_OPTIONS.map(opt => (
                            <button
                              key={opt!}
                              onClick={() => setItemValue(group.groupId, item.id, opt)}
                              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                                item.value === opt
                                  ? VALUE_STYLES[opt!]
                                  : 'border-border text-muted-foreground hover:bg-secondary'
                              }`}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Score panel */}
        <div className="space-y-4 lg:col-span-1">
          <div className="bg-card border-border rounded-xl border p-5">
            <h2 className="text-foreground mb-4 text-sm font-semibold">สรุปคะแนน</h2>
            <div className="flex flex-col items-center gap-4">
              <ScoreCircle score={score} />
              <div className="w-full space-y-2 text-xs">
                {[
                  { label: 'ตอบแล้ว', value: `${answered}/${allItems.length}`, color: '' },
                  { label: 'ผ่านมาตรฐาน', value: String(allItems.filter(i => i.value === 'มี' || i.value === 'ได้มาตรฐาน').length), color: 'text-[#52aa4e]' },
                  { label: 'ไม่ผ่าน', value: String(allItems.filter(i => i.value === 'ไม่มี').length), color: 'text-[#f44336]' },
                  { label: 'ยังไม่ตอบ', value: String(allItems.filter(i => i.value === null).length), color: 'text-muted-foreground' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-muted-foreground">{label}</span>
                    <span className={`font-medium ${color || 'text-foreground'}`}>{value}</span>
                  </div>
                ))}
              </div>
              <div className="w-full">
                <div className="mb-1 flex justify-between text-[10px]">
                  <span className="text-muted-foreground">ความคืบหน้า</span>
                  <span className="text-foreground">{allItems.length > 0 ? Math.round((answered / allItems.length) * 100) : 0}%</span>
                </div>
                <div className="bg-secondary h-1.5 w-full overflow-hidden rounded-full">
                  <div className="bg-accent h-full rounded-full transition-all"
                    style={{ width: `${allItems.length > 0 ? (answered / allItems.length) * 100 : 0}%` }} />
                </div>
              </div>
            </div>
          </div>

          {/* Station info */}
          <div className="bg-card border-border rounded-xl border p-5 text-xs">
            <h2 className="text-foreground mb-3 text-sm font-semibold">ข้อมูลสถานี</h2>
            <div className="space-y-2">
              {[
                { label: 'ประเภทการขนส่ง', value: station.mode },
                ...(station.railSubtype ? [{ label: 'ประเภทราง', value: station.railSubtype }] : []),
                { label: 'จังหวัด', value: station.province },
                { label: 'ภาค', value: station.region },
                { label: 'ตรวจล่าสุด', value: station.lastInspected ?? '—' },
                { label: 'รายการทั้งหมด', value: `${allItems.length} ข้อ` },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between gap-2">
                  <span className="text-muted-foreground shrink-0">{label}</span>
                  <span className="text-foreground text-right font-medium">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Import hint */}
          <button
            onClick={() => setShowImport(true)}
            className="border-border hover:bg-secondary flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors"
          >
            <div className="bg-primary/10 rounded-lg p-2">
              <FileText size={16} className="text-primary" />
            </div>
            <div>
              <p className="text-foreground text-xs font-medium">นำเข้าข้อมูลจาก CSV</p>
              <p className="text-muted-foreground text-[10px]">อัปเดตหลายรายการพร้อมกัน</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}
