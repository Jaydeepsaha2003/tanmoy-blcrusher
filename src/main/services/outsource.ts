import { getDb } from '../db'
import type { Outsource } from '@shared/types'
import { properCase } from '@shared/types'

export function listOutsource(): Outsource[] {
  return getDb().prepare(`SELECT * FROM outsource ORDER BY name`).all() as Outsource[]
}

export function createOutsource(p: {
  name: string
  head: string
  contact: string
  remarks: string
}): Outsource {
  const d = getDb()
  if (!p.name?.trim()) throw new Error('Name is required.')
  const info = d
    .prepare(`INSERT INTO outsource (name, head, contact, remarks) VALUES (?, ?, ?, ?)`)
    .run(properCase(p.name), properCase(p.head), p.contact ?? '', p.remarks ?? '')
  return d.prepare(`SELECT * FROM outsource WHERE id = ?`).get(info.lastInsertRowid) as Outsource
}

export function updateOutsource(p: {
  id: number
  name: string
  head: string
  contact: string
  remarks: string
}): Outsource {
  const d = getDb()
  d.prepare(`UPDATE outsource SET name=?, head=?, contact=?, remarks=? WHERE id=?`).run(
    properCase(p.name),
    properCase(p.head),
    p.contact ?? '',
    p.remarks ?? '',
    p.id
  )
  return d.prepare(`SELECT * FROM outsource WHERE id = ?`).get(p.id) as Outsource
}

export function deleteOutsource(payload: { id: number }): { ok: boolean; error?: string } {
  const d = getDb()
  const used = d
    .prepare(`SELECT COUNT(*) AS c FROM plant_expenses WHERE outsource_id = ?`)
    .get(payload.id) as { c: number }
  if (used.c > 0) {
    return { ok: false, error: 'Cannot delete: expenses are attributed to this outsource vendor.' }
  }
  d.prepare(`DELETE FROM outsource WHERE id = ?`).run(payload.id)
  return { ok: true }
}
