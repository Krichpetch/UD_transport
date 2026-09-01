'use client'

import * as React from 'react'
import type { TemplateNode } from '@repo/types'
import { Loader2, Upload } from 'lucide-react'
import { useTemplateImageUrls } from '@/hooks/use-template-image-urls'
import { useAddTemplateImage, useRemoveTemplateImage } from '@/hooks/use-templates-admin'
import { ChecklistPhotoGallery } from '@/components/checklist/ChecklistPhotoGallery'
import { MAX_TEMPLATE_IMAGES_PER_NODE } from '@/lib/api/templates'

export function TemplateNodeImages({ templateId, node, readOnly }: { templateId: string; node: TemplateNode; readOnly: boolean }) {
  const keys = node.imageKeys ?? []
  const { data: urls } = useTemplateImageUrls(keys)
  const addImage = useAddTemplateImage(templateId)
  const removeImage = useRemoveTemplateImage(templateId)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // id = the MinIO key itself — same convention uploads.controller.ts's /uploads/photo response
  // already uses for checklist evidence photos, so ChecklistPhotoGallery's onDelete(photo) can
  // hand photo.id straight to removeTemplateImage without a second lookup.
  const photos = keys
    .map((key) => ({ id: key, url: urls?.[key] ?? '', filename: key.split('/').pop() ?? key, uploadedAt: '' }))
    .filter((p) => p.url)

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    const toUpload = files.slice(0, MAX_TEMPLATE_IMAGES_PER_NODE - keys.length)
    setUploading(true)
    setError(null)
    try {
      // Sequential, not Promise.all — the add-image endpoint does a plain read-modify-write of
      // the node's imageKeys array with no optimistic locking, so parallel uploads to the same
      // node would race and silently drop keys.
      for (const file of toUpload) {
        await addImage.mutateAsync({ nodeCode: node.code, file })
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="border-border mt-3 border-t pt-3">
      <p className="text-foreground mb-2 text-xs font-semibold">
        รูปภาพประกอบ ({keys.length}/{MAX_TEMPLATE_IMAGES_PER_NODE})
      </p>
      {/* Session F3, Part E.2 — the admin sees the images at the SAME size the auditor will, so
          "is this legible in the field?" is answerable here rather than only after publishing.
          Same 'reference' variant the E-form uses; delete stays available via the lightbox. */}
      <div className="flex flex-col items-start gap-2">
        <ChecklistPhotoGallery
          photos={photos}
          variant="reference"
          onDelete={readOnly ? undefined : async (photo) => { await removeImage.mutateAsync({ nodeCode: node.code, key: photo.id }) }}
        />
        {!readOnly && keys.length < MAX_TEMPLATE_IMAGES_PER_NODE && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => void handleFiles(e)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="border-border text-muted-foreground hover:text-foreground flex items-center gap-1 rounded-lg border border-dashed px-2 py-1.5 text-2xs disabled:opacity-50"
            >
              {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              เพิ่มรูป
            </button>
          </>
        )}
      </div>
      {error && <p className="mt-1 text-2xs text-red-500">{error}</p>}
    </div>
  )
}
