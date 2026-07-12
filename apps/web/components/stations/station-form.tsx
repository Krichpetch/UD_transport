'use client'

import * as React from 'react'
import type { TransportMode } from '@repo/types'
import { TRANSPORT_MODES, RAIL_SUBTYPES } from '@repo/types'
import { INPUT_CLS, SELECT_CLS } from '@/lib/ui-classes'

export interface StationFormValue {
  nameTh: string
  mode: TransportMode
  railSubtype?: string
  province: string
  region: string
  responsibleAgency: string
  lat: number | null
  lng: number | null
}

interface StationFormPlaceholders {
  nameTh?: string
  province?: string
  region?: string
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

// Presentation-only: nameTh/mode/railSubtype/province/region/responsibleAgency, the 2-col
// grid, the region/agency datalists, the rail-subtype conditional. No fetch calls, no save
// logic, no checklist-seeding, no coordStatus logic — callers own all of that.
//
// Coordinates (lat/lng) are a separate export below, NOT bundled into this component: the
// create and edit flows place the lat/lng inputs in different positions relative to the map
// picker (edit has one between the agency field and the coordinates; create doesn't), so
// fusing them here would force a field-order change in one of the two call sites.
export function StationForm({
  value, onChange, disabled, placeholders, hideNameTh,
  regionOptions = [], agencyOptions = [],
}: StationFormBaseProps & { regionOptions?: string[]; agencyOptions?: string[]; hideNameTh?: boolean }) {
  const regionsListId = React.useId()
  const agenciesListId = React.useId()

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
            onChange={(e) => onChange({ mode: e.target.value as TransportMode, railSubtype: undefined })}
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
              onChange={(e) => onChange({ railSubtype: e.target.value || undefined })}
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

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-foreground mb-1 block text-xs font-medium">จังหวัด *</label>
          <input
            className={INPUT_CLS}
            value={value.province}
            onChange={(e) => onChange({ province: e.target.value })}
            placeholder={placeholders?.province}
            disabled={disabled}
            required
          />
        </div>
        <div>
          <label className="text-foreground mb-1 block text-xs font-medium">ภาค *</label>
          <input
            className={INPUT_CLS}
            value={value.region}
            list={regionsListId}
            onChange={(e) => onChange({ region: e.target.value })}
            placeholder={placeholders?.region}
            disabled={disabled}
            required
          />
          <datalist id={regionsListId}>
            {regionOptions.map((r) => <option key={r} value={r} />)}
          </datalist>
        </div>
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
