export const USER_ROLES = ['AUDITOR', 'ADMIN', 'EXECUTIVE', 'REVIEWER'] as const
export type UserRole = typeof USER_ROLES[number]
