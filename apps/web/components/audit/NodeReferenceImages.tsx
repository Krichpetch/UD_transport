'use client'

import type { TemplateNode } from '@repo/types'
import { useTemplateImageUrls } from '@/hooks/use-template-image-urls'
import { ChecklistPhotoGallery } from '@/components/checklist/ChecklistPhotoGallery'

// Admin-attached reference images (W2-S3a Part D), shown INLINE on the form wherever the node
// that carries them renders — after its label/category name, before its answer controls or
// sub-questions. Most images are attached at the AX.X item level (a container's own imageKeys),
// not on drilled-down sub-criteria, but this same component is used at every level so an image
// shows up correctly regardless of where an admin actually attached it. Read-only: no onDelete,
// per ChecklistPhotoGallery's dual-mode convention.
export function NodeReferenceImages({ node, className }: { node: TemplateNode; className?: string }) {
  const imageKeys = node.imageKeys ?? []
  const { data: imageUrls } = useTemplateImageUrls(imageKeys)
  if (imageKeys.length === 0) return null

  const photos = imageKeys
    .map((key) => ({ id: key, url: imageUrls?.[key] ?? '', filename: key.split('/').pop() ?? key, uploadedAt: '' }))
    .filter((p) => p.url)
  if (photos.length === 0) return null

  return (
    <div className={className}>
      <ChecklistPhotoGallery photos={photos} />
    </div>
  )
}
