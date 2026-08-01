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

// Shared Dialog header convention — a bordered header block (px-6 py-4) holding a text-lg
// title, used by every centered-modal-with-fixed-header-and-footer in the app (station
// add/import, station edit, template node editor). DialogTitle's own shadcn default is
// text-sm — every dialog that wants the app's normal title size overrides it with
// DIALOG_TITLE_CLS rather than picking its own size, which is how the template editor's
// modal ended up a size smaller than the rest of the app (Session F2, Part E).
export const DIALOG_HEADER_CLS = 'border-border shrink-0 border-b px-6 py-4'
export const DIALOG_TITLE_CLS = 'text-lg'
