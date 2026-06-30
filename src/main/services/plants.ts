import { getDb } from '../db'
import type { Plant, UomFactors } from '@shared/types'
import { properCase, TON_PER_CM, CFT_PER_CM } from '@shared/types'
import { ensureDefaultLocation } from './stockLocations'
import { ensureUniqueName } from './names'

export async function listPlants(): Promise<Plant[]> {
  return (await getDb().prepare(`SELECT * FROM plants ORDER BY name`).all()) as Plant[]
}

function posOr(value: unknown, fallback: number): number {
  const n = Number(value)
  return n > 0 ? n : fallback
}

export async function createPlant(p: {
  name: string
  code: string
  location: string
  status: string
  ton_per_cm?: number
  cft_per_cm?: number
}): Promise<Plant> {
  const d = getDb()
  await ensureUniqueName('plants', p.name, { label: 'A plant' })
  const info = await d
    .prepare(
      `INSERT INTO plants (name, code, location, status, ton_per_cm, cft_per_cm) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      p.name.trim().toUpperCase(),
      p.code.trim().toUpperCase(),
      properCase(p.location),
      p.status ?? 'active',
      posOr(p.ton_per_cm, TON_PER_CM),
      posOr(p.cft_per_cm, CFT_PER_CM)
    )
  const plantId = Number(info.lastInsertRowid)
  // Give every plant a default stock location (the plant itself), so purchases
  // and production work even if the user never creates a separate location.
  await ensureDefaultLocation(plantId)
  return (await d.prepare(`SELECT * FROM plants WHERE id = ?`).get(plantId)) as Plant
}

export async function updatePlant(p: {
  id: number
  name: string
  code: string
  location: string
  status: string
  ton_per_cm?: number
  cft_per_cm?: number
}): Promise<Plant> {
  const d = getDb()
  await ensureUniqueName('plants', p.name, { id: p.id, label: 'A plant' })
  // COALESCE keeps the existing factor when the caller doesn't send one.
  await d
    .prepare(
      `UPDATE plants SET name=?, code=?, location=?, status=?,
         ton_per_cm=COALESCE(?, ton_per_cm), cft_per_cm=COALESCE(?, cft_per_cm) WHERE id=?`
    )
    .run(
      p.name.trim().toUpperCase(),
      p.code.trim().toUpperCase(),
      properCase(p.location),
      p.status ?? 'active',
      p.ton_per_cm != null && Number(p.ton_per_cm) > 0 ? Number(p.ton_per_cm) : null,
      p.cft_per_cm != null && Number(p.cft_per_cm) > 0 ? Number(p.cft_per_cm) : null,
      p.id
    )
  return (await d.prepare(`SELECT * FROM plants WHERE id = ?`).get(p.id)) as Plant
}

/** Per-plant UOM conversion factors (falls back to defaults when unset). */
export async function plantUomFactors(plantId?: number | null): Promise<UomFactors> {
  if (!plantId) return { ton_per_cm: TON_PER_CM, cft_per_cm: CFT_PER_CM }
  const row = (await getDb()
    .prepare(`SELECT ton_per_cm, cft_per_cm FROM plants WHERE id = ?`)
    .get(plantId)) as { ton_per_cm: number; cft_per_cm: number } | undefined
  return {
    ton_per_cm: posOr(row?.ton_per_cm, TON_PER_CM),
    cft_per_cm: posOr(row?.cft_per_cm, CFT_PER_CM)
  }
}

export async function deletePlant(payload: { id: number }): Promise<{ ok: boolean; error?: string }> {
  const d = getDb()
  const used = (await d
    .prepare(`SELECT COUNT(*) AS c FROM stock_movements WHERE plant_id = ?`)
    .get(payload.id)) as { c: number }
  if (used.c > 0) {
    return { ok: false, error: 'Cannot delete: this plant has stock movements / transactions.' }
  }
  await d.transaction(async () => {
    await d.prepare(`DELETE FROM production_settings WHERE plant_id = ?`).run(payload.id)
    await d.prepare(`DELETE FROM stock_locations WHERE plant_id = ?`).run(payload.id)
    // Drop the plant's multi-plant junction rows so they don't dangle on the freed id.
    for (const t of ['customer_plants', 'supplier_plants', 'transporter_plants', 'company_plants', 'asset_plants', 'rack_vehicle_plants', 'rack_jcb_plants']) {
      await d.prepare(`DELETE FROM ${t} WHERE plant_id = ?`).run(payload.id)
    }
    await d.prepare(`DELETE FROM plants WHERE id = ?`).run(payload.id)
  })
  return { ok: true }
}
