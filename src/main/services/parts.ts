import { getDb, type Db } from '../db'
import type { SparePart, SparePartMovement, SparePartType } from '@shared/types'
import { properCase } from '@shared/types'

const TYPES: SparePartType[] = ['new', 'repairable', 'scrap']

function round3(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000
}

function normalizeType(value: unknown): SparePartType {
  return TYPES.includes(value as SparePartType) ? (value as SparePartType) : 'new'
}

export async function partBalance(d: Db, partId: number): Promise<number> {
  const row = (await d
    .prepare(`SELECT COALESCE(SUM(quantity),0) AS qty FROM spare_part_movements WHERE part_id = ?`)
    .get(partId)) as { qty: number }
  return round3(Number(row.qty) || 0)
}

export async function addPartMovement(
  d: Db,
  input: {
    part_id: number
    asset_id?: number | null
    movement_type: SparePartMovement['movement_type']
    ref_no?: string
    quantity: number
    date: string
    note?: string
  }
): Promise<void> {
  const qty = round3(input.quantity)
  if (!qty) return
  await d
    .prepare(
      `INSERT INTO spare_part_movements
       (part_id, asset_id, movement_type, ref_no, quantity, date, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.part_id,
      input.asset_id ?? null,
      input.movement_type,
      input.ref_no ?? '',
      qty,
      input.date,
      input.note ?? ''
    )
}

export async function listParts(payload: {
  plant_id?: number
  part_type?: SparePartType
} = {}): Promise<SparePart[]> {
  const d = getDb()
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (payload.plant_id) {
    where.push('(sp.plant_id IS NULL OR sp.plant_id = @plant_id)')
    params.plant_id = payload.plant_id
  }
  if (payload.part_type) {
    where.push('sp.part_type = @part_type')
    params.part_type = payload.part_type
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return (await d
    .prepare(
      `SELECT sp.*, p.name AS plant_name,
              COALESCE((SELECT SUM(m.quantity) FROM spare_part_movements m WHERE m.part_id = sp.id),0) AS balance_qty
       FROM spare_parts sp
       LEFT JOIN plants p ON p.id = sp.plant_id
       ${clause}
       ORDER BY sp.name, sp.part_type, sp.id`
    )
    .all(params)) as SparePart[]
}

export async function createPart(p: {
  name: string
  part_type?: SparePartType
  unit?: string
  plant_id?: number | null
  opening_qty?: number
  min_qty?: number
  remarks?: string
}): Promise<SparePart> {
  const d = getDb()
  const name = properCase(p.name)
  if (!name) throw new Error('Part name is required.')
  const partType = normalizeType(p.part_type)
  const unit = properCase(p.unit || 'PCS') || 'PCS'
  const duplicate = await d
    .prepare(
      `SELECT id FROM spare_parts
       WHERE name=? AND part_type=? AND COALESCE(plant_id,0)=COALESCE(?,0)`
    )
    .get(name, partType, p.plant_id ?? null)
  if (duplicate) throw new Error('This part and stock type already exists for the selected plant.')
  const id = await d.transaction(async () => {
    const info = await d
      .prepare(
        `INSERT INTO spare_parts (name, part_type, unit, plant_id, min_qty, remarks)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        name,
        partType,
        unit,
        p.plant_id ?? null,
        Math.max(0, Number(p.min_qty) || 0),
        p.remarks ?? ''
      )
    const partId = Number(info.lastInsertRowid)
    const opening = Math.max(0, Number(p.opening_qty) || 0)
    if (opening > 0) {
      await addPartMovement(d, {
        part_id: partId,
        asset_id: null,
        movement_type: 'opening',
        quantity: opening,
        date: new Date().toISOString().slice(0, 10),
        note: 'Opening stock'
      })
    }
    return partId
  })
  return (await listParts()).find((x) => x.id === id) as SparePart
}

