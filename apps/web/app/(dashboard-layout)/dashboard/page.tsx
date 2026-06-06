import * as React from 'react'
import { mockKpi, mockStations, getTransportLabel } from '@/lib/mock-data'
import { StationBarChart } from '@/components/charts/StationBarChart'
import { ThailandMap } from '@/components/maps/ThailandMap'
import { TrendingUp, TrendingDown, Building2, CheckCircle2, AlertTriangle, XCircle, AlertCircle } from 'lucide-react'

// ---- Helpers ----
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string }> = {
    'ผ่านมาตรฐาน': { bg: 'bg-[#52aa4e]/10 text-[#52aa4e]', text: 'ผ่านมาตรฐาน' },
    'ต้องปรับปรุง': { bg: 'bg-[#ffc107]/10 text-[#b38600]', text: 'ต้องปรับปรุง' },
    'ไม่ผ่าน': { bg: 'bg-[#f44336]/10 text-[#f44336]', text: 'ไม่ผ่าน' },
  }
  const s = map[status] ?? { bg: 'bg-secondary text-muted-foreground', text: status }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.bg}`}>
      {s.text}
    </span>
  )
}

function TransportBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    'รถโดยสาร': 'bg-blue-50 text-blue-700',
    'รถไฟ': 'bg-purple-50 text-purple-700',
    'เรือโดยสาร': 'bg-cyan-50 text-cyan-700',
    'สนามบิน': 'bg-orange-50 text-orange-700',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[type] ?? 'bg-secondary text-muted-foreground'}`}>
      {type}
    </span>
  )
}

