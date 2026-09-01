import * as React from 'react'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="from-theme-gradient-start to-theme-gradient-end flex min-h-dvh flex-col bg-linear-to-br">
      <div className="container mx-auto flex flex-1 items-center justify-center px-4 py-8">
        {children}
      </div>
    </div>
  )
}
