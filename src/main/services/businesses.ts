import { getDb } from '../db'
import type { Business } from '@shared/types'
import { properCase } from '@shared/types'

export function listBusinesses(): Business[] {
  return getDb().prepare(`SELECT * FROM businesses ORDER BY name`).all() as Business[]
}

export function createBusiness(p: { name: string; contact: string; remarks: string }): Business {
  const d = getDb()
  if (!p.name?.trim()) throw new Error('Business name is required.')
  const info = d
    .prepare(`INSERT INTO businesses (name, contact, remarks) VALUES (?, ?, ?)`)
    .run(properCase(p.name), p.contact ?? '', p.remarks ?? '')
  return d.prepare(`SELECT * FROM businesses WHERE id = ?`).get(info.lastInsertRowid) as Business
}

export function updateBusiness(p: {
  id: number
  name: string
  contact: string
  remarks: string
}): Business {
  const d = getDb()
  d.prepare(`UPDATE businesses SET name=?, contact=?, remarks=? WHERE id=?`).run(
    properCase(p.name),
    p.contact ?? '',
    p.remarks ?? '',
    p.id
  )
  return d.prepare(`SELECT * FROM businesses WHERE id = ?`).get(p.id) as Business
}

/** Deleting a business unlinks it from its machines (their records are kept). */
export function deleteBusiness(payload: { id: number }): { ok: boolean } {
  const d = getDb()
  const tx = d.transaction(() => {
    d.prepare(`UPDATE assets SET business_id = NULL WHERE business_id = ?`).run(payload.id)
    d.prepare(`DELETE FROM businesses WHERE id = ?`).run(payload.id)
  })
  tx()
  return { ok: true }
}
