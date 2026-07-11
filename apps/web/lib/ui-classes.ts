// Shared Tailwind class strings for plain (non-shadcn) form controls, deduped
// across pages that build ad hoc filter bars / forms. Only byte-identical
// strings live here — see stations/page.tsx's FILTER_SELECT_TRIGGER_CLS vs
// dashboard/page.tsx's SELECT_TRIGGER_CLS, which have drifted (different
// padding/font-size) and are deliberately NOT merged.

export const INPUT_CLS =
  'border-input bg-background placeholder:text-muted-foreground focus:ring-ring w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1'

export const SELECT_CLS =
  'border-input bg-background text-foreground focus:ring-ring w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1'

// Radix Select forbids an empty-string item value (reserved to mean "no selection"),
// so the "ทั้งหมด/ทุก..." (all/any) option uses this sentinel instead of ''.
export const ALL_VALUE = '__all__'
