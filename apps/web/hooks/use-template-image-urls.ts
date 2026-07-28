'use client'

import { useQuery } from '@tanstack/react-query'
import { presignTemplateImage } from '@/lib/api/templates'

// Template reference images are read via the same presign-on-every-read convention as
// checklist evidence photos (never a stored/persisted URL — see uploads.controller.ts's
// PRESIGN_KEY_PREFIXES). One query per distinct key set (13 templates, at most 3 images per
// node, so this never fans out into anything expensive).
export function useTemplateImageUrls(keys: string[]) {
  return useQuery({
    queryKey: ['admin', 'templates', 'image-urls', ...keys],
    queryFn: async () => {
      const entries = await Promise.all(keys.map(async (key) => [key, (await presignTemplateImage(key)).url] as const))
      return Object.fromEntries(entries) as Record<string, string>
    },
    enabled: keys.length > 0,
  })
}
