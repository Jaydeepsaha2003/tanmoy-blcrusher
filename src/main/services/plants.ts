import { getDb } from '../db'
import type { Plant } from '@shared/types'
import { properCase } from '@shared/types'

export function listPlants(): Plant[] {
  return getDb().prepare(`SELECT * FROM plants ORDER BY name`).all() as Plant[]
}

export function createPlant(p: {
  name: string
  code: string
  location: string
  status: string
}): Plant {
  const d = getDb()
  const info = d
    .prepare(`INSERT INTO plants (name, code, location, status) VALUES (?, ?, ?, ?)`)
    .run(p.name.trim().toUpperCase(), p.code.trim().toUpperCase(), properCase(p.location), p.status ?? 'active')
  return d.prepare(`SELECT * FROM plants WHERE id = ?`).get(info.lastInsertRowid) as Plant
}

export function updatePlant(p: {
  id: number
  name: string
  code: string
  location: string
  status: string
}): Plant {
  const d = getDb()
  d.prepare(`UPDATE plants SET name=?, code=?, location=?, status=? WHERE id=?`).run(
    p.name.trim().toUpperCase(),
    p.code.trim().toUpperCase(),
    properCase(p.location),
    p.status ?? 'active',
    p.id
  )
  return d.prepare(`SELECT * FROM plants WHERE id = ?`).get(p.id) as Plant
}

export function deletePlant(payload: { id: number }): { ok: boolean; error?: string } {
  const d = getDb()
  const used = d
    .prepare(`SELECT COUNT(*) AS c FROM stock_movements WHERE plant_id = ?`)
    .get(payload.id) as { c: number }
  if (used.c > 0) {
    return { ok: false, error: 'Cannot delete: this plant has stock movements / transactions.' }
  }
  d.prepare(`DELETE FROM production_settings WHERE plant_id = ?`).run(payload.id)
  d.prepare(`DELETE FROM stock_locations WHERE plant_id = ?`).run(payload.id)
  d.prepare(`DELETE FROM plants WHERE id = ?`).run(payload.id)
  return { ok: true }
}
