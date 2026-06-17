import { getDb } from '../db'
import type { Plant } from '@shared/types'
import { properCase } from '@shared/types'
import { ensureDefaultLocation } from './stockLocations'

export async function listPlants(): Promise<Plant[]> {
  return (await getDb().prepare(`SELECT * FROM plants ORDER BY name`).all()) as Plant[]
}

export async function createPlant(p: {
  name: string
  code: string
  location: string
  status: string
}): Promise<Plant> {
  const d = getDb()
  const info = await d
    .prepare(`INSERT INTO plants (name, code, location, status) VALUES (?, ?, ?, ?)`)
    .run(p.name.trim().toUpperCase(), p.code.trim().toUpperCase(), properCase(p.location), p.status ?? 'active')
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
}): Promise<Plant> {
  const d = getDb()
  await d.prepare(`UPDATE plants SET name=?, code=?, location=?, status=? WHERE id=?`).run(
    p.name.trim().toUpperCase(),
    p.code.trim().toUpperCase(),
    properCase(p.location),
    p.status ?? 'active',
    p.id
  )
  return (await d.prepare(`SELECT * FROM plants WHERE id = ?`).get(p.id)) as Plant
}

export async function deletePlant(payload: { id: number }): Promise<{ ok: boolean; error?: string }> {
  const d = getDb()
  const used = (await d
    .prepare(`SELECT COUNT(*) AS c FROM stock_movements WHERE plant_id = ?`)
    .get(payload.id)) as { c: number }
  if (used.c > 0) {
    return { ok: false, error: 'Cannot delete: this plant has stock movements / transactions.' }
  }
  await d.prepare(`DELETE FROM production_settings WHERE plant_id = ?`).run(payload.id)
  await d.prepare(`DELETE FROM stock_locations WHERE plant_id = ?`).run(payload.id)
  await d.prepare(`DELETE FROM plants WHERE id = ?`).run(payload.id)
  return { ok: true }
}
