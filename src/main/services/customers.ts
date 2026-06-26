import { getDb } from '../db'
import type { Customer } from '@shared/types'
import { properCase } from '@shared/types'
import { ensureUniqueName } from './names'
import { plantIdSet, writePartyPlants, attachPartyPlants, plantScopeSql } from './partyPlants'

export async function listCustomers(payload: { plant_id?: number } = {}): Promise<Customer[]> {
  const d = getDb()
  // A plant filter returns common parties (no plants assigned) plus those assigned to it.
  const clause = payload.plant_id ? `WHERE ${plantScopeSql('c', 'customer')}` : ''
  const rows = (await d
    .prepare(
      `SELECT c.*, co.name AS company_name, pl.name AS plant_name
       FROM customers c
       LEFT JOIN companies co ON co.id = c.company_id
       LEFT JOIN plants pl ON pl.id = c.plant_id
       ${clause}
       ORDER BY c.name`
    )
    .all(payload)) as Customer[]
  await attachPartyPlants(d, 'customer', rows)
  for (const c of rows) {
    const agg = (await d
      .prepare(
        `SELECT COALESCE(SUM(quantity),0) AS qty FROM dispatches WHERE customer_id = @id`
      )
      .get({ id: c.id })) as { qty: number }
    const rackAgg = (await d
      .prepare(`SELECT COALESCE(SUM(qty_cm),0) AS qty FROM rack_sales WHERE customer_id = @id`)
      .get({ id: c.id })) as { qty: number }
    c.total_dispatched = Math.round((agg.qty + rackAgg.qty + Number.EPSILON) * 1000) / 1000
  }
  return rows
}

export async function createCustomer(p: {
  name: string
  contact: string
  address: string
  remarks: string
  company_id?: number | null
  plant_id?: number | null
  plant_ids?: number[]
}): Promise<Customer> {
  const d = getDb()
  await ensureUniqueName('customers', p.name, { label: 'A customer' })
  const plants = plantIdSet(p)
  const id = await d.transaction(async () => {
    const info = await d
      .prepare(
        `INSERT INTO customers (name, contact, address, remarks, company_id, plant_id) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        properCase(p.name),
        p.contact ?? '',
        p.address ?? '',
        p.remarks ?? '',
        p.company_id ?? null,
        plants[0] ?? null
      )
    const cid = Number(info.lastInsertRowid)
    await writePartyPlants(d, 'customer', cid, plants)
    return cid
  })
  const row = (await d.prepare(`SELECT * FROM customers WHERE id = ?`).get(id)) as Customer
  await attachPartyPlants(d, 'customer', [row])
  return row
}

export async function updateCustomer(p: {
  id: number
  name: string
  contact: string
  address: string
  remarks: string
  company_id?: number | null
  plant_id?: number | null
  plant_ids?: number[]
}): Promise<Customer> {
  const d = getDb()
  await ensureUniqueName('customers', p.name, { id: p.id, label: 'A customer' })
  const plants = plantIdSet(p)
  await d.transaction(async () => {
    await d.prepare(
      `UPDATE customers SET name=?, contact=?, address=?, remarks=?, company_id=?, plant_id=? WHERE id=?`
    ).run(
      properCase(p.name),
      p.contact ?? '',
      p.address ?? '',
      p.remarks ?? '',
      p.company_id ?? null,
      plants[0] ?? null,
      p.id
    )
    await writePartyPlants(d, 'customer', p.id, plants)
  })
  const row = (await d.prepare(`SELECT * FROM customers WHERE id = ?`).get(p.id)) as Customer
  await attachPartyPlants(d, 'customer', [row])
  return row
}

export async function deleteCustomer(payload: { id: number }): Promise<{ ok: boolean; error?: string }> {
  const d = getDb()
  const used = (await d
    .prepare(`SELECT COUNT(*) AS c FROM dispatches WHERE customer_id = ?`)
    .get(payload.id)) as { c: number }
  const rackUsed = (await d
    .prepare(`SELECT COUNT(*) AS c FROM rack_sales WHERE customer_id = ?`)
    .get(payload.id)) as { c: number }
  if (used.c > 0 || rackUsed.c > 0) {
    return { ok: false, error: 'Cannot delete: this customer has sales/dispatch records.' }
  }
  await d.transaction(async () => {
    await d.prepare(`DELETE FROM customer_plants WHERE customer_id = ?`).run(payload.id)
    await d.prepare(`DELETE FROM customers WHERE id = ?`).run(payload.id)
  })
  return { ok: true }
}
