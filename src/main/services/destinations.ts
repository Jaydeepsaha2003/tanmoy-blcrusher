import { getDb } from '../db'
import type { Destination } from '@shared/types'
import { properCase } from '@shared/types'

/** Reusable delivery destinations, used by origin→destination transport rates. */
export async function listDestinations(): Promise<Destination[]> {
  return (await getDb().prepare(`SELECT * FROM destinations ORDER BY name`).all()) as Destination[]
}

export async function createDestination(p: { name: string; remarks?: string }): Promise<Destination> {
  const d = getDb()
  const name = properCase(p.name || '')
  if (!name) throw new Error('Destination name is required.')
  const dup = (await d.prepare(`SELECT id FROM destinations WHERE LOWER(name) = LOWER(?)`).get(name)) as
    | { id: number }
    | undefined
  if (dup) throw new Error('A destination with this name already exists.')
  const info = await d.prepare(`INSERT INTO destinations (name, remarks) VALUES (?, ?)`).run(name, p.remarks ?? '')
  return (await d.prepare(`SELECT * FROM destinations WHERE id = ?`).get(info.lastInsertRowid)) as Destination
}

export async function updateDestination(p: { id: number; name: string; remarks?: string }): Promise<Destination> {
  const d = getDb()
  if (!p.id) throw new Error('Missing destination id.')
  const name = properCase(p.name || '')
  if (!name) throw new Error('Destination name is required.')
  const dup = (await d
    .prepare(`SELECT id FROM destinations WHERE LOWER(name) = LOWER(?) AND id <> ?`)
    .get(name, p.id)) as { id: number } | undefined
  if (dup) throw new Error('A destination with this name already exists.')
  await d.prepare(`UPDATE destinations SET name=?, remarks=? WHERE id=?`).run(name, p.remarks ?? '', p.id)
  return (await d.prepare(`SELECT * FROM destinations WHERE id = ?`).get(p.id)) as Destination
}

export async function deleteDestination(payload: { id: number }): Promise<{ ok: boolean; error?: string }> {
  const d = getDb()
  const used = (await d
    .prepare(`SELECT COUNT(*) AS c FROM transport_charges WHERE destination_id = ?`)
    .get(payload.id)) as { c: number }
  if (used.c > 0) return { ok: false, error: 'Cannot delete: this destination is used in transport rates.' }
  await d.prepare(`DELETE FROM destinations WHERE id = ?`).run(payload.id)
  return { ok: true }
}
