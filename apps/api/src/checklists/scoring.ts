// Single source of truth lives in @repo/types (shared with apps/web) so the
// server and every UI surface compute scores with the exact same formula.
export { computeScoreFromItems, scoreToStatus, buildHistogram, hasReviewFlag } from '@repo/types'
export type { ValueHistogram } from '@repo/types'
