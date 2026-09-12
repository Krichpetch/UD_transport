// Plain label:value stat tile — the smaller sibling of the icon-chip KPI cards on the main
// dashboard / admin overview (those stay bespoke since they carry status color-coding + an
// icon). Used across the admin template-editor sub-pages, previously copy-pasted per file.
export function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-card border-border rounded-lg border p-4">
      <p className="text-muted-foreground text-xs uppercase">{label}</p>
      <p className="text-foreground text-2xl font-bold">{value}</p>
    </div>
  )
}
