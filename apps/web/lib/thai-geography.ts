// Moved to @repo/types (Session E4) so apps/api can derive Station.region from the same data —
// re-exported here so existing imports (./thai-geography, lib/constants.ts) keep working.
export {
  PROVINCE_REGION,
  PROVINCE_COORDS,
  AMPHOE_TO_PROVINCE,
  canonicalProvince,
  nearestProvince,
  deriveRegion,
} from '@repo/types'
