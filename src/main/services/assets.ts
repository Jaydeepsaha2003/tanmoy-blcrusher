import { getDb } from '../db'
import type { Asset, AssetReport } from '@shared/types'
import { properCase } from '@shared/types'
import { avgDieselRate } from './diesel'

export function listAssets(payload: { plant_id?: number } = {}): Asset[] {
  const d = getDb()
  const clause = payload.plant_id ? `WHERE (a.plant_id IS NULL OR a.plant_id = @plant_id)` : ''
  return d
    .prepare(
      `SELECT a.*, p.name AS plant_name, b.name AS business_name
       FROM assets a
       LEFT JOIN plants p ON p.id = a.plant_id
       LEFT JOIN businesses b ON b.id = a.business_id
       ${clause}
       ORDER BY a.asset_type, a.name`
    )
    .all(payload) as Asset[]
}

export function createAsset(p: {
  name: string
  asset_type: string
  category: string
  identifier: string
  plant_id?: number | null
  business_id?: number | null
  status: string
  remarks: string
}): Asset {
  const d = getDb()
  if (!p.name?.trim()) throw new Error('Name is required.')
  const info = d
    .prepare(
      `INSERT INTO assets (name, asset_type, category, identifier, plant_id, business_id, status, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      properCase(p.name),
      p.asset_type || 'machine',
      properCase(p.category),
      (p.identifier ?? '').trim().toUpperCase(),
      p.plant_id ?? null,
      p.business_id ?? null,
      p.status || 'active',
      p.remarks ?? ''
    )
  return d.prepare(`SELECT * FROM assets WHERE id = ?`).get(info.lastInsertRowid) as Asset
}

export function updateAsset(p: {
  id: number
  name: string
  asset_type: string
  category: string
  identifier: string
  plant_id?: number | null
  business_id?: number | null
  status: string
  remarks: string
}): Asset {
  const d = getDb()
  d.prepare(
    `UPDATE assets SET name=?, asset_type=?, category=?, identifier=?, plant_id=?, business_id=?, status=?, remarks=? WHERE id=?`
  ).run(
    properCase(p.name),
    p.asset_type || 'machine',
    properCase(p.category),
    (p.identifier ?? '').trim().toUpperCase(),
    p.plant_id ?? null,
    p.business_id ?? null,
    p.status || 'active',
    p.remarks ?? '',
    p.id
  )
  return d.prepare(`SELECT * FROM assets WHERE id = ?`).get(p.id) as Asset
}

/** Per-machine report: diesel, maintenance, rent earned, operator wages and net to its business. */
export function assetReport(payload: { id: number }): AssetReport {
  const d = getDb()
  const a = d
    .prepare(
      `SELECT a.name, b.name AS business_name FROM assets a
       LEFT JOIN businesses b ON b.id = a.business_id WHERE a.id = ?`
    )
    .get(payload.id) as { name: string; business_name: string | null } | undefined
  if (!a) throw new Error('Asset not found.')
  const litres = (
    d.prepare(`SELECT COALESCE(SUM(litres),0) AS q FROM diesel_issues WHERE asset_id = ?`).get(payload.id) as {
      q: number
    }
  ).q
  const dieselCost = litres * avgDieselRate()
  const exp = d
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN category='maintenance' THEN amount ELSE 0 END),0) AS maintenance,
        COALESCE(SUM(CASE WHEN category IN ('tipper_rent','equipment_rent') THEN amount ELSE 0 END),0) AS rent,
        COALESCE(SUM(CASE WHEN category NOT IN ('maintenance','tipper_rent','equipment_rent') THEN amount ELSE 0 END),0) AS other
       FROM plant_expenses WHERE asset_id = ?`
    )
    .get(payload.id) as { maintenance: number; rent: number; other: number }
  const wages = (
    d.prepare(`SELECT COALESCE(SUM(amount),0) AS q FROM wage_entries WHERE asset_id = ?`).get(payload.id) as {
      q: number
    }
  ).q
  const money = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100
  const net = money(exp.rent - dieselCost - exp.maintenance - exp.other - wages)
  return {
    asset_id: payload.id,
    asset_name: a.name,
    business_name: a.business_name,
    diesel_litres: money(litres),
    diesel_cost: money(dieselCost),
    maintenance: money(exp.maintenance),
    other_expense: money(exp.other),
    wages: money(wages),
    rent_income: money(exp.rent),
    net
  }
}

export function deleteAsset(payload: { id: number }): { ok: boolean; error?: string } {
  const d = getDb()
  const used = d
    .prepare(`SELECT COUNT(*) AS c FROM plant_expenses WHERE asset_id = ?`)
    .get(payload.id) as { c: number }
  if (used.c > 0) {
    return { ok: false, error: 'Cannot delete: this asset has expense records.' }
  }
  d.prepare(`DELETE FROM assets WHERE id = ?`).run(payload.id)
  return { ok: true }
}
