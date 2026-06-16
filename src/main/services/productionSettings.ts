import { getDb } from '../db'
import type { ProductionSetting } from '@shared/types'
import { properCase } from '@shared/types'

export function listProductionSettings(payload: { plant_id: number }): ProductionSetting[] {
  return getDb()
    .prepare(`SELECT * FROM production_settings WHERE plant_id = ? ORDER BY id`)
    .all(payload.plant_id) as ProductionSetting[]
}

export function saveProductionSettings(payload: {
  plant_id: number
  items: { product_name: string; output_percentage: number }[]
}): { ok: boolean; error?: string } {
  const d = getDb()
  const items = payload.items
    .map((i) => ({
      product_name: properCase(i.product_name),
      output_percentage: Number(i.output_percentage) || 0
    }))
    .filter((i) => i.product_name !== '')

  if (items.length === 0) return { ok: false, error: 'Add at least one product.' }

  const names = items.map((i) => i.product_name.toLowerCase())
  if (new Set(names).size !== names.length)
    return { ok: false, error: 'Duplicate product names are not allowed.' }

  const total = items.reduce((s, i) => s + i.output_percentage, 0)
  // Allow tiny floating point tolerance.
  if (Math.abs(total - 100) > 0.001)
    return { ok: false, error: `Total output must equal 100%. Current total is ${round(total)}%.` }

  const tx = d.transaction(() => {
    d.prepare(`DELETE FROM production_settings WHERE plant_id = ?`).run(payload.plant_id)
    const stmt = d.prepare(
      `INSERT INTO production_settings (plant_id, product_name, output_percentage) VALUES (?, ?, ?)`
    )
    for (const i of items) stmt.run(payload.plant_id, i.product_name, i.output_percentage)
  })
  tx()
  return { ok: true }
}

function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000
}
