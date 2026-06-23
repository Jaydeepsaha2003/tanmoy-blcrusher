import { getDb } from '../db'
import type { StockLocation } from '@shared/types'
import { properCase } from '@shared/types'
import { rawLocationBalance, setLocationOpening } from './movements'
import { ensureUniqueName } from './names'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function listStockLocations(payload: { plant_id?: number } = {}): Promise<StockLocation[]> {
  const d = getDb()
  const where = payload.plant_id ? 'WHERE l.plant_id = @plant_id' : ''
  const rows = (await d
    .prepare(
      `SELECT l.*, p.name AS plant_name FROM stock_locations l
       JOIN plants p ON p.id = l.plant_id ${where} ORDER BY p.name, l.name`
    )
    .all(payload)) as StockLocation[]
  for (const r of rows) {
    const purchased = (await d
      .prepare(
        `SELECT COALESCE(SUM(change_qty),0) AS q FROM stock_movements
         WHERE stock_location_id = ? AND type='purchase'`
      )
      .get(r.id)) as { q: number }
    const consumed = (await d
      .prepare(
        `SELECT COALESCE(SUM(-change_qty),0) AS q FROM stock_movements
         WHERE stock_location_id = ? AND type='production_consume'`
      )
      .get(r.id)) as { q: number }
    r.purchased_qty = round(purchased.q)
    r.consumed_qty = round(consumed.q)
    r.balance_qty = await rawLocationBalance(d, r.id)
  }
  return rows
}

export async function createStockLocation(p: {
  plant_id: number
  name: string
  opening_qty: number
  remarks: string
}): Promise<StockLocation> {
  const d = getDb()
  await ensureUniqueName('stock_locations', p.name, { scopeColumn: 'plant_id', scopeValue: p.plant_id, label: 'A location in this plant' })
  const id = await d.transaction(async () => {
    const info = await d
      .prepare(
        `INSERT INTO stock_locations (plant_id, name, opening_qty, remarks) VALUES (?, ?, ?, ?)`
      )
      .run(p.plant_id, properCase(p.name), p.opening_qty || 0, p.remarks ?? '')
    const id = Number(info.lastInsertRowid)
    await setLocationOpening(d, id, p.plant_id, p.opening_qty || 0, today())
    return id
  })
  return (await d.prepare(`SELECT * FROM stock_locations WHERE id = ?`).get(id)) as StockLocation
}

/**
 * Returns a usable stock-location id for a plant. If the plant has none, a
 * default location named after the plant is created (so the plant itself acts
 * as the location when the user never set one up).
 */
export async function ensureDefaultLocation(plantId: number): Promise<number> {
  const d = getDb()
  const existing = (await d
    .prepare(`SELECT id FROM stock_locations WHERE plant_id = ? ORDER BY id LIMIT 1`)
    .get(plantId)) as { id: number } | undefined
  if (existing) return existing.id
  const plant = (await d.prepare(`SELECT name FROM plants WHERE id = ?`).get(plantId)) as
    | { name: string }
    | undefined
  const info = await d
    .prepare(`INSERT INTO stock_locations (plant_id, name, opening_qty, remarks) VALUES (?, ?, 0, ?)`)
    .run(plantId, plant?.name ?? 'Main', 'Default location')
  return Number(info.lastInsertRowid)
}

export async function updateStockLocation(p: {
  id: number
  plant_id: number
  name: string
  opening_qty: number
  remarks: string
}): Promise<StockLocation> {
  const d = getDb()
  await ensureUniqueName('stock_locations', p.name, { id: p.id, scopeColumn: 'plant_id', scopeValue: p.plant_id, label: 'A location in this plant' })
  await d.transaction(async () => {
    await d.prepare(`UPDATE stock_locations SET name=?, opening_qty=?, remarks=? WHERE id=?`).run(
      properCase(p.name),
      p.opening_qty || 0,
      p.remarks ?? '',
      p.id
    )
    await setLocationOpening(d, p.id, p.plant_id, p.opening_qty || 0, today())
  })
  return (await d.prepare(`SELECT * FROM stock_locations WHERE id = ?`).get(p.id)) as StockLocation
}

export async function deleteStockLocation(payload: { id: number }): Promise<{ ok: boolean; error?: string }> {
  const d = getDb()
  const used = (await d
    .prepare(
      `SELECT COUNT(*) AS c FROM stock_movements
       WHERE stock_location_id = ? AND type <> 'opening'`
    )
    .get(payload.id)) as { c: number }
  if (used.c > 0) {
    return { ok: false, error: 'Cannot delete: this location has purchase/production movements.' }
  }
  await d.prepare(`DELETE FROM stock_movements WHERE stock_location_id = ?`).run(payload.id)
  await d.prepare(`DELETE FROM stock_locations WHERE id = ?`).run(payload.id)
  return { ok: true }
}

function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000
}
