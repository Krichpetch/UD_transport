// Official operator brand colors for the metro/rail lines carried in Station.line
// (SRT/BTS/MRT), as supplied by the client. Keyed to the exact Thai strings stored in
// the masterlist (apps/api/prisma/seed-data/stations_master_v2.json) — a line with no
// entry here (or none at all) falls back to the caller's default styling.
export const LINE_COLORS: Record<string, string> = {
  'สายแดงเข้ม': '#E10506',
  'สายแดงอ่อน': '#F4777F',
  'แอร์พอร์ตเรลลิงก์': '#901030',
  'สายเขียว (สุขุมวิท)': '#77CC00',
  'สายเขียว (สีลม)': '#246B5B',
  'สายสีน้ำเงิน': '#1964B7',
  'สายสีม่วง': '#800080',
  'สายสีชมพู': '#FF69B4',
  'สายสีเหลือง': '#FFCC33',
  'สายสีทอง': '#D4AF37',
}

export function getLineColor(line?: string | null): string | undefined {
  if (!line) return undefined
  return LINE_COLORS[line]
}
