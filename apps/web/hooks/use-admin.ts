'use client'

import { useQuery } from '@tanstack/react-query'
import { getAdminOverview } from '@/lib/api/admin'

export function useAdminOverview() {
  return useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: getAdminOverview,
  })
}
