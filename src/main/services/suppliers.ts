import { getDb } from '../db'
import type { Supplier } from '@shared/types'
import { properCase } from '@shared/types'
import { ensureUniqueName } from './names'
import { plantIdSet, writePartyPlants, attachPartyPlants, plantScopeSql } from './partyPlants'

export async function listSuppliers(payload: { plant_id?: number } = {}): Promise<Supplier[]> {
  const d = getDb()
  const clause = payload.plant_id ? `WHERE ${plantScopeSql('s', 'supplier')}` : ''
  const rows = (await d
    .prepare(
      `SELECT s.*, co.name AS company_name, pl.name AS plant_name
       FROM suppliers s
       LEFT JOIN companies co ON co.id = s.company_id
       LEFT JOIN plants pl ON pl.id = s.plant_id
       ${clause}
       ORDER BY s.name`
    )
    .all(payload)) as Supplier[]
  await attachPartyPlants(d, 'supplier', rows)
  for (const s of rows) {
    const agg = (await d
      .prepare(
        `SELECT
           COALESCE(SUM(quantity),0) AS qty,
           COALESCE(SUM(amount),0) AS amt,
           COALESCE(SUM(paid_amount),0) AS paid
         FROM purchases WHERE supplier_id = ?`
      )
      .get(s.id)) as { qty: number; amt: number; paid: number }
    s.total_purchased = round(agg.qty)
    s.total_amount = round(agg.amt)
    s.paid_amount = round(agg.paid)
    s.unpaid_amount = round(agg.amt - agg.paid)
  }
  return rows
}

export async function createSupplier(p: {
  name: string
  contact: string
  address: string
  remarks: string
  company_id?: number | null
  plant_id?: number | null
  plant_ids?: number[]
}): Promise<Supplier> {
  const d = getDb()
  await ensureUniqueName('suppliers', p.name, { label: 'A supplier' })
  const plants = plantIdSet(p)
  const id = await d.transaction(async () => {
    const info = await d
      .prepare(
        `INSERT INTO suppliers (name, contact, address, remarks, company_id, plant_id) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        properCase(p.name),
        p.contact ?? '',
        p.address ?? '',
        p.remarks ?? '',
        p.company_id ?? null,
        plants[0] ?? null
      )
    const sid = Number(info.lastInsertRowid)
    await writePartyPlants(d, 'supplier', sid, plants)
    return sid
  })
  const row = (await d.prepare(`SELECT * FROM suppliers WHERE id = ?`).get(id)) as Supplier
  await attachPartyPlants(d, 'supplier', [row])
  return row
}

export async function updateSupplier(p: {
  id: number
  name: string
  contact: string
  address: string
  remarks: string
  company_id?: number | null
  plant_id?: number | null
  plant_ids?: number[]
}): Promise<Supplier> {
  const d = getDb()
  await ensureUniqueName('suppliers', p.name, { id: p.id, label: 'A supplier' })
  const plants = plantIdSet(p)
  await d.transaction(async () => {
    await d.prepare(
      `UPDATE suppliers SET name=?, contact=?, address=?, remarks=?, company_id=?, plant_id=? WHERE id=?`
    ).run(
      properCase(p.name),
      p.contact ?? '',
      p.address ?? '',
      p.remarks ?? '',
      p.company_id ?? null,
      plants[0] ?? null,
      p.id
    )
    await writePartyPlants(d, 'supplier', p.id, plants)
  })
  const row = (await d.prepare(`SELECT * FROM suppliers WHERE id = ?`).get(p.id)) as Supplier
  await attachPartyPlants(d, 'supplier', [row])
  return row
}

export async function deleteSupplier(payload: { id: number }): Promise<{ ok: boolean; error?: string }> {
  const d = getDb()
  const used = (await d
    .prepare(`SELECT COUNT(*) AS c FROM purchases WHERE supplier_id = ?`)
    .get(payload.id)) as { c: number }
  if (used.c > 0) {
    return { ok: false, error: 'Cannot delete: this supplier has purchase records.' }
  }
  await d.transaction(async () => {
    await d.prepare(`DELETE FROM supplier_plants WHERE supplier_id = ?`).run(payload.id)
    await d.prepare(`DELETE FROM suppliers WHERE id = ?`).run(payload.id)
  })
  return { ok: true }
}

function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
