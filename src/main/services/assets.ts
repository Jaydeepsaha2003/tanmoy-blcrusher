import { getDb, type Db } from '../db'
import type { Asset, AssetReport } from '@shared/types'
import { properCase } from '@shared/types'
import { avgDieselRate } from './diesel'

/** Attach the availability plant set (plant_ids/plant_names) to each asset. */
async function attachPlants(d: Db, assets: Asset[]): Promise<Asset[]> {
  if (assets.length === 0) return assets
  const rows = (await d
    .prepare(
      `SELECT ap.asset_id, ap.plant_id, p.name AS plant_name
       FROM asset_plants ap JOIN plants p ON p.id = ap.plant_id ORDER BY p.name`
    )
    .all()) as { asset_id: number; plant_id: number; plant_name: string }[]
  const byAsset = new Map<number, { ids: number[]; names: string[] }>()
  for (const r of rows) {
    const e = byAsset.get(r.asset_id) ?? { ids: [], names: [] }
    e.ids.push(r.plant_id)
    e.names.push(r.plant_name)
    byAsset.set(r.asset_id, e)
  }
  for (const a of assets) {
    const e = byAsset.get(a.id)
    a.plant_ids = e?.ids ?? []
    a.plant_names = e?.names ?? []
  }
  return assets
}

export async function listAssets(payload: { plant_id?: number } = {}): Promise<Asset[]> {
  const d = getDb()
  // An asset shows at a plant when it's assigned there, or when it has no
  // assignments at all (shared across every plant).
  const clause = payload.plant_id
    ? `WHERE EXISTS (SELECT 1 FROM asset_plants ap WHERE ap.asset_id = a.id AND ap.plant_id = @plant_id)
         OR NOT EXISTS (SELECT 1 FROM asset_plants ap2 WHERE ap2.asset_id = a.id)`
    : ''
  const assets = (await d
    .prepare(
      `SELECT a.*, b.name AS business_name
       FROM assets a
       LEFT JOIN businesses b ON b.id = a.business_id
       ${clause}
       ORDER BY a.asset_type, a.name`
    )
    .all(payload)) as Asset[]
  return attachPlants(d, assets)
}

interface AssetInput {
  name: string
  asset_type: string
  category: string
  identifier: string
  plant_id?: number | null
  plant_ids?: number[]
  business_id?: number | null
  meter_type?: string
  standard_consumption?: number | null
  status: string
  remarks: string
}

/** Resolve the requested plant set: explicit plant_ids, else the legacy single plant_id. */
function plantSet(p: AssetInput): number[] {
  if (Array.isArray(p.plant_ids)) return [...new Set(p.plant_ids.map(Number).filter((n) => n > 0))]
  return p.plant_id ? [Number(p.plant_id)] : []
}
async function writeAssetPlants(d: Db, assetId: number, plantIds: number[]): Promise<void> {
  await d.prepare(`DELETE FROM asset_plants WHERE asset_id = ?`).run(assetId)
  const stmt = d.prepare(`INSERT INTO asset_plants (asset_id, plant_id) VALUES (?, ?)`)
  for (const pid of plantIds) await stmt.run(assetId, pid)
}

function meterTypeOf(p: AssetInput): string {
  if (p.meter_type === 'hour' || p.meter_type === 'km') return p.meter_type
  // Sensible default: vehicles read km, machines read hours.
  return p.asset_type === 'vehicle' ? 'km' : 'hour'
}
function stdConsumption(p: AssetInput): number | null {
  return p.standard_consumption == null || (p.standard_consumption as unknown) === ''
    ? null
    : Number(p.standard_consumption)
}

