import { getDb, dbKind } from '../db'
import type { FinishedGood } from '@shared/types'
import { properCase } from '@shared/types'
import { setFinishedOpening } from './movements'

export interface FinishedFilter {
  plant_id?: number
  product_name?: string
  from?: string
  to?: string
}

/**
 * Finished goods stock per plant + product, derived from stock movements.
 * opening = sum of 'opening' movements; produced = production_output; dispatched = dispatch.
 */
export async function listFinishedGoods(filter: FinishedFilter = {}): Promise<FinishedGood[]> {
  const d = getDb()
  const where: string[] = [`m.material_type = 'finished'`]
  const params: Record<string, unknown> = {}
  if (filter.plant_id) {
    where.push('m.plant_id = @plant_id')
    params.plant_id = filter.plant_id
  }
  if (filter.product_name) {
    where.push('m.product_name = @product_name')
    params.product_name = filter.product_name
  }
  // Date range only constrains produced/dispatched/loaded, not opening or final balance.
  const dateProd = filter.from || filter.to ? buildDateClause(filter, params, 'prodd') : ''
  const datePurch = filter.from || filter.to ? buildDateClause(filter, params, 'purd') : ''
  const dateDisp = filter.from || filter.to ? buildDateClause(filter, params, 'dispd') : ''
  const dateLoad = filter.from || filter.to ? buildDateClause(filter, params, 'loadd') : ''

  const rows = (await d
    .prepare(
      `SELECT m.plant_id, p.name AS plant_name, m.product_name,
        COALESCE(SUM(CASE WHEN m.type='opening' THEN m.change_qty ELSE 0 END),0) AS opening_qty,
        COALESCE(SUM(CASE WHEN m.type='production_output' ${dateProd} THEN m.change_qty ELSE 0 END),0) AS produced_qty,
        COALESCE(SUM(CASE WHEN m.type='purchase' ${datePurch} THEN m.change_qty ELSE 0 END),0) AS purchased_qty,
        COALESCE(SUM(CASE WHEN m.type='dispatch' ${dateDisp} THEN -m.change_qty ELSE 0 END),0) AS dispatched_qty,
        COALESCE(SUM(CASE WHEN m.type='rack_load' ${dateLoad} THEN -m.change_qty ELSE 0 END),0) AS loaded_qty,
        COALESCE(SUM(m.change_qty),0) AS balance_qty
       FROM stock_movements m
       JOIN plants p ON p.id = m.plant_id
       WHERE ${where.join(' AND ')}
       GROUP BY m.plant_id, m.product_name
       ORDER BY p.name, m.product_name`
    )
    .all(params)) as FinishedGood[]
  return rows.map((r) => ({
    ...r,
    opening_qty: round(r.opening_qty),
    produced_qty: round(r.produced_qty),
    purchased_qty: round(r.purchased_qty),
    dispatched_qty: round(r.dispatched_qty),
    loaded_qty: round(r.loaded_qty),
    balance_qty: round(r.balance_qty)
  }))
}

function buildDateClause(
  filter: FinishedFilter,
  params: Record<string, unknown>,
  prefix: string
): string {
  let c = ''
  if (filter.from) {
    c += ` AND m.date >= @${prefix}_from`
    params[`${prefix}_from`] = filter.from
  }
  if (filter.to) {
    c += ` AND m.date <= @${prefix}_to`
    params[`${prefix}_to`] = filter.to
  }
  return c
}

/** Distinct finished-goods products available (with positive balance) for a plant. */
export async function availableProducts(payload: {
  plant_id: number
}): Promise<{ product_name: string; balance_qty: number }[]> {
  return (await listFinishedGoods({ plant_id: payload.plant_id }))
    .filter((f) => f.balance_qty > 0)
    .map((f) => ({ product_name: f.product_name, balance_qty: f.balance_qty }))
}

export async function setOpening(payload: {
  plant_id: number
  product_name: string
  opening_qty: number
  date?: string
}): Promise<{ ok: boolean }> {
  const d = getDb()
  const date = payload.date || new Date().toISOString().slice(0, 10)
  const product = properCase(payload.product_name)
  await d.transaction(async () => {
    await d.prepare(
      dbKind() === 'mysql'
        ? `INSERT INTO finished_goods_opening (plant_id, product_name, opening_qty)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE opening_qty = VALUES(opening_qty)`
        : `INSERT INTO finished_goods_opening (plant_id, product_name, opening_qty)
           VALUES (?, ?, ?)
           ON CONFLICT(plant_id, product_name) DO UPDATE SET opening_qty = excluded.opening_qty`
    ).run(payload.plant_id, product, payload.opening_qty || 0)
    await setFinishedOpening(d, payload.plant_id, product, payload.opening_qty || 0, date)
  })
  return { ok: true }
}

function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000
}
