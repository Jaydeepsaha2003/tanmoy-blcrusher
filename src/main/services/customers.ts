import { getDb } from '../db'
import type { Customer } from '@shared/types'
import { properCase } from '@shared/types'
import { ensureUniqueName } from './names'

export async function listCustomers(payload: { plant_id?: number } = {}): Promise<Customer[]> {
  const d = getDb()
  // A plant filter returns common parties (no plant) plus that plant's own.
  const clause = payload.plant_id ? `WHERE (c.plant_id IS NULL OR c.plant_id = @plant_id)` : ''
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
}): Promise<Customer> {
  const d = getDb()
  await ensureUniqueName('customers', p.name, { label: 'A customer' })
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
      p.plant_id ?? null
    )
  return (await d.prepare(`SELECT * FROM customers WHERE id = ?`).get(info.lastInsertRowid)) as Customer
}

export async function updateCustomer(p: {
  id: number
  name: string
  contact: string
  address: string
  remarks: string
  company_id?: number | null
  plant_id?: number | null
}): Promise<Customer> {
  const d = getDb()
  await ensureUniqueName('customers', p.name, { id: p.id, label: 'A customer' })
  await d.prepare(
    `UPDATE customers SET name=?, contact=?, address=?, remarks=?, company_id=?, plant_id=? WHERE id=?`
  ).run(
    properCase(p.name),
    p.contact ?? '',
    p.address ?? '',
    p.remarks ?? '',
    p.company_id ?? null,
    p.plant_id ?? null,
    p.id
  )
  return (await d.prepare(`SELECT * FROM customers WHERE id = ?`).get(p.id)) as Customer
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
  await d.prepare(`DELETE FROM customers WHERE id = ?`).run(payload.id)
  return { ok: true }
}
