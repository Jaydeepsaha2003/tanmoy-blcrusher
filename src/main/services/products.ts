import { getDb } from '../db'
import type { Product } from '@shared/types'
import { properCase } from '@shared/types'

export async function listProducts(payload: { plant_id?: number } = {}): Promise<Product[]> {
  const d = getDb()
  const clause = payload.plant_id ? 'WHERE p.plant_id = @plant_id' : ''
  return (await d
    .prepare(
      `SELECT p.*, pl.name AS plant_name
       FROM products p
       JOIN plants pl ON pl.id = p.plant_id
       ${clause}
       ORDER BY pl.name, p.name`
    )
    .all(payload)) as Product[]
}

export async function createProduct(p: {
  plant_id: number
  name: string
  description?: string
  status?: string
}): Promise<Product> {
  const d = getDb()
  if (!p.plant_id) throw new Error('Select a plant for this product.')
  const name = properCase(p.name)
  if (!name) throw new Error('Product name is required.')
  const dup = (await d
    .prepare(`SELECT id FROM products WHERE plant_id = ? AND LOWER(name) = LOWER(?)`)
    .get(p.plant_id, name)) as { id: number } | undefined
  if (dup) throw new Error('A product with this name already exists for this plant.')
  const info = await d
    .prepare(`INSERT INTO products (plant_id, name, description, status) VALUES (?, ?, ?, ?)`)
    .run(p.plant_id, name, p.description ?? '', p.status ?? 'active')
  return (await d.prepare(`SELECT * FROM products WHERE id = ?`).get(info.lastInsertRowid)) as Product
}

export async function updateProduct(p: {
  id: number
  plant_id: number
  name: string
  description?: string
  status?: string
}): Promise<Product> {
  const d = getDb()
  const name = properCase(p.name)
  if (!name) throw new Error('Product name is required.')
  const dup = (await d
    .prepare(`SELECT id FROM products WHERE plant_id = ? AND LOWER(name) = LOWER(?) AND id <> ?`)
    .get(p.plant_id, name, p.id)) as { id: number } | undefined
  if (dup) throw new Error('A product with this name already exists for this plant.')
  await d
    .prepare(`UPDATE products SET plant_id=?, name=?, description=?, status=? WHERE id=?`)
    .run(p.plant_id, name, p.description ?? '', p.status ?? 'active', p.id)
  return (await d.prepare(`SELECT * FROM products WHERE id = ?`).get(p.id)) as Product
}

export async function deleteProduct(payload: { id: number }): Promise<{ ok: boolean; error?: string }> {
  const d = getDb()
  const prod = (await d.prepare(`SELECT * FROM products WHERE id = ?`).get(payload.id)) as
    | Product
    | undefined
  if (!prod) return { ok: false, error: 'Product not found.' }
  // Block deletion while a plant's production settings still reference the name,
  // so the production dropdown never points at a missing product.
  const used = (await d
    .prepare(
      `SELECT COUNT(*) AS c FROM production_settings WHERE plant_id = ? AND LOWER(product_name) = LOWER(?)`
    )
    .get(prod.plant_id, prod.name)) as { c: number }
  if (used.c > 0) {
    return {
      ok: false,
      error: 'Cannot delete: this product is used in Production Settings for its plant.'
    }
  }
  await d.prepare(`DELETE FROM products WHERE id = ?`).run(payload.id)
  return { ok: true }
}
