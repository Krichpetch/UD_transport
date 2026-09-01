import type { Metadata } from 'next'
import localFont from 'next/font/local'
import { cookies } from 'next/headers'
import './globals.css'
import 'leaflet/dist/leaflet.css'
import { cn } from '@/lib/utils'
import { Providers } from './providers'
import { FONT_SCALE_COOKIE, normalizeFontScale } from '@/lib/font-scale'

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
  description:
    'ระบบฐานข้อมูลติดตามสิ่งอำนวยความสะดวกด้านคมนาคมขนส่งสำหรับคนทุกคน — สำนักงานนโยบายและแผนการขนส่งและจราจร ',
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Read the persisted font-size preference so the scale is applied during SSR
  // (no flash). Client updates it live from Settings — see lib/font-scale.ts.
  const fontScale = normalizeFontScale((await cookies()).get(FONT_SCALE_COOKIE)?.value)

  return (
    <html
      lang="th"
      data-font-scale={fontScale}
      className={cn('font-sans', lineSeed.variable)}
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
