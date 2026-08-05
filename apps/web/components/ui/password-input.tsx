'use client'

import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

// Matches the raw <input> classes used by the username/text fields on the
// login and settings pages (not components/ui/input.tsx — that one carries
// shadcn's own shadow/ring/dark-mode classes that don't fully get overridden
// by a merged className, so the two fields ended up looking inconsistent).
const FIELD_CLASSES =
  'border-input bg-background placeholder:text-muted-foreground focus:ring-ring w-full rounded-lg border px-3 py-2.5 pr-10 text-sm focus:ring-2 focus:outline-none disabled:opacity-50'

function PasswordInput({ className, ...props }: Omit<React.ComponentProps<'input'>, 'type'>) {
  const [visible, setVisible] = React.useState(false)

  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        className={cn(FIELD_CLASSES, className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        tabIndex={-1}
        title={visible ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
        className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 transition-colors"
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  )
}

export { PasswordInput }
