import { getDb } from '../db'
import type { Product } from '@shared/types'
import { properCase } from '@shared/types'
import { plantIdSet, writePartyPlants, attachPartyPlants, plantScopeSql } from './partyPlants'

// Products are a global master list (referenced by name across all plants), but
// each product can be tagged with the plants it belongs to so the master list
// shows only the relevant products per plant. A product with no plant tags is
// "common" — visible at every plant. The legacy plant_id column is unused
// (written as 0); the product_plants junction holds the assignments.

export async function listProducts(payload: { plant_id?: number } = {}): Promise<Product[]> {
  const d = getDb()
  const clause = payload.plant_id ? `WHERE ${plantScopeSql('p', 'product')}` : ''
  const rows = (await d
    .prepare(`SELECT p.id, p.name, p.description, p.status, p.created_at FROM products p ${clause} ORDER BY p.name`)
    .all(payload)) as Product[]
  await attachPartyPlants(d, 'product', rows)
  return rows
}

export async function createProduct(p: {
  name: string
  description?: string
  status?: string
  plant_ids?: number[]
}): Promise<Product> {
  const d = getDb()
  const name = properCase(p.name)
  if (!name) throw new Error('Product name is required.')
  const dup = (await d
    .prepare(`SELECT id FROM products WHERE LOWER(name) = LOWER(?)`)
    .get(name)) as { id: number } | undefined
  if (dup) throw new Error('A product with this name already exists.')
  const plants = plantIdSet(p)
  const id = await d.transaction(async () => {
    const info = await d
      .prepare(`INSERT INTO products (plant_id, name, description, status) VALUES (0, ?, ?, ?)`)
      .run(name, p.description ?? '', p.status ?? 'active')
    const pid = Number(info.lastInsertRowid)
    await writePartyPlants(d, 'product', pid, plants)
    return pid
  })
  const row = (await d.prepare(`SELECT * FROM products WHERE id = ?`).get(id)) as Product
  await attachPartyPlants(d, 'product', [row])
  return row
}

export async function updateProduct(p: {
  id: number
  name: string
  description?: string
  status?: string
  plant_ids?: number[]
}): Promise<Product> {
  const d = getDb()
  const name = properCase(p.name)
  if (!name) throw new Error('Product name is required.')
  const dup = (await d
    .prepare(`SELECT id FROM products WHERE LOWER(name) = LOWER(?) AND id <> ?`)
    .get(name, p.id)) as { id: number } | undefined
  if (dup) throw new Error('A product with this name already exists.')
  const plants = plantIdSet(p)
  await d.transaction(async () => {
    await d
      .prepare(`UPDATE products SET name=?, description=?, status=? WHERE id=?`)
      .run(name, p.description ?? '', p.status ?? 'active', p.id)
    await writePartyPlants(d, 'product', p.id, plants)
  })
  const row = (await d.prepare(`SELECT * FROM products WHERE id = ?`).get(p.id)) as Product
  await attachPartyPlants(d, 'product', [row])
  return row
}

export async function deleteProduct(payload: { id: number }): Promise<{ ok: boolean; error?: string }> {
  const d = getDb()
  const prod = (await d.prepare(`SELECT * FROM products WHERE id = ?`).get(payload.id)) as
    | Product
    | undefined
  if (!prod) return { ok: false, error: 'Product not found.' }
  // Block deletion while any plant's production settings still reference the name.
  const used = (await d
    .prepare(`SELECT COUNT(*) AS c FROM production_settings WHERE LOWER(product_name) = LOWER(?)`)
    .get(prod.name)) as { c: number }
  if (used.c > 0) {
    return { ok: false, error: 'Cannot delete: this product is used in Production Settings.' }
  }
  await d.transaction(async () => {
    await d.prepare(`DELETE FROM product_plants WHERE product_id = ?`).run(payload.id)
    await d.prepare(`DELETE FROM products WHERE id = ?`).run(payload.id)
  })
  return { ok: true }
}
