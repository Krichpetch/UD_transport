import * as React from 'react'

export default function AuditLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="from-theme-gradient-start to-theme-gradient-end min-h-screen overflow-x-hidden bg-linear-to-br">
      <div className="mx-auto max-w-2xl px-4 py-6">{children}</div>
    </div>
  )
}
