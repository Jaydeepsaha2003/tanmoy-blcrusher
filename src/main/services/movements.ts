import { getDb, nextNumber, type Db } from '../db'
import type { MovementType, MaterialType, StockMovement } from '@shared/types'

export interface MovementInput {
  type: MovementType
  material_type: MaterialType
  ref_no?: string
  plant_id: number
  stock_location_id?: number | null
  product_name?: string | null
  change_qty: number
  date: string
  note?: string
}

export async function addMovement(d: Db, m: MovementInput): Promise<void> {
  await d.prepare(
    `INSERT INTO stock_movements
       (type, material_type, ref_no, plant_id, stock_location_id, product_name, change_qty, date, note)
     VALUES (@type, @material_type, @ref_no, @plant_id, @stock_location_id, @product_name, @change_qty, @date, @note)`
  ).run({
    type: m.type,
    material_type: m.material_type,
    ref_no: m.ref_no ?? '',
    plant_id: m.plant_id,
    stock_location_id: m.stock_location_id ?? null,
    product_name: m.product_name ?? null,
    change_qty: m.change_qty,
    date: m.date,
    note: m.note ?? ''
  })
}

export async function rawLocationBalance(d: Db, locationId: number): Promise<number> {
  const r = (await d
    .prepare(
      `SELECT COALESCE(SUM(change_qty),0) AS q FROM stock_movements
       WHERE material_type='raw' AND stock_location_id = ?`
    )
    .get(locationId)) as { q: number }
  return round(r.q)
}

export async function rawPlantBalance(d: Db, plantId: number): Promise<number> {
  const r = (await d
    .prepare(
      `SELECT COALESCE(SUM(change_qty),0) AS q FROM stock_movements
       WHERE material_type='raw' AND plant_id = ?`
    )
    .get(plantId)) as { q: number }
  return round(r.q)
}

export async function finishedBalance(
  d: Db,
  plantId: number,
  productName: string
): Promise<number> {
  const r = (await d
    .prepare(
      `SELECT COALESCE(SUM(change_qty),0) AS q FROM stock_movements
       WHERE material_type='finished' AND plant_id = ? AND product_name = ?`
    )
    .get(plantId, productName)) as { q: number }
  return round(r.q)
}

/** Upsert the single opening movement for a raw stock location. */
export async function setLocationOpening(
  d: Db,
  locationId: number,
  plantId: number,
  qty: number,
  date: string
): Promise<void> {
  const existing = (await d
    .prepare(
      `SELECT id FROM stock_movements
       WHERE type='opening' AND material_type='raw' AND stock_location_id = ?`
    )
    .get(locationId)) as { id: number } | undefined
  if (qty > 0) {
    if (existing) {
      await d.prepare(`UPDATE stock_movements SET change_qty = ?, plant_id = ?, date = ? WHERE id = ?`).run(
        qty,
        plantId,
        date,
        existing.id
      )
    } else {
      await addMovement(d, {
        type: 'opening',
        material_type: 'raw',
        plant_id: plantId,
        stock_location_id: locationId,
        change_qty: qty,
        date,
        note: 'Opening stock'
      })
    }
  } else if (existing) {
    await d.prepare(`DELETE FROM stock_movements WHERE id = ?`).run(existing.id)
  }
}

/** Upsert the single opening movement for a finished good (plant + product). */
export async function setFinishedOpening(
  d: Db,
  plantId: number,
  productName: string,
  qty: number,
  date: string
): Promise<void> {
  const existing = (await d
    .prepare(
      `SELECT id FROM stock_movements
       WHERE type='opening' AND material_type='finished' AND plant_id = ? AND product_name = ?`
    )
    .get(plantId, productName)) as { id: number } | undefined
  if (qty > 0) {
    if (existing) {
      await d.prepare(`UPDATE stock_movements SET change_qty = ?, date = ? WHERE id = ?`).run(
        qty,
        date,
        existing.id
      )
    } else {
      await addMovement(d, {
        type: 'opening',
        material_type: 'finished',
        plant_id: plantId,
        product_name: productName,
        change_qty: qty,
        date,
        note: 'Opening finished goods'
      })
    }
  } else if (existing) {
    await d.prepare(`DELETE FROM stock_movements WHERE id = ?`).run(existing.id)
  }
}

function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000
}

// ---- Query endpoints ----

