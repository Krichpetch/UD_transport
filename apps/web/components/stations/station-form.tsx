'use client'

import * as React from 'react'
import type { TransportMode } from '@repo/types'
import { TRANSPORT_MODES, RAIL_SUBTYPES, PROVINCE_REGION } from '@repo/types'
import { INPUT_CLS, SELECT_CLS } from '@/lib/ui-classes'

// The 77 Thai provinces — same canonical source StationsService.create/update's region
// derivation uses server-side (@repo/types#deriveRegion), so the picker never offers a
// province spelling that would fail to resolve to a region.
const PROVINCE_OPTIONS = Object.keys(PROVINCE_REGION)

export interface StationFormValue {
  nameTh: string
  mode: TransportMode
  railSubtype?: string
  // Session F3, Part A.5 — line/route (สาย). Part of the (mode, nameTh, line) identity key, so a
  // clash is reported by the API as STATION_IDENTITY_CONFLICT naming the conflicting station.
  // '' is a real value (the "no line" sentinel), not "unset".
  line?: string
  province: string
  responsibleAgency: string
  lat: number | null
  lng: number | null
}

interface StationFormPlaceholders {
  nameTh?: string
  province?: string
  responsibleAgency?: string
  lat?: string
  lng?: string
}

interface StationFormBaseProps {
  value: StationFormValue
  onChange: (patch: Partial<StationFormValue>) => void
  disabled?: boolean
  placeholders?: StationFormPlaceholders
}

// Presentation-only: nameTh/mode/railSubtype/province/responsibleAgency, the 2-col
// grid, the agency datalist, the rail-subtype conditional. No fetch calls, no save
// logic, no checklist-seeding, no coordStatus logic — callers own all of that.
//
// region is NOT a field here (Session E4) — it's a derived attribute computed server-side from
// coordinates (or province as a fallback) by StationsService.create/update, never user input.
//
// Coordinates (lat/lng) are a separate export below, NOT bundled into this component: the
// create and edit flows place the lat/lng inputs in different positions relative to the map
// picker (edit has one between the agency field and the coordinates; create doesn't), so
// fusing them here would force a field-order change in one of the two call sites.
export function StationForm({
  value, onChange, disabled, placeholders, hideNameTh,
  agencyOptions = [],
}: StationFormBaseProps & { agencyOptions?: string[]; hideNameTh?: boolean }) {
  const agenciesListId = React.useId()
  const provincesListId = React.useId()

  return (
    <>
      {/* create pairs nameTh with an English-name field this component doesn't know about
          (not one of the shared fields) — it renders its own grid row and passes hideNameTh */}
      {!hideNameTh && (
        <div>
          <label className="text-foreground mb-1 block text-xs font-medium">ชื่อสถานี (ภาษาไทย) *</label>
          <input
            className={INPUT_CLS}
            value={value.nameTh}
            onChange={(e) => onChange({ nameTh: e.target.value })}
            placeholder={placeholders?.nameTh}
            disabled={disabled}
            required
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-foreground mb-1 block text-xs font-medium">ประเภทการขนส่ง *</label>
          <select
            className={SELECT_CLS}
            value={value.mode}
            onChange={(e) => onChange({ mode: e.target.value as TransportMode, railSubtype: undefined, line: undefined })}
            disabled={disabled}
            required
          >
            {TRANSPORT_MODES.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        {value.mode === 'ทางราง' && (
          <div>
            <label className="text-foreground mb-1 block text-xs font-medium">ประเภทย่อย</label>
            <select
              className={SELECT_CLS}
              value={value.railSubtype ?? ''}
              onChange={(e) => {
                const next = e.target.value || undefined
                onChange({ railSubtype: next, ...(next !== 'รถไฟฟ้า' ? { line: undefined } : {}) })
              }}
              disabled={disabled}
            >
              <option value="">ไม่ระบุ</option>
              {RAIL_SUBTYPES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Session F3, Part A.5 — line/route. Free text, not a dropdown: the canonical list is
          whatever the masterlist carries, and an admin correcting a station may legitimately need
          a value that doesn't exist yet. Blank means "no line", which is a valid identity.
          Only meaningful for รถไฟฟ้า (metro) today — every other mode/subtype is cleared via the
          mode/railSubtype onChange handlers above, mirroring the admin filter bar and auditor
          picker's line-control visibility. */}
      {value.mode === 'ทางราง' && value.railSubtype === 'รถไฟฟ้า' && (
        <div>
          <label className="text-foreground mb-1 block text-xs font-medium">สาย / เส้นทาง</label>
          <input
            className={INPUT_CLS}
            value={value.line ?? ''}
            onChange={(e) => onChange({ line: e.target.value })}
            placeholder="เช่น สายสีเขียว (เว้นว่างหากไม่มี)"
            disabled={disabled}
          />
        </div>
      )}

      <div>
        <label className="text-foreground mb-1 block text-xs font-medium">จังหวัด *</label>
        <input
          className={INPUT_CLS}
          value={value.province}
          list={provincesListId}
          onChange={(e) => onChange({ province: e.target.value })}
          placeholder={placeholders?.province}
          disabled={disabled}
          required
        />
        <datalist id={provincesListId}>
          {PROVINCE_OPTIONS.map((p) => <option key={p} value={p} />)}
        </datalist>
      </div>

      <div>
        <label className="text-foreground mb-1 block text-xs font-medium">หน่วยงานรับผิดชอบ *</label>
        <input
          className={INPUT_CLS}
          value={value.responsibleAgency}
          list={agenciesListId}
          onChange={(e) => onChange({ responsibleAgency: e.target.value })}
          placeholder={placeholders?.responsibleAgency}
          disabled={disabled}
          required
        />
        <datalist id={agenciesListId}>
          {agencyOptions.map((a) => <option key={a} value={a} />)}
        </datalist>
      </div>
    </>
  )
}

// Split out of StationForm — see the comment above for why. requireCoordinates controls
// both the `required` attribute and whether the labels show the `*` suffix: create requires
// lat/lng up front, edit doesn't (a station may already have coordinates from another source).
export function StationCoordinateFields({
  value, onChange, disabled, placeholders, requireCoordinates = true,
}: StationFormBaseProps & { requireCoordinates?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="text-foreground mb-1 block text-xs font-medium">
          ละติจูด{requireCoordinates ? ' *' : ''}
        </label>
        <input
          type="number"
          step="any"
          className={INPUT_CLS}
          value={value.lat ?? ''}
          onChange={(e) => onChange({ lat: e.target.value === '' ? null : parseFloat(e.target.value) })}
          placeholder={placeholders?.lat}
          disabled={disabled}
          required={requireCoordinates}
        />
      </div>
      <div>
        <label className="text-foreground mb-1 block text-xs font-medium">
          ลองจิจูด{requireCoordinates ? ' *' : ''}
        </label>
        <input
          type="number"
          step="any"
          className={INPUT_CLS}
          value={value.lng ?? ''}
          onChange={(e) => onChange({ lng: e.target.value === '' ? null : parseFloat(e.target.value) })}
          placeholder={placeholders?.lng}
          disabled={disabled}
          required={requireCoordinates}
        />
      </div>
    </div>
  )
}
