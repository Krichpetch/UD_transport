export const TRANSPORT_MODES = ['ทางบก', 'ทางราง', 'ทางเรือ', 'ทางอากาศ'] as const
export type TransportMode = typeof TRANSPORT_MODES[number]

export const RAIL_SUBTYPES = ['รถไฟ', 'รถไฟฟ้า'] as const
export type RailSubtype = typeof RAIL_SUBTYPES[number]

export const STATION_STATUSES = ['ผ่านมาตรฐาน', 'ต้องปรับปรุง', 'ไม่ผ่าน'] as const
export type StationStatus = typeof STATION_STATUSES[number]
