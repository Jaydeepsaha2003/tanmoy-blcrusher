import { getDb } from '../db'
import type { TransporterFleetItem, Uom } from '@shared/types'
import { properCase } from '@shared/types'
import { plantScopeSql } from './partyPlants'

/**
 * Every transporter's fleet item (vehicle + JCB) with its transporter name, for
 * pickers that span all transporters (e.g. diesel issue). Optionally scoped to
 * the transporters visible at a plant.
 */
export async function listFleetVehicles(
  payload: { plant_id?: number } = {}
): Promise<(TransporterFleetItem & { transporter_name: string })[]> {
  const d = getDb()
  const clause = payload.plant_id ? `WHERE ${plantScopeSql('t', 'transporter')}` : ''
  return (await d
    .prepare(
      `SELECT tf.*, t.name AS transporter_name
       FROM transporter_fleet tf JOIN transporters t ON t.id = tf.transporter_id
       ${clause}
       ORDER BY t.name, tf.kind, tf.name`
    )
    .all(payload)) as (TransporterFleetItem & { transporter_name: string })[]
}

function numOrNull(v: unknown): number | null {
  const n = Number(v)
  return v == null || (v as string) === '' || isNaN(n) ? null : n
}

function uomOf(v: unknown): Uom {
  return v === 'TON' || v === 'CFT' ? v : 'CM'
}

/** Vehicles and JCBs belonging to a transporter (optionally filtered by kind). */
export async function listTransporterFleet(payload: {
  transporter_id: number
  kind?: 'vehicle' | 'jcb'
}): Promise<TransporterFleetItem[]> {
  const d = getDb()
  const where = ['transporter_id = @transporter_id']
  if (payload.kind) where.push('kind = @kind')
  return (await d
    .prepare(`SELECT * FROM transporter_fleet WHERE ${where.join(' AND ')} ORDER BY kind, name`)
    .all(payload)) as TransporterFleetItem[]
}

export async function createTransporterFleet(p: {
  transporter_id: number
  kind?: 'vehicle' | 'jcb'
  name: string
  driver_name?: string
  driver_mobile?: string
  cap_cm?: number | null
  cap_ton?: number | null
  cap_cft?: number | null
  rate_per_trip?: number | null
  rate_per_unit?: number | null
  rate_unit_uom?: Uom
  remarks?: string
}): Promise<TransporterFleetItem> {
  const d = getDb()
  if (!p.transporter_id) throw new Error('Missing transporter.')
  const kind = p.kind === 'jcb' ? 'jcb' : 'vehicle'
  const name = properCase(p.name || '')
  if (!name) throw new Error(kind === 'jcb' ? 'JCB name / no. is required.' : 'Vehicle no. is required.')
  const info = await d
    .prepare(
      `INSERT INTO transporter_fleet
        (transporter_id, kind, name, driver_name, driver_mobile, cap_cm, cap_ton, cap_cft, rate_per_trip, rate_per_unit, rate_unit_uom, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      p.transporter_id,
      kind,
      name,
      properCase(p.driver_name || ''),
      (p.driver_mobile || '').trim(),
      numOrNull(p.cap_cm),
      numOrNull(p.cap_ton),
      numOrNull(p.cap_cft),
      numOrNull(p.rate_per_trip),
      numOrNull(p.rate_per_unit),
      uomOf(p.rate_unit_uom),
      p.remarks ?? ''
    )
  return (await d
    .prepare(`SELECT * FROM transporter_fleet WHERE id = ?`)
    .get(info.lastInsertRowid)) as TransporterFleetItem
}

export async function updateTransporterFleet(p: {
  id: number
  kind?: 'vehicle' | 'jcb'
  name: string
  driver_name?: string
  driver_mobile?: string
  cap_cm?: number | null
  cap_ton?: number | null
  cap_cft?: number | null
  rate_per_trip?: number | null
  rate_per_unit?: number | null
  rate_unit_uom?: Uom
  remarks?: string
}): Promise<TransporterFleetItem> {
  const d = getDb()
  if (!p.id) throw new Error('Missing fleet item id.')
  const name = properCase(p.name || '')
  if (!name) throw new Error('Name / no. is required.')
  await d
    .prepare(
      `UPDATE transporter_fleet SET
         name=?, driver_name=?, driver_mobile=?, cap_cm=?, cap_ton=?, cap_cft=?,
         rate_per_trip=?, rate_per_unit=?, rate_unit_uom=?, remarks=?
       WHERE id=?`
    )
    .run(
      name,
      properCase(p.driver_name || ''),
      (p.driver_mobile || '').trim(),
      numOrNull(p.cap_cm),
      numOrNull(p.cap_ton),
      numOrNull(p.cap_cft),
      numOrNull(p.rate_per_trip),
      numOrNull(p.rate_per_unit),
      uomOf(p.rate_unit_uom),
      p.remarks ?? '',
      p.id
    )
  return (await d.prepare(`SELECT * FROM transporter_fleet WHERE id = ?`).get(p.id)) as TransporterFleetItem
}

export async function deleteTransporterFleet(payload: { id: number }): Promise<{ ok: boolean }> {
  await getDb().prepare(`DELETE FROM transporter_fleet WHERE id = ?`).run(payload.id)
  return { ok: true }
}
