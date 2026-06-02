import * as React from 'react'

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="bg-background flex w-1/4 flex-col items-center justify-center gap-4 rounded p-6">
        <div className="flex flex-col items-center">
          <div className="bg-primary size-24 shrink-0 rounded-full" />
          <h1 className="py-3 text-2xl font-bold">กระทรวงคมนาคม</h1>
          <p className="text-muted-foreground text-center text-sm">
            ระบบฐานข้อมูลติดตามสิ่งอำนวยความสะดวก
          </p>
          <p className="text-muted-foreground text-center text-sm">ด้านคมนาคมขนส่งสาหรับคนทุกคน</p>
        </div>
        <div className="w-full space-y-3">
          <div className="flex flex-col gap-2">
            <p className="text-primary font-medium">ชื่อผู้ใช้งาน</p>
            <input
              type="text"
              className="border-input w-full rounded border bg-transparent px-3 py-2"
            />
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-primary font-medium">รหัสผ่าน</p>
            <input
              type="password"
              className="border-input w-full rounded border bg-transparent px-3 py-2"
            />
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-primary font-medium">ระดับผู้ใช้งาน</p>
            <input
              type="text"
              className="border-input w-full rounded border bg-transparent px-3 py-2"
            />
          </div>
        </div>
        <div className="w-full">
          <button className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring w-full rounded-md px-4 py-3 text-sm font-medium focus-visible:ring-1 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50">
            ลงชื่อเข้าใช้
          </button>
        </div>
      </div>
    </div>
  )
}
