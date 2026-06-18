import { getDb } from '../db'
import type { RateChartRow, TransportCharge, Uom, TransportBasis } from '@shared/types'
import { properCase } from '@shared/types'

const VALID_UOM: Uom[] = ['CM', 'TON', 'CFT']
const VALID_BASIS: TransportBasis[] = ['trip', 'cm', 'ton']

function nowIso(): string {
  return new Date().toISOString()
}
function money(n: unknown): number {
  const v = Number(n)
  return Number.isFinite(v) ? Math.round((v + Number.EPSILON) * 100) / 100 : 0
}

/* ---------------- Rate chart (product × location × tier) ---------------- */

export async function listRateChart(payload: { plant_id?: number } = {}): Promise<RateChartRow[]> {
  const d = getDb()
  const clause = payload.plant_id ? 'WHERE l.plant_id = @plant_id' : ''
  return (await d
    .prepare(
      `SELECT rc.*, l.name AS stock_location_name, p.name AS plant_name
       FROM rate_chart rc
       JOIN stock_locations l ON l.id = rc.stock_location_id
       JOIN plants p ON p.id = l.plant_id
       ${clause}
       ORDER BY p.name, l.name, rc.product_name, rc.uom`
    )
    .all(payload)) as RateChartRow[]
}

export async function createRateChart(p: RateChartRow): Promise<RateChartRow> {
  const d = getDb()
  const name = properCase(p.product_name)
  if (!name) throw new Error('Select a product.')
  if (!p.stock_location_id) throw new Error('Select a location.')
  const uom: Uom = VALID_UOM.includes(p.uom) ? p.uom : 'CM'
  const dup = (await d
    .prepare(
      `SELECT id FROM rate_chart WHERE stock_location_id = ? AND LOWER(product_name) = LOWER(?) AND uom = ?`
    )
    .get(p.stock_location_id, name, uom)) as { id: number } | undefined
  if (dup) throw new Error('A rate row already exists for this product, location and unit.')
  const info = await d
    .prepare(
      `INSERT INTO rate_chart (product_name, stock_location_id, uom, rate_wholesale, rate_retail, rate_customer, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(name, p.stock_location_id, uom, money(p.rate_wholesale), money(p.rate_retail), money(p.rate_customer), nowIso())
  return (await d.prepare(`SELECT * FROM rate_chart WHERE id = ?`).get(info.lastInsertRowid)) as RateChartRow
}

export async function updateRateChart(p: RateChartRow): Promise<RateChartRow> {
  const d = getDb()
  if (!p.id) throw new Error('Missing rate row id.')
  const name = properCase(p.product_name)
  const uom: Uom = VALID_UOM.includes(p.uom) ? p.uom : 'CM'
  const dup = (await d
    .prepare(
      `SELECT id FROM rate_chart WHERE stock_location_id = ? AND LOWER(product_name) = LOWER(?) AND uom = ? AND id <> ?`
    )
    .get(p.stock_location_id, name, uom, p.id)) as { id: number } | undefined
  if (dup) throw new Error('A rate row already exists for this product, location and unit.')
  await d
    .prepare(
      `UPDATE rate_chart SET product_name=?, stock_location_id=?, uom=?, rate_wholesale=?, rate_retail=?, rate_customer=?, updated_at=?
       WHERE id=?`
    )
    .run(name, p.stock_location_id, uom, money(p.rate_wholesale), money(p.rate_retail), money(p.rate_customer), nowIso(), p.id)
  return (await d.prepare(`SELECT * FROM rate_chart WHERE id = ?`).get(p.id)) as RateChartRow
}

export async function deleteRateChart(payload: { id: number }): Promise<{ ok: boolean }> {
  await getDb().prepare(`DELETE FROM rate_chart WHERE id = ?`).run(payload.id)
  return { ok: true }
}

/* ---------------- Transport charges (vehicle × location) ---------------- */

export async function listTransportCharges(payload: { plant_id?: number } = {}): Promise<TransportCharge[]> {
  const d = getDb()
  const clause = payload.plant_id ? 'WHERE l.plant_id = @plant_id' : ''
  return (await d
    .prepare(
      `SELECT tc.*, l.name AS stock_location_name, p.name AS plant_name
       FROM transport_charges tc
       JOIN stock_locations l ON l.id = tc.stock_location_id
       JOIN plants p ON p.id = l.plant_id
       ${clause}
       ORDER BY p.name, l.name, tc.vehicle_type`
    )
    .all(payload)) as TransportCharge[]
}

export async function createTransportCharge(p: TransportCharge): Promise<TransportCharge> {
  const d = getDb()
  const vehicle = properCase(p.vehicle_type)
  if (!vehicle) throw new Error('Enter a vehicle / lorry type.')
  if (!p.stock_location_id) throw new Error('Select a location.')
  const basis: TransportBasis = VALID_BASIS.includes(p.basis) ? p.basis : 'trip'
  const info = await d
    .prepare(
      `INSERT INTO transport_charges (vehicle_type, stock_location_id, basis, charge, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(vehicle, p.stock_location_id, basis, money(p.charge), nowIso())
  return (await d.prepare(`SELECT * FROM transport_charges WHERE id = ?`).get(info.lastInsertRowid)) as TransportCharge
}

export async function updateTransportCharge(p: TransportCharge): Promise<TransportCharge> {
  const d = getDb()
  if (!p.id) throw new Error('Missing transport charge id.')
  const vehicle = properCase(p.vehicle_type)
  if (!vehicle) throw new Error('Enter a vehicle / lorry type.')
  const basis: TransportBasis = VALID_BASIS.includes(p.basis) ? p.basis : 'trip'
  await d
    .prepare(
      `UPDATE transport_charges SET vehicle_type=?, stock_location_id=?, basis=?, charge=?, updated_at=? WHERE id=?`
    )
    .run(vehicle, p.stock_location_id, basis, money(p.charge), nowIso(), p.id)
  return (await d.prepare(`SELECT * FROM transport_charges WHERE id = ?`).get(p.id)) as TransportCharge
}

export async function deleteTransportCharge(payload: { id: number }): Promise<{ ok: boolean }> {
  await getDb().prepare(`DELETE FROM transport_charges WHERE id = ?`).run(payload.id)
  return { ok: true }
}
