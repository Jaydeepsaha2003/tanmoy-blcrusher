import { randomBytes } from 'node:crypto'
import { getDb, dbKind } from '../db'
import type { CustomerRate, PublicRateList, Uom } from '@shared/types'
import { properCase } from '@shared/types'

const VALID_UOM: Uom[] = ['CM', 'TON', 'CFT']

function nowIso(): string {
  return new Date().toISOString()
}

export async function listCustomerRates(payload: { customer_id: number }): Promise<CustomerRate[]> {
  if (!payload.customer_id) return []
  return (await getDb()
    .prepare(
      `SELECT id, customer_id, product_name, uom, rate, updated_at
       FROM customer_rates
       WHERE customer_id = ?
       ORDER BY product_name, uom`
    )
    .all(payload.customer_id)) as CustomerRate[]
}

/** Bulk-replace the whole rate list for one customer (products are global). */
export async function saveCustomerRates(payload: {
  customer_id: number
  items: { product_name: string; uom: Uom; rate: number }[]
}): Promise<{ ok: boolean; error?: string }> {
  const d = getDb()
  if (!payload.customer_id) return { ok: false, error: 'Select a customer.' }
  const items = (payload.items ?? [])
    .map((i) => ({
      product_name: properCase(i.product_name),
      uom: (VALID_UOM as string[]).includes(i.uom) ? i.uom : 'CM',
      rate: Number(i.rate) || 0
    }))
    .filter((i) => i.product_name)
  // Guard against duplicate product+uom rows.
  const seen = new Set<string>()
  for (const i of items) {
    const key = `${i.product_name.toLowerCase()}|${i.uom}`
    if (seen.has(key)) {
      return { ok: false, error: `Duplicate rate for ${i.product_name} (${i.uom}).` }
    }
    seen.add(key)
  }
  const ts = nowIso()
  await d.transaction(async () => {
    await d.prepare(`DELETE FROM customer_rates WHERE customer_id = ?`).run(payload.customer_id)
    // plant_id column is legacy/global now — written as 0.
    const stmt = d.prepare(
      `INSERT INTO customer_rates (customer_id, plant_id, product_name, uom, rate, updated_at)
       VALUES (?, 0, ?, ?, ?, ?)`
    )
    for (const i of items) {
      await stmt.run(payload.customer_id, i.product_name, i.uom, i.rate, ts)
    }
  })
  return { ok: true }
}

/** Ensure the customer has a public share token; return it + the relative path. */
export async function customerShareLink(payload: {
  customer_id: number
}): Promise<{ token: string; path: string }> {
  const d = getDb()
  const row = (await d
    .prepare(`SELECT share_token FROM customers WHERE id = ?`)
    .get(payload.customer_id)) as { share_token: string | null } | undefined
  if (!row) throw new Error('Customer not found.')
  let token = row.share_token
  if (!token) {
    token = randomBytes(16).toString('hex')
    await d.prepare(`UPDATE customers SET share_token = ? WHERE id = ?`).run(token, payload.customer_id)
  }
  return { token, path: `/rates/${token}` }
}

/** Revoke the share link (a fresh one is generated next time it's shared). */
export async function revokeShareLink(payload: { customer_id: number }): Promise<{ ok: boolean }> {
  await getDb().prepare(`UPDATE customers SET share_token = NULL WHERE id = ?`).run(payload.customer_id)
  return { ok: true }
}

async function getBusinessNameInternal(): Promise<string> {
  const row = (await getDb()
    .prepare('SELECT value FROM settings WHERE `key` = ?')
    .get('business_name')) as { value: string } | undefined
  return (row?.value || '').trim() || 'BL Crushing'
}

export async function getBusinessName(): Promise<{ business_name: string }> {
  return { business_name: await getBusinessNameInternal() }
}

export async function setBusinessName(payload: { business_name: string }): Promise<{ ok: boolean }> {
  const value = (payload.business_name ?? '').trim()
  const sql =
    dbKind() === 'mysql'
      ? 'INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)'
      : 'INSERT INTO settings (`key`, value) VALUES (?, ?) ON CONFLICT(`key`) DO UPDATE SET value = excluded.value'
  await getDb().prepare(sql).run('business_name', value)
  return { ok: true }
}

/**
 * Public, no-login rate page data, looked up by the customer's share token.
 * Returns null when the token is unknown/revoked. Reads live, so backend edits
 * show up immediately for the customer.
 */
export async function publicRateList(payload: { token: string }): Promise<PublicRateList | null> {
  const token = (payload.token ?? '').trim()
  if (!token) return null
  const d = getDb()
  const customer = (await d
    .prepare(`SELECT id, name FROM customers WHERE share_token = ?`)
    .get(token)) as { id: number; name: string } | undefined
  if (!customer) return null
  const rows = (await d
    .prepare(
      `SELECT product_name, uom, rate, updated_at
       FROM customer_rates
       WHERE customer_id = ?
       ORDER BY product_name, uom`
    )
    .all(customer.id)) as {
    product_name: string
    uom: Uom
    rate: number
    updated_at: string
  }[]

  let updated: string | null = null
  for (const r of rows) {
    if (r.updated_at && (!updated || r.updated_at > updated)) updated = r.updated_at
  }
  return {
    customer_name: customer.name,
    business_name: await getBusinessNameInternal(),
    updated_at: updated,
    rates: rows.map((r) => ({ product_name: r.product_name, uom: r.uom, rate: r.rate }))
  }
}
