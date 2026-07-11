export const USER_ROLES = ['AUDITOR', 'ADMIN', 'EXECUTIVE'] as const
export type UserRole = typeof USER_ROLES[number]
