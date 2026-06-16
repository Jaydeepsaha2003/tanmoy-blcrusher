import { getDb } from '../db'
import type { StockLocation } from '@shared/types'
import { properCase } from '@shared/types'
import { rawLocationBalance, setLocationOpening } from './movements'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function listStockLocations(payload: { plant_id?: number } = {}): StockLocation[] {
  const d = getDb()
  const where = payload.plant_id ? 'WHERE l.plant_id = @plant_id' : ''
  const rows = d
    .prepare(
      `SELECT l.*, p.name AS plant_name FROM stock_locations l
       JOIN plants p ON p.id = l.plant_id ${where} ORDER BY p.name, l.name`
    )
    .all(payload) as StockLocation[]
  for (const r of rows) {
    const purchased = d
      .prepare(
        `SELECT COALESCE(SUM(change_qty),0) AS q FROM stock_movements
         WHERE stock_location_id = ? AND type='purchase'`
      )
      .get(r.id) as { q: number }
    const consumed = d
      .prepare(
        `SELECT COALESCE(SUM(-change_qty),0) AS q FROM stock_movements
         WHERE stock_location_id = ? AND type='production_consume'`
      )
      .get(r.id) as { q: number }
    r.purchased_qty = round(purchased.q)
    r.consumed_qty = round(consumed.q)
    r.balance_qty = rawLocationBalance(d, r.id)
  }
  return rows
}

export function createStockLocation(p: {
  plant_id: number
  name: string
  opening_qty: number
  remarks: string
}): StockLocation {
  const d = getDb()
  const tx = d.transaction(() => {
    const info = d
      .prepare(
        `INSERT INTO stock_locations (plant_id, name, opening_qty, remarks) VALUES (?, ?, ?, ?)`
      )
      .run(p.plant_id, properCase(p.name), p.opening_qty || 0, p.remarks ?? '')
    const id = Number(info.lastInsertRowid)
    setLocationOpening(d, id, p.plant_id, p.opening_qty || 0, today())
    return id
  })
  const id = tx()
  return d.prepare(`SELECT * FROM stock_locations WHERE id = ?`).get(id) as StockLocation
}

export function updateStockLocation(p: {
  id: number
  plant_id: number
  name: string
  opening_qty: number
  remarks: string
}): StockLocation {
  const d = getDb()
  const tx = d.transaction(() => {
    d.prepare(`UPDATE stock_locations SET name=?, opening_qty=?, remarks=? WHERE id=?`).run(
      properCase(p.name),
      p.opening_qty || 0,
      p.remarks ?? '',
      p.id
    )
    setLocationOpening(d, p.id, p.plant_id, p.opening_qty || 0, today())
  })
  tx()
  return d.prepare(`SELECT * FROM stock_locations WHERE id = ?`).get(p.id) as StockLocation
}

export function deleteStockLocation(payload: { id: number }): { ok: boolean; error?: string } {
  const d = getDb()
  const used = d
    .prepare(
      `SELECT COUNT(*) AS c FROM stock_movements
       WHERE stock_location_id = ? AND type <> 'opening'`
    )
    .get(payload.id) as { c: number }
  if (used.c > 0) {
    return { ok: false, error: 'Cannot delete: this location has purchase/production movements.' }
  }
  d.prepare(`DELETE FROM stock_movements WHERE stock_location_id = ?`).run(payload.id)
  d.prepare(`DELETE FROM stock_locations WHERE id = ?`).run(payload.id)
  return { ok: true }
}

function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000
}