export async function updatePart(p: {
  id: number
  name: string
  part_type?: SparePartType
  unit?: string
  plant_id?: number | null
  min_qty?: number
  remarks?: string
}): Promise<SparePart> {
  if (!p.id) throw new Error('Missing part id.')
  const name = properCase(p.name)
  if (!name) throw new Error('Part name is required.')
  await getDb()
    .prepare(
      `UPDATE spare_parts SET name=?, part_type=?, unit=?, plant_id=?, min_qty=?, remarks=? WHERE id=?`
    )
    .run(
      name,
      normalizeType(p.part_type),
      properCase(p.unit || 'PCS') || 'PCS',
      p.plant_id ?? null,
      Math.max(0, Number(p.min_qty) || 0),
      p.remarks ?? '',
      p.id
    )
  return (await listParts()).find((x) => x.id === p.id) as SparePart
}

export async function stockIn(payload: {
  part_id: number
  quantity: number
  date: string
  note?: string
}): Promise<{ ok: boolean }> {
  const d = getDb()
  const qty = round3(Math.abs(Number(payload.quantity)))
  if (!(qty > 0)) throw new Error('Stock-in quantity must be greater than 0.')
  await addPartMovement(d, {
    part_id: payload.part_id,
    asset_id: null,
    movement_type: 'stock_in',
    quantity: qty,
    date: payload.date,
    note: payload.note || 'Stock received'
  })
  return { ok: true }
}

export async function stockOut(payload: {
  part_id: number
  asset_id: number
  quantity: number
  date: string
  note?: string
}): Promise<{ ok: boolean }> {
  const d = getDb()
  const qty = round3(Math.abs(Number(payload.quantity)))
  if (!payload.asset_id) throw new Error('Select the machine or vehicle using this part.')
  if (!(qty > 0)) throw new Error('Stock-out quantity must be greater than 0.')
  await d.transaction(async () => {
    await addPartMovement(d, {
      part_id: payload.part_id,
      asset_id: payload.asset_id,
      movement_type: 'stock_out',
      quantity: -qty,
      date: payload.date,
      note: payload.note || 'Issued to machine / vehicle'
    })
    if ((await partBalance(d, payload.part_id)) < 0) throw new Error('Not enough stock for this part.')
  })
  return { ok: true }
}

export async function listPartMovements(payload: {
  part_id?: number
  asset_id?: number
  from?: string
  to?: string
} = {}): Promise<SparePartMovement[]> {
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (payload.part_id) { where.push('m.part_id=@part_id'); params.part_id = payload.part_id }
  if (payload.asset_id) { where.push('m.asset_id=@asset_id'); params.asset_id = payload.asset_id }
  if (payload.from) { where.push('m.date>=@from'); params.from = payload.from }
  if (payload.to) { where.push('m.date<=@to'); params.to = payload.to }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return (await getDb()
    .prepare(
      `SELECT m.*, sp.name AS part_name, sp.part_type, sp.unit, a.name AS asset_name
       FROM spare_part_movements m
       JOIN spare_parts sp ON sp.id=m.part_id
       LEFT JOIN assets a ON a.id=m.asset_id
       ${clause}
       ORDER BY m.date DESC, m.id DESC`
    )
    .all(params)) as SparePartMovement[]
}

export async function deletePart(payload: { id: number }): Promise<{ ok: boolean; error?: string }> {
  const d = getDb()
  const used = (await d
    .prepare(`SELECT COUNT(*) AS n FROM spare_part_movements WHERE part_id=? AND movement_type<>'opening'`)
    .get(payload.id)) as { n: number }
  if (Number(used.n) > 0) return { ok: false, error: 'This part has stock activity and cannot be deleted.' }
  await d.transaction(async () => {
    await d.prepare(`DELETE FROM spare_part_movements WHERE part_id=?`).run(payload.id)
    await d.prepare(`DELETE FROM spare_parts WHERE id=?`).run(payload.id)
  })
  return { ok: true }
}
