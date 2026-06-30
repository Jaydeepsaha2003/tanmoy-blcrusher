import { type Db } from '../db'

/** Junction table + party-id column for each plant-scoped party type. */
export const PARTY_PLANT_TABLE: Record<string, { junction: string; col: string }> = {
  customer: { junction: 'customer_plants', col: 'customer_id' },
  supplier: { junction: 'supplier_plants', col: 'supplier_id' },
  transporter: { junction: 'transporter_plants', col: 'transporter_id' },
  company: { junction: 'company_plants', col: 'company_id' },
  rack_vehicle: { junction: 'rack_vehicle_plants', col: 'rack_vehicle_id' },
  rack_jcb: { junction: 'rack_jcb_plants', col: 'rack_jcb_id' },
  product: { junction: 'product_plants', col: 'product_id' }
}

/** Resolve the requested plant set: explicit plant_ids, else the legacy single plant_id. */
export function plantIdSet(p: { plant_ids?: number[]; plant_id?: number | null }): number[] {
  if (Array.isArray(p.plant_ids)) return [...new Set(p.plant_ids.map(Number).filter((n) => n > 0))]
  return p.plant_id ? [Number(p.plant_id)] : []
}

/** Replace a party's plant assignments in its junction table. */
export async function writePartyPlants(
  d: Db,
  partyType: keyof typeof PARTY_PLANT_TABLE | string,
  partyId: number,
  plantIds: number[]
): Promise<void> {
  const m = PARTY_PLANT_TABLE[partyType]
  if (!m) return
  await d.prepare(`DELETE FROM ${m.junction} WHERE ${m.col} = ?`).run(partyId)
  const stmt = d.prepare(`INSERT INTO ${m.junction} (${m.col}, plant_id) VALUES (?, ?)`)
  for (const pid of plantIds) await stmt.run(partyId, pid)
}

/** Attach plant_ids / plant_names (the plants a party works with) to each row. Empty = all plants. */
export async function attachPartyPlants<T extends { id: number; plant_ids?: number[]; plant_names?: string[] }>(
  d: Db,
  partyType: keyof typeof PARTY_PLANT_TABLE | string,
  rows: T[]
): Promise<T[]> {
  const m = PARTY_PLANT_TABLE[partyType]
  if (!m || rows.length === 0) return rows
  const jrows = (await d
    .prepare(
      `SELECT jp.${m.col} AS party_id, jp.plant_id, p.name AS plant_name
       FROM ${m.junction} jp JOIN plants p ON p.id = jp.plant_id ORDER BY p.name`
    )
    .all()) as { party_id: number; plant_id: number; plant_name: string }[]
  const by = new Map<number, { ids: number[]; names: string[] }>()
  for (const r of jrows) {
    const e = by.get(r.party_id) ?? { ids: [], names: [] }
    e.ids.push(r.plant_id)
    e.names.push(r.plant_name)
    by.set(r.party_id, e)
  }
  for (const row of rows) {
    const e = by.get(row.id)
    row.plant_ids = e?.ids ?? []
    row.plant_names = e?.names ?? []
  }
  return rows
}

/**
 * SQL predicate: party (aliased `alias`) is visible at a plant when it is assigned there,
 * or when it has no plant assignments at all (shared across every plant).
 * `plantParam` is a named placeholder ('@plant_id') or a literal id string.
 */
export function plantScopeSql(alias: string, partyType: string, plantParam = '@plant_id'): string {
  const m = PARTY_PLANT_TABLE[partyType]
  if (!m) return '1=1'
  return `(EXISTS (SELECT 1 FROM ${m.junction} jp WHERE jp.${m.col} = ${alias}.id AND jp.plant_id = ${plantParam})
    OR NOT EXISTS (SELECT 1 FROM ${m.junction} jp2 WHERE jp2.${m.col} = ${alias}.id))`
}
