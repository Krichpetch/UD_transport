'use client'

import * as React from 'react'
import { ChevronLeft, ChevronRight, Loader2, Trash2, X } from 'lucide-react'
import type { ChecklistPhoto } from '@repo/types'

const VISIBLE = 3

// ── Carousel lightbox ──────────────────────────────────────────
export function PhotoLightbox({
  photos,
  startIndex,
  onClose,
  onDelete,
}: {
  photos: ChecklistPhoto[]
  startIndex: number
  onClose: () => void
  // Session E3, Part C.2/C.3 — auditors get a delete action on their own photos, reusing this
  // same viewer rather than a second one; admins (no onDelete passed) stay read-only.
  onDelete?: (photo: ChecklistPhoto) => void | Promise<void>
}) {
  const [idx, setIdx] = React.useState(startIndex)
  const [deleting, setDeleting] = React.useState(false)
  const total = photos.length
  const photo = photos[idx]

  // Reacts to the PARENT's photos array actually shrinking (after a successful delete mutation
  // re-renders with one fewer photo) rather than guessing the post-delete index up front.
  React.useEffect(() => {
    if (total === 0) { onClose(); return }
    if (idx > total - 1) setIdx(total - 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total])

  // Scroll lock
  React.useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  // Keyboard
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape')      onClose()
      if (e.key === 'ArrowLeft'  && idx > 0)           setIdx(i => i - 1)
      if (e.key === 'ArrowRight' && idx < total - 1)   setIdx(i => i + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [idx, total, onClose])

  // The shrink-driven effect above closes the lightbox on the render where total hits 0; this
  // guards the one render in between (photo briefly undefined) without skipping any hook above.
  if (!photo) return null

  async function handleDelete() {
    if (!onDelete || deleting || !photo) return
    setDeleting(true)
    try {
      await onDelete(photo)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Counter */}
      <p className="absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-black/40 px-3 py-1 text-xs text-white/80">
        {idx + 1} / {total}
      </p>

      {/* Close */}
      <button
        onClick={onClose}
        className="absolute right-4 top-4 flex size-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
      >
        <X size={16} />
      </button>

      {/* Prev */}
      <button
        disabled={idx === 0}
        onClick={e => { e.stopPropagation(); setIdx(i => i - 1) }}
        className="absolute left-4 flex size-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-20"
      >
        <ChevronLeft size={24} />
      </button>

      {/* Image */}
      <div className="relative max-h-[85vh] max-w-[80vw]" onClick={e => e.stopPropagation()}>
        <img
          src={photo.url}
          alt={photo.filename}
          loading="lazy"
          className="max-h-[85vh] max-w-[80vw] rounded-xl object-contain shadow-2xl"
        />
        <div className="mt-2 flex items-center justify-center gap-3">
          <p className="text-center text-xs text-white/50">{photo.filename}</p>
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); void handleDelete() }}
              disabled={deleting}
              className="flex items-center gap-1 rounded-full bg-red-500/20 px-2 py-0.5 text-[11px] font-medium text-red-200 hover:bg-red-500/30 disabled:opacity-50"
            >
              {deleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
              ลบรูปนี้
            </button>
          )}
        </div>
      </div>

      {/* Next */}
      <button
        disabled={idx === total - 1}
        onClick={e => { e.stopPropagation(); setIdx(i => i + 1) }}
        className="absolute right-4 flex size-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-20"
      >
        <ChevronRight size={24} />
      </button>
    </div>
  )
}

// ── Thumbnail strip — max VISIBLE + "+N" overflow ──────────────
export function ChecklistPhotoGallery({ photos, onDelete }: {
  photos: ChecklistPhoto[]
  onDelete?: (photo: ChecklistPhoto) => void | Promise<void>
}) {
  const [lightboxIdx, setLightboxIdx] = React.useState<number | null>(null)
  const btnRefs = React.useRef<(HTMLButtonElement | null)[]>([])

  if (photos.length === 0) {
    return <span className="text-[10px] text-muted-foreground/40">—</span>
  }

  const visible  = photos.slice(0, VISIBLE)
  const overflow = photos.length - VISIBLE

  function open(i: number) { setLightboxIdx(i) }

  function close() {
    const trigger = lightboxIdx !== null ? (btnRefs.current[Math.min(lightboxIdx, VISIBLE - 1)] ?? null) : null
    setLightboxIdx(null)
    trigger?.focus()
  }

  return (
    <>
      <div className="flex items-center gap-1">
        {visible.map((p, i) => {
          const showOverlay = i === VISIBLE - 1 && overflow > 0
          return (
            <button
              key={p.id}
              ref={el => { btnRefs.current[i] = el }}
              onClick={() => open(i)}
              className="relative size-8 shrink-0 overflow-hidden rounded border border-border shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/60"
            >
              <img src={p.url} alt={p.filename} loading="lazy" className="size-full object-cover" />
              {showOverlay && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-[10px] font-bold text-white">
                  +{overflow}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {lightboxIdx !== null && (
        <PhotoLightbox
          photos={photos}
          startIndex={lightboxIdx}
          onClose={close}
          onDelete={onDelete}
        />
      )}
    </>
  )
}
