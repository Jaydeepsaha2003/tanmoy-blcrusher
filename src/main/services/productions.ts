import { getDb, nextNumber } from '../db'
import type { Production, ProductionOutput, ProductionSetting } from '@shared/types'
import { addMovement, rawLocationBalance, finishedBalance } from './movements'
import { ensureDefaultLocation } from './stockLocations'

export interface ProductionFilter {
  plant_id?: number
  from?: string
  to?: string
}

export async function listProductions(filter: ProductionFilter = {}): Promise<Production[]> {
  const d = getDb()
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (filter.plant_id) {
    where.push('pr.plant_id = @plant_id')
    params.plant_id = filter.plant_id
  }
  if (filter.from) {
    where.push('pr.date >= @from')
    params.from = filter.from
  }
  if (filter.to) {
    where.push('pr.date <= @to')
    params.to = filter.to
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const rows = (await d
    .prepare(
      `SELECT pr.*, p.name AS plant_name, l.name AS stock_location_name
       FROM productions pr
       JOIN plants p ON p.id = pr.plant_id
       JOIN stock_locations l ON l.id = pr.stock_location_id
       ${clause}
       ORDER BY pr.date DESC, pr.id DESC`
    )
    .all(params)) as Production[]
  for (const r of rows) {
    r.outputs = (await d
      .prepare(`SELECT * FROM production_outputs WHERE production_id = ? ORDER BY id`)
      .all(r.id)) as ProductionOutput[]
  }
  return rows
}

export async function previewProduction(payload: {
  plant_id: number
  raw_qty: number
}): Promise<{ product_name: string; percentage: number; quantity: number }[]> {
  const d = getDb()
  const settings = (await d
    .prepare(`SELECT * FROM production_settings WHERE plant_id = ? ORDER BY id`)
    .all(payload.plant_id)) as ProductionSetting[]
  return settings.map((s) => ({
    product_name: s.product_name,
    percentage: s.output_percentage,
    quantity: round((payload.raw_qty * s.output_percentage) / 100)
  }))
}

export async function createProduction(p: {
  plant_id: number
  stock_location_id?: number
  raw_qty: number
  date: string
  remarks: string
}): Promise<Production> {
  const d = getDb()
  if (!(p.raw_qty > 0)) throw new Error('Raw material quantity must be greater than 0.')
  const locId = p.stock_location_id || (await ensureDefaultLocation(p.plant_id))

  const settings = (await d
    .prepare(`SELECT * FROM production_settings WHERE plant_id = ? ORDER BY id`)
    .all(p.plant_id)) as ProductionSetting[]
  if (settings.length === 0)
    throw new Error('No production settings defined for this plant. Set them up first.')

  const available = await rawLocationBalance(d, locId)
  if (p.raw_qty > available)
    throw new Error(
      `Not enough raw material. Available: ${available} m³, requested: ${p.raw_qty} m³.`
    )

  const id = await d.transaction(async () => {
    const no = await nextNumber('PROD', 'production')
    const info = await d
      .prepare(
        `INSERT INTO productions (production_no, plant_id, stock_location_id, raw_qty, date, remarks)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(no, p.plant_id, locId, p.raw_qty, p.date, p.remarks ?? '')
    const productionId = Number(info.lastInsertRowid)

    await addMovement(d, {
      type: 'production_consume',
      material_type: 'raw',
      ref_no: no,
      plant_id: p.plant_id,
      stock_location_id: locId,
      change_qty: -p.raw_qty,
      date: p.date,
      note: 'Raw material consumed in production'
    })

    const outStmt = d.prepare(
      `INSERT INTO production_outputs (production_id, product_name, percentage, quantity)
       VALUES (?, ?, ?, ?)`
    )
    for (const s of settings) {
      const qty = round((p.raw_qty * s.output_percentage) / 100)
      await outStmt.run(productionId, s.product_name, s.output_percentage, qty)
      if (qty > 0) {
        await addMovement(d, {
          type: 'production_output',
          material_type: 'finished',
          ref_no: no,
          plant_id: p.plant_id,
          product_name: s.product_name,
          change_qty: qty,
          date: p.date,
          note: 'Finished goods produced'
        })
      }
    }

    if ((await rawLocationBalance(d, locId)) < 0)
      throw new Error('Stock cannot go negative.')
    return productionId
  })
  return (await listProductions()).find((x) => x.id === id) as Production
}

export async function deleteProduction(payload: { id: number }): Promise<{ ok: boolean; error?: string }> {
  const d = getDb()
  const prod = (await d.prepare(`SELECT * FROM productions WHERE id = ?`).get(payload.id)) as Production
  if (!prod) return { ok: false, error: 'Production not found.' }
  try {
    await d.transaction(async () => {
      const outputs = (await d
        .prepare(`SELECT * FROM production_outputs WHERE production_id = ?`)
        .all(payload.id)) as ProductionOutput[]
      // Remove finished-goods output movements, ensure no resulting negative balance.
      await d.prepare(`DELETE FROM stock_movements WHERE ref_no=? AND type='production_output'`).run(
        prod.production_no
      )
      for (const o of outputs) {
        if ((await finishedBalance(d, prod.plant_id, o.product_name)) < 0)
          throw new Error(
            `Cannot delete: ${o.product_name} produced here has already been dispatched.`
          )
      }
      // Restore raw material.
      await d.prepare(`DELETE FROM stock_movements WHERE ref_no=? AND type='production_consume'`).run(
        prod.production_no
      )
      await d.prepare(`DELETE FROM production_outputs WHERE production_id = ?`).run(payload.id)
      await d.prepare(`DELETE FROM productions WHERE id = ?`).run(payload.id)
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000
}
