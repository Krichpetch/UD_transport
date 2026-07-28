export function TemplateStatusBadge({ status }: { status: 'DRAFT' | 'ACTIVE' | 'RETIRED' | string }) {
  const map: Record<string, string> = {
    ACTIVE: 'bg-[#52aa4e]/10 text-[#52aa4e]',
    DRAFT: 'bg-[#ffc107]/10 text-[#b38600]',
    RETIRED: 'bg-secondary text-muted-foreground',
  }
  const label: Record<string, string> = {
    ACTIVE: 'ใช้งานอยู่',
    DRAFT: 'ฉบับร่าง',
    RETIRED: 'เลิกใช้',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[status] ?? 'bg-secondary text-muted-foreground'}`}>
      {label[status] ?? status}
    </span>
  )
}