// ---- Page ----
export default function DashboardPage() {
  const urgentStations = mockStations.filter((s) => s.status === 'ไม่ผ่าน' || s.urgentIssues.length > 0)

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-foreground text-xl font-bold">ภาพรวมระบบ</h1>
        <p className="text-muted-foreground text-sm">
          ข้อมูล ณ วันที่ 4 มิถุนายน 2569 · สถานี 831 แห่งทั่วประเทศ
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* Total */}
        <div className="bg-card border-border rounded-xl border p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">สถานีทั้งหมด</p>
            <div className="bg-primary/10 rounded-lg p-1.5">
              <Building2 size={14} className="text-primary" />
            </div>
          </div>
          <p className="text-foreground text-3xl font-bold">{mockKpi.totalStations.toLocaleString()}</p>
          <p className="text-muted-foreground mt-1 text-xs">ครอบคลุมทุกประเภท</p>
        </div>

        {/* Passing */}
        <div className="bg-card border-border rounded-xl border p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">ผ่านมาตรฐาน</p>
            <div className="rounded-lg bg-[#52aa4e]/10 p-1.5">
              <CheckCircle2 size={14} className="text-[#52aa4e]" />
            </div>
          </div>
          <p className="text-3xl font-bold text-[#52aa4e]">{mockKpi.passing.toLocaleString()}</p>
          <div className="mt-1 flex items-center gap-1">
            <TrendingUp size={11} className="text-[#52aa4e]" />
            <p className="text-muted-foreground text-xs">{mockKpi.passRate}% ของทั้งหมด</p>
          </div>
        </div>

        {/* Needs improvement */}
        <div className="bg-card border-border rounded-xl border p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">ต้องปรับปรุง</p>
            <div className="rounded-lg bg-[#ffc107]/10 p-1.5">
              <AlertTriangle size={14} className="text-[#ffc107]" />
            </div>
          </div>
          <p className="text-3xl font-bold text-[#ffc107]">{mockKpi.needsImprovement.toLocaleString()}</p>
          <p className="text-muted-foreground mt-1 text-xs">รอการแก้ไข</p>
        </div>

        {/* Failing */}
        <div className="bg-card border-border rounded-xl border p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">ไม่ผ่านมาตรฐาน</p>
            <div className="rounded-lg bg-[#f44336]/10 p-1.5">
              <XCircle size={14} className="text-[#f44336]" />
            </div>
          </div>
          <p className="text-3xl font-bold text-[#f44336]">{mockKpi.failing.toLocaleString()}</p>
          <div className="mt-1 flex items-center gap-1">
            <TrendingDown size={11} className="text-[#f44336]" />
            <p className="text-muted-foreground text-xs">ต้องดำเนินการเร่งด่วน</p>
          </div>
        </div>
      </div>

      {/* Main content: Chart + Map */}
      <div className="grid gap-4 lg:grid-cols-5">
        {/* Bar chart */}
        <div className="bg-card border-border rounded-xl border p-5 lg:col-span-3">
          <div className="mb-4">
            <h2 className="text-foreground text-sm font-semibold">สถานะสิ่งอำนวยความสะดวก แยกตามประเภทการขนส่ง</h2>
            <p className="text-muted-foreground text-xs">จำแนกตามสถานะการตรวจสอบล่าสุด</p>
          </div>
          <StationBarChart />
        </div>

        {/* Map */}
        <div className="bg-card border-border rounded-xl border p-5 lg:col-span-2">
          <div className="mb-4">
            <h2 className="text-foreground text-sm font-semibold">แผนที่สถานีทั่วประเทศ</h2>
            <p className="text-muted-foreground text-xs">แสดงสถานะตามพื้นที่</p>
          </div>
          <div className="h-[260px]">
            <ThailandMap />
          </div>
        </div>
      </div>

      {/* Urgent + Table */}
      <div className="grid gap-4 lg:grid-cols-5">
        {/* Urgent stations */}
        <div className="bg-card border-border rounded-xl border p-5 lg:col-span-2">
          <div className="mb-4 flex items-center gap-2">
            <AlertCircle size={14} className="text-[#f44336]" />
            <h2 className="text-foreground text-sm font-semibold">สถานีที่ต้องดำเนินการเร่งด่วน</h2>
          </div>
          <div className="space-y-3">
            {urgentStations.slice(0, 5).map((station) => (
              <div key={station.id} className="border-border rounded-lg border p-3">
                <div className="mb-1.5 flex items-start justify-between gap-2">
                  <p className="text-foreground text-xs font-medium leading-snug">{station.nameTh}</p>
                  <StatusBadge status={station.status} />
                </div>
                <p className="text-muted-foreground mb-2 text-[10px]">{station.province} · {getTransportLabel(station)}</p>
                {station.urgentIssues.length > 0 && (
                  <ul className="space-y-0.5">
                    {station.urgentIssues.map((issue, i) => (
                      <li key={i} className="text-muted-foreground flex items-start gap-1 text-[10px]">
                        <span className="mt-1 size-1 shrink-0 rounded-full bg-[#f44336]" />
                        {issue}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Station table */}
        <div className="bg-card border-border rounded-xl border lg:col-span-3">
          <div className="border-border flex items-center justify-between border-b px-5 py-4">
            <h2 className="text-foreground text-sm font-semibold">รายการสถานี</h2>
            <a href="/stations" className="text-accent text-xs hover:underline">
              ดูทั้งหมด →
            </a>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-border border-b">
                  <th className="text-muted-foreground px-5 py-2.5 text-left font-medium">ชื่อสถานี</th>
                  <th className="text-muted-foreground px-3 py-2.5 text-left font-medium">ประเภท</th>
                  <th className="text-muted-foreground px-3 py-2.5 text-right font-medium">คะแนน</th>
                  <th className="text-muted-foreground px-5 py-2.5 text-left font-medium">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {mockStations.map((station, i) => (
                  <tr
                    key={station.id}
                    className="border-border hover:bg-secondary/50 border-b transition-colors last:border-0"
                  >
                    <td className="px-5 py-3">
                      <p className="text-foreground font-medium">{station.nameTh}</p>
                      <p className="text-muted-foreground">{station.province}</p>
                    </td>
                    <td className="px-3 py-3">
                      <TransportBadge type={getTransportLabel(station)} />
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span
                        className="font-bold"
                        style={{
                          color: station.score >= 75 ? 'var(--status-pass)' : station.score >= 50 ? 'var(--status-warn)' : 'var(--status-fail)',
                        }}
                      >
                        {station.score}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <StatusBadge status={station.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}