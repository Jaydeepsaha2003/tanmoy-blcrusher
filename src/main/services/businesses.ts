import { getDb } from '../db'
import type { Business } from '@shared/types'
import { properCase } from '@shared/types'

export async function listBusinesses(): Promise<Business[]> {
  return (await getDb().prepare(`SELECT * FROM businesses ORDER BY name`).all()) as Business[]
}

export async function createBusiness(p: { name: string; contact: string; remarks: string }): Promise<Business> {
  const d = getDb()
  if (!p.name?.trim()) throw new Error('Business name is required.')
  const info = await d
    .prepare(`INSERT INTO businesses (name, contact, remarks) VALUES (?, ?, ?)`)
    .run(properCase(p.name), p.contact ?? '', p.remarks ?? '')
  return (await d.prepare(`SELECT * FROM businesses WHERE id = ?`).get(info.lastInsertRowid)) as Business
}

export async function updateBusiness(p: {
  id: number
  name: string
  contact: string
  remarks: string
}): Promise<Business> {
  const d = getDb()
  await d.prepare(`UPDATE businesses SET name=?, contact=?, remarks=? WHERE id=?`).run(
    properCase(p.name),
    p.contact ?? '',
    p.remarks ?? '',
    p.id
  )
  return (await d.prepare(`SELECT * FROM businesses WHERE id = ?`).get(p.id)) as Business
}

/** Deleting a business unlinks it from its machines (their records are kept). */
export async function deleteBusiness(payload: { id: number }): Promise<{ ok: boolean }> {
  const d = getDb()
  await d.transaction(async () => {
    await d.prepare(`UPDATE assets SET business_id = NULL WHERE business_id = ?`).run(payload.id)
    await d.prepare(`DELETE FROM businesses WHERE id = ?`).run(payload.id)
  })
  return { ok: true }
}
