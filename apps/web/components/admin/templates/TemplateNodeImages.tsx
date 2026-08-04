'use client'

import * as React from 'react'
import type { TemplateNode } from '@repo/types'
import { Loader2, Upload } from 'lucide-react'
import { useTemplateImageUrls } from '@/hooks/use-template-image-urls'
import { useAddTemplateImage, useRemoveTemplateImage } from '@/hooks/use-templates-admin'
import { ChecklistPhotoGallery } from '@/components/checklist/ChecklistPhotoGallery'

const MAX_IMAGES = 3

export function TemplateNodeImages({ templateId, node, readOnly }: { templateId: string; node: TemplateNode; readOnly: boolean }) {
  const keys = node.imageKeys ?? []
  const { data: urls } = useTemplateImageUrls(keys)
  const addImage = useAddTemplateImage(templateId)
  const removeImage = useRemoveTemplateImage(templateId)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  // id = the MinIO key itself — same convention uploads.controller.ts's /uploads/photo response
  // already uses for checklist evidence photos, so ChecklistPhotoGallery's onDelete(photo) can
  // hand photo.id straight to removeTemplateImage without a second lookup.
  const photos = keys
    .map((key) => ({ id: key, url: urls?.[key] ?? '', filename: key.split('/').pop() ?? key, uploadedAt: '' }))
    .filter((p) => p.url)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) addImage.mutate({ nodeCode: node.code, file })
    e.target.value = ''
  }

  return (
    <div className="border-border mt-3 border-t pt-3">
      <p className="text-foreground mb-2 text-xs font-semibold">
        รูปภาพประกอบ ({keys.length}/{MAX_IMAGES})
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
        {!readOnly && keys.length < MAX_IMAGES && (
          <>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFile} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={addImage.isPending}
              className="border-border text-muted-foreground hover:text-foreground flex items-center gap-1 rounded-lg border border-dashed px-2 py-1.5 text-[11px] disabled:opacity-50"
            >
              {addImage.isPending ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              เพิ่มรูป
            </button>
          </>
        )}
      </div>
      {addImage.isError && <p className="mt-1 text-[11px] text-red-500">{(addImage.error as Error).message}</p>}
    </div>
  )
}