export async function createAsset(p: AssetInput): Promise<Asset> {
  const d = getDb()
  if (!p.name?.trim()) throw new Error('Name is required.')
  const plants = plantSet(p)
  const id = await d.transaction(async () => {
    const info = await d
      .prepare(
        `INSERT INTO assets (name, asset_type, category, identifier, plant_id, business_id, meter_type, standard_consumption, status, remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        properCase(p.name),
        p.asset_type || 'machine',
        properCase(p.category),
        (p.identifier ?? '').trim().toUpperCase(),
        plants[0] ?? null,
        p.business_id ?? null,
        meterTypeOf(p),
        stdConsumption(p),
        p.status || 'active',
        p.remarks ?? ''
      )
    const assetId = Number(info.lastInsertRowid)
    await writeAssetPlants(d, assetId, plants)
    return assetId
  })
  return (await d.prepare(`SELECT * FROM assets WHERE id = ?`).get(id)) as Asset
}

export async function updateAsset(p: AssetInput & { id: number }): Promise<Asset> {
  const d = getDb()
  const plants = plantSet(p)
  await d.transaction(async () => {
    await d.prepare(
      `UPDATE assets SET name=?, asset_type=?, category=?, identifier=?, plant_id=?, business_id=?, meter_type=?, standard_consumption=?, status=?, remarks=? WHERE id=?`
    ).run(
      properCase(p.name),
      p.asset_type || 'machine',
      properCase(p.category),
      (p.identifier ?? '').trim().toUpperCase(),
      plants[0] ?? null,
      p.business_id ?? null,
      meterTypeOf(p),
      stdConsumption(p),
      p.status || 'active',
      p.remarks ?? '',
      p.id
    )
    await writeAssetPlants(d, p.id, plants)
  })
  return (await d.prepare(`SELECT * FROM assets WHERE id = ?`).get(p.id)) as Asset
}

/** Reassign an asset's plant set and record the move in the history. */
export async function moveAsset(p: {
  id: number
  plant_ids: number[]
  date: string
  remarks?: string
}): Promise<Asset> {
  const d = getDb()
  const old = (await d.prepare(`SELECT plant_id FROM assets WHERE id = ?`).get(p.id)) as
    | { plant_id: number | null }
    | undefined
  if (!old) throw new Error('Machine not found.')
  const plants = [...new Set((p.plant_ids ?? []).map(Number).filter((n) => n > 0))]
  await d.transaction(async () => {
    await d
      .prepare(
        `INSERT INTO asset_plant_moves (asset_id, from_plant_id, to_plant_id, date, remarks) VALUES (?, ?, ?, ?, ?)`
      )
      .run(p.id, old.plant_id ?? null, plants[0] ?? null, p.date || new Date().toISOString().slice(0, 10), p.remarks ?? '')
    await d.prepare(`UPDATE assets SET plant_id = ? WHERE id = ?`).run(plants[0] ?? null, p.id)
    await writeAssetPlants(d, p.id, plants)
  })
  return (await d.prepare(`SELECT * FROM assets WHERE id = ?`).get(p.id)) as Asset
}

/** Plant-move history for a machine (most recent first). */
export async function assetMoves(payload: { id: number }): Promise<
  { id: number; from_plant_name: string | null; to_plant_name: string | null; date: string; remarks: string }[]
> {
  return (await getDb()
    .prepare(
      `SELECT m.id, m.date, m.remarks, fp.name AS from_plant_name, tp.name AS to_plant_name
       FROM asset_plant_moves m
       LEFT JOIN plants fp ON fp.id = m.from_plant_id
       LEFT JOIN plants tp ON tp.id = m.to_plant_id
       WHERE m.asset_id = ? ORDER BY m.date DESC, m.id DESC`
    )
    .all(payload.id)) as never
}

/** Per-machine report: diesel, maintenance, rent earned, operator wages and net to its business. */
export async function assetReport(payload: { id: number }): Promise<AssetReport> {
  const d = getDb()
  const a = (await d
    .prepare(
      `SELECT a.name, b.name AS business_name FROM assets a
       LEFT JOIN businesses b ON b.id = a.business_id WHERE a.id = ?`
    )
    .get(payload.id)) as { name: string; business_name: string | null } | undefined
  if (!a) throw new Error('Asset not found.')
  const litres = (
    (await d.prepare(`SELECT COALESCE(SUM(litres),0) AS q FROM diesel_issues WHERE asset_id = ?`).get(payload.id)) as {
      q: number
    }
  ).q
  const dieselCost = litres * (await avgDieselRate())
  const exp = (await d
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN category='maintenance' THEN amount ELSE 0 END),0) AS maintenance,
        COALESCE(SUM(CASE WHEN category IN ('tipper_rent','equipment_rent') THEN amount ELSE 0 END),0) AS rent,
        COALESCE(SUM(CASE WHEN category NOT IN ('maintenance','tipper_rent','equipment_rent') THEN amount ELSE 0 END),0) AS other
       FROM plant_expenses WHERE asset_id = ?`
    )
    .get(payload.id)) as { maintenance: number; rent: number; other: number }
  const wages = (
    (await d.prepare(`SELECT COALESCE(SUM(amount),0) AS q FROM wage_entries WHERE asset_id = ?`).get(payload.id)) as {
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

export async function deleteAsset(payload: { id: number }): Promise<{ ok: boolean; error?: string }> {
  const d = getDb()
  const used = (await d
    .prepare(`SELECT COUNT(*) AS c FROM plant_expenses WHERE asset_id = ?`)
    .get(payload.id)) as { c: number }
  if (used.c > 0) {
    return { ok: false, error: 'Cannot delete: this asset has expense records.' }
  }
  await d.transaction(async () => {
    await d.prepare(`DELETE FROM machine_logs WHERE asset_id = ?`).run(payload.id)
    await d.prepare(`DELETE FROM asset_documents WHERE asset_id = ?`).run(payload.id)
    await d.prepare(`DELETE FROM assets WHERE id = ?`).run(payload.id)
  })
  return { ok: true }
}
