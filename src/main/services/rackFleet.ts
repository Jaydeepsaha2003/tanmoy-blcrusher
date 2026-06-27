import { getDb } from '../db'
import type { RackVehicle, RackJcb } from '@shared/types'
import { properCase } from '@shared/types'
import { plantIdSet, writePartyPlants, attachPartyPlants, plantScopeSql } from './partyPlants'

function numOrNull(v: unknown): number | null {
  const n = Number(v)
  return v == null || (v as string) === '' || isNaN(n) ? null : n
}

/* ---------------- Vehicles ---------------- */

export async function listRackVehicles(payload: { plant_id?: number } = {}): Promise<RackVehicle[]> {
  const d = getDb()
  const clause = payload.plant_id ? `WHERE ${plantScopeSql('v', 'rack_vehicle')}` : ''
  const rows = (await d
    .prepare(`SELECT v.* FROM rack_vehicles v ${clause} ORDER BY v.vehicle_no`)
    .all(payload)) as RackVehicle[]
  await attachPartyPlants(d, 'rack_vehicle', rows)
  return rows
}

export async function createRackVehicle(p: {
  vehicle_no: string
  owner_name?: string
  owner_mobile?: string
  driver_name?: string
  driver_mobile?: string
  cap_cm?: number | null
  cap_ton?: number | null
  cap_cft?: number | null
  rate_per_trip?: number | null
  remarks?: string
  plant_ids?: number[]
}): Promise<RackVehicle> {
  const d = getDb()
  const no = (p.vehicle_no || '').trim().toUpperCase()
  if (!no) throw new Error('Vehicle no. is required.')
  const plants = plantIdSet(p)
  const id = await d.transaction(async () => {
    const info = await d
      .prepare(
        `INSERT INTO rack_vehicles
          (vehicle_no, owner_name, owner_mobile, driver_name, driver_mobile, cap_cm, cap_ton, cap_cft, rate_per_trip, remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        no,
        properCase(p.owner_name || ''),
        (p.owner_mobile || '').trim(),
        properCase(p.driver_name || ''),
        (p.driver_mobile || '').trim(),
        numOrNull(p.cap_cm),
        numOrNull(p.cap_ton),
        numOrNull(p.cap_cft),
        numOrNull(p.rate_per_trip),
        p.remarks ?? ''
      )
    const vid = Number(info.lastInsertRowid)
    await writePartyPlants(d, 'rack_vehicle', vid, plants)
    return vid
  })
  const row = (await d.prepare(`SELECT * FROM rack_vehicles WHERE id = ?`).get(id)) as RackVehicle
  await attachPartyPlants(d, 'rack_vehicle', [row])
  return row
}

export async function updateRackVehicle(p: {
  id: number
  vehicle_no: string
  owner_name?: string
  owner_mobile?: string
  driver_name?: string
  driver_mobile?: string
  cap_cm?: number | null
  cap_ton?: number | null
  cap_cft?: number | null
  rate_per_trip?: number | null
  remarks?: string
  plant_ids?: number[]
}): Promise<RackVehicle> {
  const d = getDb()
  if (!p.id) throw new Error('Missing vehicle id.')
  const no = (p.vehicle_no || '').trim().toUpperCase()
  if (!no) throw new Error('Vehicle no. is required.')
  const plants = plantIdSet(p)
  await d.transaction(async () => {
    await d
      .prepare(
        `UPDATE rack_vehicles SET vehicle_no=?, owner_name=?, owner_mobile=?, driver_name=?, driver_mobile=?,
           cap_cm=?, cap_ton=?, cap_cft=?, rate_per_trip=?, remarks=? WHERE id=?`
      )
      .run(
        no,
        properCase(p.owner_name || ''),
        (p.owner_mobile || '').trim(),
        properCase(p.driver_name || ''),
        (p.driver_mobile || '').trim(),
        numOrNull(p.cap_cm),
        numOrNull(p.cap_ton),
        numOrNull(p.cap_cft),
        numOrNull(p.rate_per_trip),
        p.remarks ?? '',
        p.id
      )
    await writePartyPlants(d, 'rack_vehicle', p.id, plants)
  })
  const row = (await d.prepare(`SELECT * FROM rack_vehicles WHERE id = ?`).get(p.id)) as RackVehicle
  await attachPartyPlants(d, 'rack_vehicle', [row])
  return row
}

export async function deleteRackVehicle(payload: { id: number }): Promise<{ ok: boolean }> {
  const d = getDb()
  await d.transaction(async () => {
    await d.prepare(`DELETE FROM rack_vehicle_plants WHERE rack_vehicle_id = ?`).run(payload.id)
    await d.prepare(`DELETE FROM rack_vehicles WHERE id = ?`).run(payload.id)
  })
  return { ok: true }
}

/* ---------------- JCB loaders ---------------- */

export async function listRackJcbs(payload: { plant_id?: number } = {}): Promise<RackJcb[]> {
  const d = getDb()
  const clause = payload.plant_id ? `WHERE ${plantScopeSql('j', 'rack_jcb')}` : ''
  const rows = (await d.prepare(`SELECT j.* FROM rack_jcbs j ${clause} ORDER BY j.name`).all(payload)) as RackJcb[]
  await attachPartyPlants(d, 'rack_jcb', rows)
  return rows
}

export async function createRackJcb(p: {
  name: string
  owner_name?: string
  owner_mobile?: string
  driver_name?: string
  driver_mobile?: string
  rate_unloading?: number | null
  rate_loading?: number | null
  rate_other?: number | null
  remarks?: string
  plant_ids?: number[]
}): Promise<RackJcb> {
  const d = getDb()
  const name = properCase(p.name || '')
  if (!name) throw new Error('JCB name / no. is required.')
  const plants = plantIdSet(p)
  const id = await d.transaction(async () => {
    const info = await d
      .prepare(
        `INSERT INTO rack_jcbs
          (name, owner_name, owner_mobile, driver_name, driver_mobile, rate_unloading, rate_loading, rate_other, remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        name,
        properCase(p.owner_name || ''),
        (p.owner_mobile || '').trim(),
        properCase(p.driver_name || ''),
        (p.driver_mobile || '').trim(),
        numOrNull(p.rate_unloading),
        numOrNull(p.rate_loading),
        numOrNull(p.rate_other),
        p.remarks ?? ''
      )
    const jid = Number(info.lastInsertRowid)
    await writePartyPlants(d, 'rack_jcb', jid, plants)
    return jid
  })
  const row = (await d.prepare(`SELECT * FROM rack_jcbs WHERE id = ?`).get(id)) as RackJcb
  await attachPartyPlants(d, 'rack_jcb', [row])
  return row
}

export async function updateRackJcb(p: {
  id: number
  name: string
  owner_name?: string
  owner_mobile?: string
  driver_name?: string
  driver_mobile?: string
  rate_unloading?: number | null
  rate_loading?: number | null
  rate_other?: number | null
  remarks?: string
  plant_ids?: number[]
}): Promise<RackJcb> {
  const d = getDb()
  if (!p.id) throw new Error('Missing JCB id.')
  const name = properCase(p.name || '')
  if (!name) throw new Error('JCB name / no. is required.')
  const plants = plantIdSet(p)
  await d.transaction(async () => {
    await d
      .prepare(
        `UPDATE rack_jcbs SET name=?, owner_name=?, owner_mobile=?, driver_name=?, driver_mobile=?,
           rate_unloading=?, rate_loading=?, rate_other=?, remarks=? WHERE id=?`
      )
      .run(
        name,
        properCase(p.owner_name || ''),
        (p.owner_mobile || '').trim(),
        properCase(p.driver_name || ''),
        (p.driver_mobile || '').trim(),
        numOrNull(p.rate_unloading),
        numOrNull(p.rate_loading),
        numOrNull(p.rate_other),
        p.remarks ?? '',
        p.id
      )
    await writePartyPlants(d, 'rack_jcb', p.id, plants)
  })
  const row = (await d.prepare(`SELECT * FROM rack_jcbs WHERE id = ?`).get(p.id)) as RackJcb
  await attachPartyPlants(d, 'rack_jcb', [row])
  return row
}

export async function deleteRackJcb(payload: { id: number }): Promise<{ ok: boolean }> {
  const d = getDb()
  await d.transaction(async () => {
    await d.prepare(`DELETE FROM rack_jcb_plants WHERE rack_jcb_id = ?`).run(payload.id)
    await d.prepare(`DELETE FROM rack_jcbs WHERE id = ?`).run(payload.id)
  })
  return { ok: true }
}
