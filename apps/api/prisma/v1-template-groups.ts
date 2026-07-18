// E-form redesign (Session E1, Part A.3.1) — the CURRENT (pre-E1) checklist item structure,
// transcribed from apps/web/lib/constants.ts#checklistTemplates (groupId/groupName + item
// id/labelTh pairs only — NOT the runtime ChecklistSubItem defaults like value/meetsStandard/
// photos, which are answer-time state, not form structure).
//
// This is a deliberate, one-time data duplication, not a shared runtime dependency: apps/api
// must not import from apps/web. Kept here so prisma/seed-templates.ts can convert it into the
// v1 ACTIVE ChecklistTemplate.definition rows byte-for-byte (item-for-item, code-for-code) with
// today's live form. If apps/web/lib/constants.ts#checklistTemplates ever changes, this file must
// be updated to match — the v1 parity gate (scoring.spec.ts-equivalent fixture tests) will not
// catch that drift on its own; only a manual comparison will.
//
// Counts (must match CLAUDE.md / DATA_DICTIONARY_v2.md §4 "old system" row): land 65, rail 73,
// water 26, air 55.

export interface V1GroupSource {
  code: string
  labelTh: string
  items: { code: string; labelTh: string }[]
}

export const V1_TEMPLATE_GROUPS: Record<'ทางบก' | 'ทางราง' | 'ทางเรือ' | 'ทางอากาศ', V1GroupSource[]> = {
  ทางบก: [
    { code: 'A1', labelTh: 'ที่จอดรถ', items: [
      { code: 'A1.1', labelTh: 'ที่จอดรถสำหรับคนพิการ' },
      { code: 'A1.2', labelTh: 'ป้ายแสดงอุปกรณ์หรือสิ่งอำนวยความสะดวกสำหรับคนพิการ' },
      { code: 'A1.3', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูเตือน (Warning Tactile)' },
      { code: 'A1.4', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูนำทาง (Guiding Tactile)' },
      { code: 'A1.5', labelTh: 'พื้นผิวต่างสัมผัส ชนิดเปลี่ยนทิศทาง (Positioning Tactile)' },
      { code: 'A1.6', labelTh: 'ทางลาดขอบถนน (ทางลาดตัดคันหิน)' },
    ] },
    { code: 'A2', labelTh: 'การเชื่อมต่อและการเข้าถึงระบบขนส่งสาธารณะอื่น ๆ', items: [
      { code: 'A2.1', labelTh: 'ป้ายแสดงอุปกรณ์หรือสิ่งอำนวยความสะดวกสำหรับคนพิการ' },
      { code: 'A2.2', labelTh: 'ทางลาดสำหรับคนพิการ' },
      { code: 'A2.3', labelTh: 'บันไดสำหรับคนพิการและผู้สูงอายุ' },
      { code: 'A2.4', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูเตือน (Warning Tactile)' },
      { code: 'A2.5', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูนำทาง (Guiding Tactile)' },
      { code: 'A2.6', labelTh: 'พื้นผิวต่างสัมผัส ชนิดเปลี่ยนทิศทาง (Positioning Tactile)' },
      { code: 'A2.7', labelTh: 'ทางลาดขอบถนน (ทางลาดตัดคันหิน)' },
      { code: 'A2.8', labelTh: 'จุดจอดรับ-ส่งคนพิการ' },
      { code: 'A2.9', labelTh: 'หลังคาป้องกันแดดและฝน' },
    ] },
    { code: 'B1', labelTh: 'พื้นที่โถงผู้โดยสารและที่จำหน่ายตั๋ว', items: [
      { code: 'B1.1', labelTh: 'ประตูสำหรับคนพิการ' },
      { code: 'B1.2', labelTh: 'ช่องขายตั๋ว/ช่องเก็บตั๋วสำหรับคนพิการ (เคาน์เตอร์)' },
      { code: 'B1.3', labelTh: 'สถานที่ติดต่อประชาสัมพันธ์สำหรับคนพิการ' },
      { code: 'B1.4', labelTh: 'การประกาศข้อมูล/ตัวอักษรไฟวิ่งสำหรับคนพิการ' },
      { code: 'B1.5', labelTh: 'การประกาศเตือนภัย/สัญญาณไฟเตือนสำหรับคนพิการ' },
      { code: 'B1.6', labelTh: 'ที่นั่งสำหรับคนพิการ ผู้สูงอายุ และเด็ก' },
      { code: 'B1.7', labelTh: 'พื้นที่จอดรถเข็นคนพิการ (Wheelchair)' },
      { code: 'B1.8', labelTh: 'ทางลาดสำหรับคนพิการ' },
      { code: 'B1.9', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูเตือน (Warning Tactile)' },
      { code: 'B1.10', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูนำทาง (Guiding Tactile)' },
      { code: 'B1.11', labelTh: 'พื้นผิวต่างสัมผัส ชนิดเปลี่ยนทิศทาง (Positioning Tactile)' },
      { code: 'B1.12', labelTh: 'ป้ายแสดงอุปกรณ์สำหรับคนพิการ' },
      { code: 'B1.13', labelTh: 'แผนที่การเดินทางสำหรับคนพิการทางการเห็น' },
      { code: 'B1.14', labelTh: 'โทรศัพท์สาธารณะสำหรับคนพิการ' },
      { code: 'B1.15', labelTh: 'จุดบริการน้ำดื่มสำหรับคนพิการ' },
      { code: 'B1.16', labelTh: 'ตู้บริการเงินด่วนสำหรับคนพิการ' },
      { code: 'B1.17', labelTh: 'ตู้ไปรษณีย์สำหรับคนพิการ' },
      { code: 'B1.18', labelTh: 'เครื่องบริการถ่ายทอดการสื่อสารสาธารณะ (ITTRS)' },
    ] },
    { code: 'B2', labelTh: 'ห้องน้ำ', items: [
      { code: 'B2.1', labelTh: 'ห้องน้ำสำหรับคนพิการและผู้สูงอายุ' },
      { code: 'B2.2', labelTh: 'สัญญาณเสียง/สัญญาณแสงขอความช่วยเหลือสำหรับคนพิการ' },
      { code: 'B2.3', labelTh: 'ที่เปลี่ยนผ้าอ้อมสำหรับเด็ก' },
      { code: 'B2.4', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูเตือน (Warning Tactile)' },
      { code: 'B2.5', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูนำทาง (Guiding Tactile)' },
      { code: 'B2.6', labelTh: 'พื้นผิวต่างสัมผัส ชนิดเปลี่ยนทิศทาง (Positioning Tactile)' },
    ] },
    { code: 'B3', labelTh: 'ลิฟต์', items: [
      { code: 'B3.1', labelTh: 'ลิฟต์ภายในสถานีขนส่งผู้โดยสาร' },
      { code: 'B3.2', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูเตือน (Warning Tactile)' },
      { code: 'B3.3', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูนำทาง (Guiding Tactile)' },
      { code: 'B3.4', labelTh: 'พื้นผิวต่างสัมผัส ชนิดเปลี่ยนทิศทาง (Positioning Tactile)' },
    ] },
    { code: 'B4', labelTh: 'บันได', items: [
      { code: 'B4.1', labelTh: 'บันไดสำหรับคนพิการและผู้สูงอายุ' },
      { code: 'B4.2', labelTh: 'บันไดเลื่อนสำหรับคนพิการ' },
      { code: 'B4.3', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูเตือน (Warning Tactile)' },
      { code: 'B4.4', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูนำทาง (Guiding Tactile)' },
      { code: 'B4.5', labelTh: 'พื้นผิวต่างสัมผัส ชนิดเปลี่ยนทิศทาง (Positioning Tactile)' },
    ] },
    { code: 'B5', labelTh: 'พื้นที่หนีภัย/พื้นที่หลบภัย', items: [
      { code: 'B5.1', labelTh: 'พื้นที่หนีภัย/หลบภัยสำหรับคนพิการ' },
      { code: 'B5.2', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูเตือน (Warning Tactile)' },
      { code: 'B5.3', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูนำทาง (Guiding Tactile)' },
      { code: 'B5.4', labelTh: 'พื้นผิวต่างสัมผัส ชนิดเปลี่ยนทิศทาง (Positioning Tactile)' },
    ] },
    { code: 'B6', labelTh: 'พื้นที่ชานชาลา', items: [
      { code: 'B6.1', labelTh: 'ที่นั่งสำหรับคนพิการ ผู้สูงอายุ และเด็ก' },
      { code: 'B6.2', labelTh: 'พื้นที่จอดรถเข็นคนพิการ (Wheelchair)' },
      { code: 'B6.3', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูเตือน (Warning Tactile)' },
      { code: 'B6.4', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูนำทาง (Guiding Tactile)' },
      { code: 'B6.5', labelTh: 'พื้นผิวต่างสัมผัส ชนิดเปลี่ยนทิศทาง (Positioning Tactile)' },
      { code: 'B6.6', labelTh: 'ป้ายแสดงอุปกรณ์สำหรับคนพิการ' },
      { code: 'B6.7', labelTh: 'อุปกรณ์นำพาคนพิการ/รถเข็นขึ้น-ลงจากรถ' },
      { code: 'B6.8', labelTh: 'การประกาศข้อมูล/ตัวอักษรไฟวิ่งสำหรับคนพิการ' },
      { code: 'B6.9', labelTh: 'การประกาศเตือนภัย/สัญญาณไฟเตือนสำหรับคนพิการ' },
      { code: 'B6.10', labelTh: 'ทางลาดสำหรับคนพิการ' },
    ] },
    { code: 'C1', labelTh: 'ความรับรู้ในการเข้าถึงฯ (Awareness)', items: [
      { code: 'C1.1', labelTh: 'คู่มือการให้ความช่วยเหลือฯ' },
      { code: 'C1.2', labelTh: 'คู่มือแปลภาษา/ป้ายสัญลักษณ์ภาษาฯ' },
    ] },
    { code: 'C2', labelTh: 'การฝึกอบรมผู้ให้บริการ (Training)', items: [
      { code: 'C2.1', labelTh: 'เจ้าหน้าที่ผ่านการฝึกอบรมอย่างน้อย 1 คน เพื่อให้บริการคนพิการ' },
    ] },
  ],

  ทางราง: [
    { code: 'A1', labelTh: 'ที่จอดรถ', items: [
      { code: 'A1.1', labelTh: 'ที่จอดรถสำหรับคนพิการ' },
      { code: 'A1.2', labelTh: 'ป้ายแสดงอุปกรณ์หรือสิ่งอำนวยความสะดวกสำหรับคนพิการ' },
      { code: 'A1.3', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูเตือน (Warning Tactile)' },
      { code: 'A1.4', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูนำทาง (Guiding Tactile)' },
      { code: 'A1.5', labelTh: 'พื้นผิวต่างสัมผัส ชนิดเปลี่ยนทิศทาง (Positioning Tactile)' },
      { code: 'A1.6', labelTh: 'ทางลาดขอบถนน (ทางลาดตัดคันหิน)' },
    ] },
    { code: 'A2', labelTh: 'การเชื่อมต่อและการเข้าถึงระบบขนส่งสาธารณะอื่น ๆ', items: [
      { code: 'A2.1', labelTh: 'ป้ายแสดงอุปกรณ์หรือสิ่งอำนวยความสะดวกสำหรับคนพิการ' },
      { code: 'A2.2', labelTh: 'ทางลาดสำหรับคนพิการ' },
      { code: 'A2.3', labelTh: 'บันไดสำหรับคนพิการและผู้สูงอายุ' },
      { code: 'A2.4', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูเตือน (Warning Tactile)' },
      { code: 'A2.5', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูนำทาง (Guiding Tactile)' },
      { code: 'A2.6', labelTh: 'พื้นผิวต่างสัมผัส ชนิดเปลี่ยนทิศทาง (Positioning Tactile)' },
      { code: 'A2.7', labelTh: 'ทางลาดขอบถนน (ทางลาดตัดคันหิน)' },
      { code: 'A2.8', labelTh: 'จุดจอดรับ-ส่งคนพิการ' },
      { code: 'A2.9', labelTh: 'หลังคาป้องกันแดดและฝน' },
    ] },
    { code: 'A3', labelTh: 'ลิฟท์ (ภายนอกสถานี)', items: [
      { code: 'A3.1', labelTh: 'ลิฟท์ภายนอกสถานีรถไฟฟ้าสำหรับคนพิการ' },
      { code: 'A3.2', labelTh: 'บันไดสำหรับคนพิการและผู้สูงอายุ' },
      { code: 'A3.3', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูเตือน (Warning Tactile)' },
      { code: 'A3.4', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูนำทาง (Guiding Tactile)' },
      { code: 'A3.5', labelTh: 'พื้นผิวต่างสัมผัส ชนิดเปลี่ยนทิศทาง (Positioning Tactile)' },
    ] },
    { code: 'B1', labelTh: 'ทางเข้า-ออก พื้นที่สถานี', items: [
      { code: 'B1.1', labelTh: 'ทางลาดสำหรับคนพิการ' },
      { code: 'B1.2', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูเตือน (Warning Tactile)' },
      { code: 'B1.3', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูนำทาง (Guiding Tactile)' },
      { code: 'B1.4', labelTh: 'พื้นผิวต่างสัมผัส ชนิดเปลี่ยนทิศทาง (Positioning Tactile)' },
      { code: 'B1.5', labelTh: 'ป้ายแสดงอุปกรณ์สำหรับคนพิการ' },
    ] },
    { code: 'B2', labelTh: 'พื้นที่โถงผู้โดยสารและที่จำหน่ายตั๋ว', items: [
      { code: 'B2.1', labelTh: 'ประตูสำหรับคนพิการ' },
      { code: 'B2.2', labelTh: 'ช่องขายตั๋ว/ช่องเก็บตั๋วสำหรับคนพิการ (เคาน์เตอร์)' },
      { code: 'B2.3', labelTh: 'สถานที่ติดต่อประชาสัมพันธ์สำหรับคนพิการ' },
      { code: 'B2.4', labelTh: 'การประกาศข้อมูล/ตัวอักษรไฟวิ่งสำหรับคนพิการ' },
      { code: 'B2.5', labelTh: 'การประกาศเตือนภัย/สัญญาณไฟเตือนสำหรับคนพิการ' },
      { code: 'B2.6', labelTh: 'ที่นั่งสำหรับคนพิการ ผู้สูงอายุ และเด็ก' },
      { code: 'B2.7', labelTh: 'พื้นที่จอดรถเข็นคนพิการ (Wheelchair)' },
      { code: 'B2.8', labelTh: 'ทางลาดสำหรับคนพิการ' },
      { code: 'B2.9', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูเตือน (Warning Tactile)' },
      { code: 'B2.10', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูนำทาง (Guiding Tactile)' },
      { code: 'B2.11', labelTh: 'พื้นผิวต่างสัมผัส ชนิดเปลี่ยนทิศทาง (Positioning Tactile)' },
      { code: 'B2.12', labelTh: 'ป้ายแสดงอุปกรณ์สำหรับคนพิการ' },
      { code: 'B2.13', labelTh: 'แผนที่การเดินทางสำหรับคนพิการทางการเห็น' },
      { code: 'B2.14', labelTh: 'โทรศัพท์สาธารณะสำหรับคนพิการ' },
      { code: 'B2.15', labelTh: 'จุดบริการน้ำดื่มสำหรับคนพิการ' },
      { code: 'B2.16', labelTh: 'ตู้บริการเงินด่วนสำหรับคนพิการ' },
      { code: 'B2.17', labelTh: 'ตู้ไปรษณีย์สำหรับคนพิการ' },
      { code: 'B2.18', labelTh: 'เครื่องบริการถ่ายทอดการสื่อสารสาธารณะ (ITTRS)' },
    ] },
    { code: 'B3', labelTh: 'ห้องน้ำ', items: [
      { code: 'B3.1', labelTh: 'ห้องน้ำสำหรับคนพิการและผู้สูงอายุ' },
      { code: 'B3.2', labelTh: 'สัญญาณเสียง/สัญญาณแสงขอความช่วยเหลือสำหรับคนพิการ' },
      { code: 'B3.3', labelTh: 'ที่เปลี่ยนผ้าอ้อมสำหรับเด็ก' },
      { code: 'B3.4', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูเตือน (Warning Tactile)' },
      { code: 'B3.5', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูนำทาง (Guiding Tactile)' },
      { code: 'B3.6', labelTh: 'พื้นผิวต่างสัมผัส ชนิดเปลี่ยนทิศทาง (Positioning Tactile)' },
    ] },
    { code: 'B4', labelTh: 'ลิฟต์ (ภายในสถานี)', items: [
      { code: 'B4.1', labelTh: 'ลิฟต์ภายในสถานีรถไฟฟ้าสำหรับคนพิการ' },
      { code: 'B4.2', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูเตือน (Warning Tactile)' },
      { code: 'B4.3', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูนำทาง (Guiding Tactile)' },
      { code: 'B4.4', labelTh: 'พื้นผิวต่างสัมผัส ชนิดเปลี่ยนทิศทาง (Positioning Tactile)' },
    ] },
    { code: 'B5', labelTh: 'บันได', items: [
      { code: 'B5.1', labelTh: 'บันไดสำหรับคนพิการและผู้สูงอายุ' },
      { code: 'B5.2', labelTh: 'บันไดเลื่อนสำหรับคนพิการ' },
      { code: 'B5.3', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูเตือน (Warning Tactile)' },
      { code: 'B5.4', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูนำทาง (Guiding Tactile)' },
      { code: 'B5.5', labelTh: 'พื้นผิวต่างสัมผัส ชนิดเปลี่ยนทิศทาง (Positioning Tactile)' },
    ] },
    { code: 'B6', labelTh: 'พื้นที่หนีภัย/พื้นที่หลบภัย', items: [
      { code: 'B6.1', labelTh: 'พื้นที่หนีภัย/หลบภัยสำหรับคนพิการ' },
      { code: 'B6.2', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูเตือน (Warning Tactile)' },
      { code: 'B6.3', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูนำทาง (Guiding Tactile)' },
      { code: 'B6.4', labelTh: 'พื้นผิวต่างสัมผัส ชนิดเปลี่ยนทิศทาง (Positioning Tactile)' },
    ] },
    { code: 'B7', labelTh: 'พื้นที่ชานชาลา', items: [
      { code: 'B7.1', labelTh: 'ที่นั่งสำหรับคนพิการ ผู้สูงอายุ และเด็ก' },
      { code: 'B7.2', labelTh: 'พื้นที่จอดรถเข็นคนพิการ (Wheelchair)' },
      { code: 'B7.3', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูเตือน (Warning Tactile)' },
      { code: 'B7.4', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูนำทาง (Guiding Tactile)' },
      { code: 'B7.5', labelTh: 'พื้นผิวต่างสัมผัส ชนิดเปลี่ยนทิศทาง (Positioning Tactile)' },
      { code: 'B7.6', labelTh: 'ป้ายแสดงอุปกรณ์สำหรับคนพิการ' },
      { code: 'B7.7', labelTh: 'อุปกรณ์นำพาคนพิการ/รถเข็นขึ้น-ลงจากรถ' },
      { code: 'B7.8', labelTh: 'การประกาศข้อมูล/ตัวอักษรไฟวิ่งสำหรับคนพิการ' },
      { code: 'B7.9', labelTh: 'การประกาศเตือนภัย/สัญญาณไฟเตือนสำหรับคนพิการ' },
      { code: 'B7.10', labelTh: 'ทางลาดสำหรับคนพิการ' },
      { code: 'B7.11', labelTh: 'ราวกันตก/ผนังกันตก/ประตูอัตโนมัติกั้นชานชาลาและราง' },
    ] },
  ],

  ทางเรือ: [
    { code: 'A1', labelTh: 'ที่จอดรถ', items: [
      { code: 'A1.1', labelTh: 'ที่จอดรถสำหรับคนพิการ' },
      { code: 'A1.2', labelTh: 'ป้ายแสดงอุปกรณ์หรือสิ่งอำนวยความสะดวกสำหรับคนพิการ' },
      { code: 'A1.3', labelTh: 'จุดจอดรถ-ส่งคนพิการ' },
    ] },
    { code: 'A2', labelTh: 'การเชื่อมต่อและการเข้าถึงระบบขนส่งสาธารณะอื่น ๆ', items: [
      { code: 'A2.1', labelTh: 'ทางลาดสำหรับคนพิการ' },
      { code: 'A2.2', labelTh: 'ป้ายแสดงอุปกรณ์หรือสิ่งอำนวยความสะดวกสำหรับคนพิการ' },
      { code: 'A2.3', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูเตือน (Warning Tactile)' },
      { code: 'A2.4', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูนำทาง (Guiding Tactile)' },
      { code: 'A2.5', labelTh: 'พื้นผิวต่างสัมผัส ชนิดเปลี่ยนทิศทาง (Positioning Tactile)' },
      { code: 'A2.6', labelTh: 'หลังคาป้องกันแดดและฝน' },
    ] },
    { code: 'B1', labelTh: 'ทางเข้า-ออก', items: [
      { code: 'B1.1', labelTh: 'ทางลาดสำหรับคนพิการ' },
      { code: 'B1.2', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูเตือน (Warning Tactile)' },
      { code: 'B1.3', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูนำทาง (Guiding Tactile)' },
      { code: 'B1.4', labelTh: 'พื้นผิวต่างสัมผัส ชนิดเปลี่ยนทิศทาง (Positioning Tactile)' },
    ] },
    { code: 'B2', labelTh: 'ที่จำหน่ายตั๋ว/การติดต่อประชาสัมพันธ์', items: [
      { code: 'B2.1', labelTh: 'ช่องขายตั๋ว/ช่องเก็บตั๋วสำหรับคนพิการ (เคาน์เตอร์)' },
      { code: 'B2.2', labelTh: 'สถานที่ติดต่อประชาสัมพันธ์สำหรับคนพิการ' },
    ] },
    { code: 'B3', labelTh: 'โถงผู้โดยสารและทางเดิน', items: [
      { code: 'B3.1', labelTh: 'ที่นั่งสำหรับคนพิการ ผู้สูงอายุ และเด็ก' },
      { code: 'B3.2', labelTh: 'พื้นที่จอดรถเข็นคนพิการ (Wheelchair)' },
      { code: 'B3.3', labelTh: 'ป้ายแสดงอุปกรณ์สำหรับคนพิการ' },
      { code: 'B3.4', labelTh: 'โทรศัพท์สาธารณะสำหรับคนพิการ' },
      { code: 'B3.5', labelTh: 'การประกาศเตือนภัย/สัญญาณไฟเตือนสำหรับคนพิการ' },
      { code: 'B3.6', labelTh: 'การประกาศข้อมูล/ตัวอักษรไฟวิ่งสำหรับคนพิการ' },
    ] },
    { code: 'B4', labelTh: 'จุดขึ้น-ลงยานพาหนะ', items: [
      { code: 'B4.1', labelTh: 'อุปกรณ์นำพาคนพิการ/รถเข็นขึ้น-ลงจากเรือ' },
      { code: 'B4.2', labelTh: 'ทางลาดสำหรับคนพิการ' },
      { code: 'B4.3', labelTh: 'หลังคาป้องกันแดดและฝน' },
    ] },
    { code: 'B5', labelTh: 'ห้องน้ำ', items: [
      { code: 'B5.1', labelTh: 'ห้องน้ำสำหรับคนพิการและผู้สูงอายุ' },
      { code: 'B5.2', labelTh: 'สัญญาณเสียง/สัญญาณแสงขอความช่วยเหลือสำหรับคนพิการ' },
    ] },
  ],

  ทางอากาศ: [
    { code: 'A1', labelTh: 'ที่จอดรถ', items: [
      { code: 'A1.1', labelTh: 'ที่จอดรถสำหรับคนพิการ' },
      { code: 'A1.2', labelTh: 'ป้ายแสดงอุปกรณ์หรือสิ่งอำนวยความสะดวกสำหรับคนพิการ' },
    ] },
    { code: 'A2', labelTh: 'การเชื่อมต่อและการเข้าถึงระบบขนส่งสาธารณะอื่น ๆ', items: [
      { code: 'A2.1', labelTh: 'ทางลาดสำหรับคนพิการ' },
      { code: 'A2.2', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูเตือน (Warning Tactile)' },
      { code: 'A2.3', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูนำทาง (Guiding Tactile)' },
      { code: 'A2.4', labelTh: 'พื้นผิวต่างสัมผัส ชนิดเปลี่ยนทิศทาง (Positioning Tactile)' },
      { code: 'A2.5', labelTh: 'บันไดสำหรับคนพิการและผู้สูงอายุ' },
      { code: 'A2.6', labelTh: 'ป้ายแสดงอุปกรณ์สำหรับคนพิการ' },
      { code: 'A2.7', labelTh: 'ทางลาดขอบถนน (ทางลาดตัดคันดิน)' },
      { code: 'A2.8', labelTh: 'จุดจอดรถรับ-ส่งคนพิการ' },
      { code: 'A2.9', labelTh: 'หลังคาป้องกันแดดและฝน' },
    ] },
    { code: 'B1', labelTh: 'ทางเข้า-ออก', items: [
      { code: 'B1.1', labelTh: 'ประตูสำหรับคนพิการ' },
      { code: 'B1.2', labelTh: 'ทางลาดสำหรับคนพิการ' },
      { code: 'B1.3', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูเตือน (Warning Tactile)' },
      { code: 'B1.4', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูนำทาง (Guiding Tactile)' },
      { code: 'B1.5', labelTh: 'พื้นผิวต่างสัมผัส ชนิดเปลี่ยนทิศทาง (Positioning Tactile)' },
      { code: 'B1.6', labelTh: 'บันไดสำหรับคนพิการและผู้สูงอายุ' },
    ] },
    { code: 'B2', labelTh: 'การติดต่อประชาสัมพันธ์/จุดบริการให้ข้อมูล', items: [
      { code: 'B2.1', labelTh: 'สถานที่ติดต่อประชาสัมพันธ์สำหรับคนพิการ' },
      { code: 'B2.2', labelTh: 'จุดบริการข้อมูลการเดินทางสำหรับคนพิการ' },
      { code: 'B2.3', labelTh: 'ช่องจำหน่ายตั๋วโดยสารสำหรับคนพิการ (เคาน์เตอร์)' },
      { code: 'B2.4', labelTh: 'เคาน์เตอร์เช็คอิน' },
      { code: 'B2.5', labelTh: 'การประกาศข้อมูล/ตัวอักษรไฟวิ่งสำหรับคนพิการ' },
      { code: 'B2.6', labelTh: 'การประกาศเตือนภัย/สัญญาณไฟเตือนสำหรับคนพิการ' },
      { code: 'B2.7', labelTh: 'ป้ายแสดงอุปกรณ์สำหรับคนพิการ' },
      { code: 'B2.8', labelTh: 'ที่นั่งสำหรับคนพิการ ผู้สูงอายุ และเด็ก' },
      { code: 'B2.9', labelTh: 'พื้นที่จอดรถเข็นคนพิการ (Wheelchair)' },
      { code: 'B2.10', labelTh: 'ทางลาดสำหรับคนพิการ' },
      { code: 'B2.11', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูเตือน (Warning Tactile)' },
      { code: 'B2.12', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูนำทาง (Guiding Tactile)' },
      { code: 'B2.13', labelTh: 'พื้นผิวต่างสัมผัส ชนิดเปลี่ยนทิศทาง (Positioning Tactile)' },
    ] },
    { code: 'B3', labelTh: 'โถงผู้โดยสารและทางเดิน', items: [
      { code: 'B3.1', labelTh: 'ที่นั่งสำหรับคนพิการ ผู้สูงอายุ และเด็ก' },
      { code: 'B3.2', labelTh: 'พื้นที่จอดรถเข็นคนพิการ (Wheelchair)' },
      { code: 'B3.3', labelTh: 'ป้ายแสดงอุปกรณ์สำหรับคนพิการ' },
      { code: 'B3.4', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูเตือน (Warning Tactile)' },
      { code: 'B3.5', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูนำทาง (Guiding Tactile)' },
      { code: 'B3.6', labelTh: 'พื้นผิวต่างสัมผัส ชนิดเปลี่ยนทิศทาง (Positioning Tactile)' },
      { code: 'B3.7', labelTh: 'ทางลาดเลื่อนหรือทางเลื่อนในแนวราบ' },
      { code: 'B3.8', labelTh: 'จุดบริการน้ำดื่มสำหรับคนพิการ' },
      { code: 'B3.9', labelTh: 'ตู้บริการเงินด่วนสำหรับคนพิการ' },
      { code: 'B3.10', labelTh: 'ตู้ไปรษณีย์สำหรับคนพิการ' },
      { code: 'B3.11', labelTh: 'เครื่องบริการถ่ายทอดการสื่อสารสาธารณะ (TTRS)' },
      { code: 'B3.12', labelTh: 'โทรศัพท์สาธารณะสำหรับคนพิการ' },
    ] },
    { code: 'B4', labelTh: 'ห้องน้ำ', items: [
      { code: 'B4.1', labelTh: 'ห้องน้ำสำหรับคนพิการและผู้สูงอายุ' },
      { code: 'B4.2', labelTh: 'สัญญาณเสียง/สัญญาณแสงขอความช่วยเหลือสำหรับคนพิการ' },
      { code: 'B4.3', labelTh: 'ที่เปลี่ยนผ้าอ้อมสำหรับเด็ก' },
    ] },
    { code: 'B5', labelTh: 'ลิฟต์', items: [
      { code: 'B5.1', labelTh: 'ลิฟต์ภายในท่าอากาศยานสำหรับคนพิการ' },
    ] },
    { code: 'B6', labelTh: 'บันได', items: [
      { code: 'B6.1', labelTh: 'บันไดสำหรับคนพิการและผู้สูงอายุ' },
      { code: 'B6.2', labelTh: 'บันไดเลื่อนสำหรับคนพิการ' },
    ] },
    { code: 'B7', labelTh: 'พื้นที่หนีภัย/พื้นที่หลบภัย', items: [
      { code: 'B7.1', labelTh: 'พื้นที่หนีภัย/หลบภัยสำหรับคนพิการ' },
    ] },
    { code: 'B8', labelTh: 'จุดขึ้น-ลงยานพาหนะ', items: [
      { code: 'B8.1', labelTh: 'ทางลาดสำหรับคนพิการ' },
      { code: 'B8.2', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูเตือน (Warning Tactile)' },
      { code: 'B8.3', labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูนำทาง (Guiding Tactile)' },
      { code: 'B8.4', labelTh: 'พื้นผิวต่างสัมผัส ชนิดเปลี่ยนทิศทาง (Positioning Tactile)' },
      { code: 'B8.5', labelTh: 'ป้ายแสดงอุปกรณ์สำหรับคนพิการ' },
      { code: 'B8.6', labelTh: 'อุปกรณ์นำพาคนพิการ/รถเข็นขึ้น-ลงจากรถ' },
    ] },
  ],
}
