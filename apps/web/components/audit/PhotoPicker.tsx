'use client'

import * as React from 'react'
import { Camera, Loader2, Upload, X, Plus } from 'lucide-react'
import { uploadPhoto } from '@/lib/api/uploads'
import type { ChecklistPhoto } from '@repo/types'

type PhotoStatus = 'pending' | 'uploading' | 'done' | 'failed'

interface PendingPhoto {
  id: string
  file: File
  preview: string
  status: PhotoStatus
  result?: ChecklistPhoto
}

interface Props {
  onPhotosUploaded: (photos: ChecklistPhoto[]) => void
  disabled?: boolean
}

const MAX_DIM = 1920
const JPEG_QUALITY = 0.82

async function compressImage(file: File): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image()
    const src = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(src)
      const { width, height } = img
      if (width <= MAX_DIM && height <= MAX_DIM) { resolve(file); return }
      const ratio  = Math.min(MAX_DIM / width, MAX_DIM / height)
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(width  * ratio)
      canvas.height = Math.round(height * ratio)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return }
          // Sanitise filename: replace non-ASCII / special chars so HTTP headers stay clean
          const safeName = file.name.replace(/[^\w.฀-๿-]/g, '_')
          resolve(new File([blob], safeName, { type: 'image/jpeg' }))
        },
        'image/jpeg',
        JPEG_QUALITY,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(src); resolve(file) }
    img.src = src
  })
}

export function PhotoPicker({ onPhotosUploaded, disabled = false }: Props) {
  const [photos,    setPhotos]   = React.useState<PendingPhoto[]>([])
  const [open,      setOpen]     = React.useState(false)
  const [uploading, setUploading] = React.useState(false)

  // Track all object URLs so we can revoke on unmount
  const previewUrls = React.useRef<string[]>([])
  React.useEffect(() => () => { previewUrls.current.forEach(URL.revokeObjectURL) }, [])

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const next: PendingPhoto[] = Array.from(files).map(file => {
      const preview = URL.createObjectURL(file)
      previewUrls.current.push(preview)
      return { id: `${Date.now()}-${Math.random()}`, file, preview, status: 'pending' as const }
    })
    setPhotos(prev => [...prev, ...next])
    setOpen(true)
  }

  function removePhoto(id: string) {
    setPhotos(prev => prev.filter(p => p.id !== id))
  }

  function cancel() {
    setPhotos([])
    setOpen(false)
  }

  async function uploadOne(photo: PendingPhoto): Promise<PendingPhoto> {
    setPhotos(prev => prev.map(p => p.id === photo.id ? { ...p, status: 'uploading' as const } : p))
    try {
      const compressed = await compressImage(photo.file)
      const result     = await uploadPhoto(compressed)
      const done: PendingPhoto = { ...photo, status: 'done', result }
      setPhotos(prev => prev.map(p => p.id === photo.id ? done : p))
      return done
    } catch {
      const failed: PendingPhoto = { ...photo, status: 'failed' }
      setPhotos(prev => prev.map(p => p.id === photo.id ? failed : p))
      return failed
    }
  }

  async function confirm() {
    const toUpload = photos.filter(p => p.status === 'pending' || p.status === 'failed')
    if (toUpload.length === 0) return

    setUploading(true)
    const results = await Promise.all(toUpload.map(uploadOne))
    setUploading(false)

    const succeeded = results.filter(p => p.status === 'done' && p.result != null).map(p => p.result!)
    if (succeeded.length > 0) onPhotosUploaded(succeeded)

    if (results.every(r => r.status === 'done')) {
      setPhotos([])
      setOpen(false)
    }
    // If any failed, overlay stays open so auditor can retry the failed ones
  }

  const pendingCount = photos.filter(p => p.status === 'pending' || p.status === 'failed').length
  const doneCount    = photos.filter(p => p.status === 'done').length

  const triggerCls = `flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors ${
    disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-secondary'
  }`

  // ---- Trigger buttons (no confirmation overlay open) ----
  if (!open) {
    return (
      <div className="mt-2.5 flex gap-2">
        <label className={triggerCls}>
          <Camera size={12} />
          ถ่ายภาพ
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            disabled={disabled}
            onChange={(e) => { addFiles(e.target.files); e.currentTarget.value = '' }}
          />
        </label>
        <label className={triggerCls}>
          <Plus size={12} />
          เลือกรูป
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            disabled={disabled}
            onChange={(e) => { addFiles(e.target.files); e.currentTarget.value = '' }}
          />
        </label>
      </div>
    )
  }

  // ---- Confirmation overlay ----
  return (
    <div className="mt-2.5 overflow-hidden rounded-xl border border-border bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <p className="text-xs font-semibold text-gray-800">
          {photos.length} รูปภาพ
          {doneCount > 0 && ` · อัปโหลดแล้ว ${doneCount}`}
        </p>
        <button
          onClick={cancel}
          disabled={uploading}
          className="text-muted-foreground disabled:opacity-40"
        >
          <X size={14} />
        </button>
      </div>

      {/* Thumbnail grid */}
      <div className="flex flex-wrap gap-2 p-3">
        {photos.map(photo => (
          <div key={photo.id} className="relative">
            <img
              src={photo.preview}
              alt=""
              className={`size-16 rounded-lg border object-cover ${
                photo.status === 'done'      ? 'border-green-400 opacity-80' :
                photo.status === 'failed'    ? 'border-red-400'              :
                photo.status === 'uploading' ? 'border-blue-300'             :
                'border-border'
              }`}
            />
            {photo.status === 'uploading' && (
              <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/30">
                <Loader2 size={16} className="animate-spin text-white" />
              </div>
            )}
            {photo.status === 'done' && (
              <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-green-500/20">
                <span className="text-xs font-bold text-green-700">✓</span>
              </div>
            )}
            {photo.status === 'failed' && (
              <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-red-500/20">
                <span className="px-0.5 text-center text-[9px] font-bold leading-tight text-red-700">ล้มเหลว</span>
              </div>
            )}
            {/* Remove button — only for photos not yet uploaded */}
            {(photo.status === 'pending' || photo.status === 'failed') && !uploading && (
              <button
                onClick={() => removePhoto(photo.id)}
                className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-gray-700 text-white"
              >
                <X size={9} />
              </button>
            )}
          </div>
        ))}

        {/* Add more from gallery */}
        {!uploading && (
          <label className="flex size-16 cursor-pointer items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:bg-secondary">
            <Plus size={18} />
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => { addFiles(e.target.files); e.currentTarget.value = '' }}
            />
          </label>
        )}
      </div>

      {/* Action bar */}
      <div className="flex gap-2 border-t px-3 py-2">
        <button
          onClick={confirm}
          disabled={uploading || pendingCount === 0}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#1a3557] py-2 text-xs font-semibold text-white disabled:opacity-50"
        >
          {uploading
            ? <><Loader2 size={12} className="animate-spin" /> กำลังอัปโหลด…</>
            : <><Upload size={12} /> {`อัปโหลด ${pendingCount} รูปภาพ`}</>
          }
        </button>
        {!uploading && (
          <button
            onClick={cancel}
            className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground"
          >
            ยกเลิก
          </button>
        )}
      </div>
    </div>
  )
}
