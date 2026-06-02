import * as React from 'react'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="from-theme-gradient-start to-theme-gradient-end flex min-h-screen flex-col bg-linear-to-br">
      <div className="container mx-auto flex-1 items-center justify-center py-8">{children}</div>
    </div>
  )
}
