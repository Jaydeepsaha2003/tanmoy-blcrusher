import { getDb } from '../db'
import type { Transporter } from '@shared/types'
import { properCase } from '@shared/types'

export function listTransporters(payload: { plant_id?: number } = {}): Transporter[] {
  const d = getDb()
  const clause = payload.plant_id ? `WHERE (t.plant_id IS NULL OR t.plant_id = @plant_id)` : ''
  const rows = d
    .prepare(
      `SELECT t.*, co.name AS company_name, pl.name AS plant_name
       FROM transporters t
       LEFT JOIN companies co ON co.id = t.company_id
       LEFT JOIN plants pl ON pl.id = t.plant_id
       ${clause}
       ORDER BY t.name`
    )
    .all(payload) as Transporter[]
  for (const t of rows) {
    const agg = d
      .prepare(
        `SELECT
           COALESCE(SUM(trips),0) AS trips,
           COALESCE(SUM(total_cm),0) AS cm,
           COALESCE(SUM(amount),0) AS amt,
           COALESCE(SUM(diesel_amount),0) AS diesel
         FROM (
           SELECT trips, total_cm, amount, diesel_amount FROM rack_loadings WHERE transporter_id = @id
           UNION ALL
           SELECT trips, total_cm, amount, diesel_amount FROM rack_unloadings WHERE transporter_id = @id
         )`
      )
      .get({ id: t.id }) as { trips: number; cm: number; amt: number; diesel: number }
    const pay = d
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN direction='out' THEN amount ELSE 0 END),0) AS paid,
           COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE 0 END),0) AS recvd
         FROM payments WHERE party_type='transporter' AND party_id = ?`
      )
      .get(t.id) as { paid: number; recvd: number }
    t.total_trips = round(agg.trips)
    t.total_cm = round(agg.cm)
    t.total_amount = round(agg.amt)
    t.diesel_amount = round(agg.diesel)
    t.paid_amount = round(pay.paid)
    // Balance payable = transport bills - diesel given - payments made (+ any refunds received)
    t.balance_amount = round(agg.amt - agg.diesel - pay.paid + pay.recvd)
  }
  return rows
}

export function createTransporter(p: {
  name: string
  contact: string
  address: string
  remarks: string
  company_id?: number | null
  plant_id?: number | null
}): Transporter {
  const d = getDb()
  const info = d
    .prepare(
      `INSERT INTO transporters (name, contact, address, remarks, company_id, plant_id) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      properCase(p.name),
      p.contact ?? '',
      p.address ?? '',
      p.remarks ?? '',
      p.company_id ?? null,
      p.plant_id ?? null
    )
  return d.prepare(`SELECT * FROM transporters WHERE id = ?`).get(info.lastInsertRowid) as Transporter
}

export function updateTransporter(p: {
  id: number
  name: string
  contact: string
  address: string
  remarks: string
  company_id?: number | null
  plant_id?: number | null
}): Transporter {
  const d = getDb()
  d.prepare(
    `UPDATE transporters SET name=?, contact=?, address=?, remarks=?, company_id=?, plant_id=? WHERE id=?`
  ).run(
    properCase(p.name),
    p.contact ?? '',
    p.address ?? '',
    p.remarks ?? '',
    p.company_id ?? null,
    p.plant_id ?? null,
    p.id
  )
  return d.prepare(`SELECT * FROM transporters WHERE id = ?`).get(p.id) as Transporter
}

export function deleteTransporter(payload: { id: number }): { ok: boolean; error?: string } {
  const d = getDb()
  const used = d
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM rack_loadings WHERE transporter_id = @id) +
        (SELECT COUNT(*) FROM rack_unloadings WHERE transporter_id = @id) AS c`
    )
    .get({ id: payload.id }) as { c: number }
  if (used.c > 0) {
    return { ok: false, error: 'Cannot delete: this transporter has rack loading/unloading records.' }
  }
  const paid = d
    .prepare(`SELECT COUNT(*) AS c FROM payments WHERE party_type='transporter' AND party_id = ?`)
    .get(payload.id) as { c: number }
  if (paid.c > 0) {
    return { ok: false, error: 'Cannot delete: this transporter has payment records.' }
  }
  d.prepare(`DELETE FROM transporters WHERE id = ?`).run(payload.id)
  return { ok: true }
}

function round(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
