import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'
import { cn } from '@/lib/utils'

const lineSeed = localFont({
  src: [
    {
      path: './fonts/LINESeedSansTH_W_Rg.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: './fonts/LINESeedSansTH_W_Bd.woff2',
      weight: '700',
      style: 'normal',
    },
    {
      path: './fonts/LINESeedSansTH_W_XBd.woff2',
      weight: '800',
      style: 'normal',
    },
  ],
  variable: '--font-sans',
})

export const metadata: Metadata = {
  title: 'UD Transport — ระบบสิ่งอำนวยความสะดวกด้านคมนาคมขนส่ง',
  description: 'ระบบฐานข้อมูลติดตามสิ่งอำนวยความสะดวกด้านคมนาคมขนส่งสำหรับคนทุกคน — กระทรวงคมนาคม',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="th" className={cn('font-sans', lineSeed.variable)}>
      <body>{children}</body>
    </html>
  )
}