export interface MovementFilter {
  plant_id?: number
  stock_location_id?: number
  product_name?: string
  material_type?: MaterialType
  type?: MovementType
  from?: string
  to?: string
}

export async function listMovements(filter: MovementFilter = {}): Promise<StockMovement[]> {
  const d = getDb()
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (filter.plant_id) {
    where.push('m.plant_id = @plant_id')
    params.plant_id = filter.plant_id
  }
  if (filter.stock_location_id) {
    where.push('m.stock_location_id = @stock_location_id')
    params.stock_location_id = filter.stock_location_id
  }
  if (filter.product_name) {
    where.push('m.product_name = @product_name')
    params.product_name = filter.product_name
  }
  if (filter.material_type) {
    where.push('m.material_type = @material_type')
    params.material_type = filter.material_type
  }
  if (filter.type) {
    where.push('m.type = @type')
    params.type = filter.type
  }
  if (filter.from) {
    where.push('m.date >= @from')
    params.from = filter.from
  }
  if (filter.to) {
    where.push('m.date <= @to')
    params.to = filter.to
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return (await d
    .prepare(
      `SELECT m.*, p.name AS plant_name, l.name AS stock_location_name
       FROM stock_movements m
       LEFT JOIN plants p ON p.id = m.plant_id
       LEFT JOIN stock_locations l ON l.id = m.stock_location_id
       ${clause}
       ORDER BY m.date DESC, m.id DESC`
    )
    .all(params)) as StockMovement[]
}

/* ---------------- Location-to-location transfer (raw material) ---------------- */

export interface TransferInput {
  from_location_id: number
  to_location_id: number
  quantity: number
  date: string
  note?: string
}

export async function transferStock(p: TransferInput): Promise<{ ok: boolean }> {
  const d = getDb()
  if (!p.from_location_id || !p.to_location_id) throw new Error('Select both locations.')
  if (p.from_location_id === p.to_location_id)
    throw new Error('Source and destination must be different locations.')
  if (!(Number(p.quantity) > 0)) throw new Error('Quantity must be greater than 0.')
  const loc = async (id: number): Promise<{ id: number; name: string; plant_id: number } | undefined> =>
    (await d.prepare(`SELECT id, name, plant_id FROM stock_locations WHERE id = ?`).get(id)) as
      | { id: number; name: string; plant_id: number }
      | undefined
  const from = await loc(p.from_location_id)
  const to = await loc(p.to_location_id)
  if (!from || !to) throw new Error('Location not found.')
  const qty = round(Number(p.quantity))
  const available = await rawLocationBalance(d, from.id)
  if (qty > available)
    throw new Error(`Not enough stock at ${from.name}. Available: ${available} m³, requested: ${qty} m³.`)
  await d.transaction(async () => {
    const ref = await nextNumber('TRF', 'transfer')
    await addMovement(d, {
      type: 'transfer',
      material_type: 'raw',
      ref_no: ref,
      plant_id: from.plant_id,
      stock_location_id: from.id,
      change_qty: -qty,
      date: p.date,
      note: p.note?.trim() || `Transfer to ${to.name}`
    })
    await addMovement(d, {
      type: 'transfer',
      material_type: 'raw',
      ref_no: ref,
      plant_id: to.plant_id,
      stock_location_id: to.id,
      change_qty: qty,
      date: p.date,
      note: p.note?.trim() || `Transfer from ${from.name}`
    })
    if ((await rawLocationBalance(d, from.id)) < 0) throw new Error('Stock cannot go negative.')
  })
  return { ok: true }
}

export async function deleteTransfer(payload: { ref_no: string }): Promise<{ ok: boolean; error?: string }> {
  const d = getDb()
  const legs = (await d
    .prepare(`SELECT DISTINCT stock_location_id FROM stock_movements WHERE ref_no = ? AND type = 'transfer'`)
    .all(payload.ref_no)) as { stock_location_id: number | null }[]
  try {
    await d.transaction(async () => {
      await d.prepare(`DELETE FROM stock_movements WHERE ref_no = ? AND type = 'transfer'`).run(payload.ref_no)
      // Removing the inbound leg can't leave the destination (or source) negative.
      for (const l of legs) {
        if (l.stock_location_id != null && (await rawLocationBalance(d, l.stock_location_id)) < 0)
          throw new Error('Cannot delete: stock from this transfer has already been used at the destination.')
      }
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
