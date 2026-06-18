import { getDb } from '../db'
import type { Product } from '@shared/types'
import { properCase } from '@shared/types'

// Products are a global master list shared across all plants. The legacy
// plant_id column is kept for backward-compatibility but is no longer used
// (written as 0 and never filtered on).

export async function listProducts(_payload: { plant_id?: number } = {}): Promise<Product[]> {
  return (await getDb()
    .prepare(`SELECT id, name, description, status, created_at FROM products ORDER BY name`)
    .all()) as Product[]
}

export async function createProduct(p: {
  name: string
  description?: string
  status?: string
}): Promise<Product> {
  const d = getDb()
  const name = properCase(p.name)
  if (!name) throw new Error('Product name is required.')
  const dup = (await d
    .prepare(`SELECT id FROM products WHERE LOWER(name) = LOWER(?)`)
    .get(name)) as { id: number } | undefined
  if (dup) throw new Error('A product with this name already exists.')
  const info = await d
    .prepare(`INSERT INTO products (plant_id, name, description, status) VALUES (0, ?, ?, ?)`)
    .run(name, p.description ?? '', p.status ?? 'active')
  return (await d.prepare(`SELECT * FROM products WHERE id = ?`).get(info.lastInsertRowid)) as Product
}

export async function updateProduct(p: {
  id: number
  name: string
  description?: string
  status?: string
}): Promise<Product> {
  const d = getDb()
  const name = properCase(p.name)
  if (!name) throw new Error('Product name is required.')
  const dup = (await d
    .prepare(`SELECT id FROM products WHERE LOWER(name) = LOWER(?) AND id <> ?`)
    .get(name, p.id)) as { id: number } | undefined
  if (dup) throw new Error('A product with this name already exists.')
  await d
    .prepare(`UPDATE products SET name=?, description=?, status=? WHERE id=?`)
    .run(name, p.description ?? '', p.status ?? 'active', p.id)
  return (await d.prepare(`SELECT * FROM products WHERE id = ?`).get(p.id)) as Product
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
  await d.prepare(`DELETE FROM products WHERE id = ?`).run(payload.id)
  return { ok: true }
}
