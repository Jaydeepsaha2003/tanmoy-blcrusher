import { getDb, nextNumber, dbKind } from '../db'
import type {
  Rack,
  RackStatus,
  RackLoading,
  RackUnloading,
  RackExpense,
  RackSale,
  RackSaleTransporter,
  RackSaleMachine,
  RackDetailData,
  RackProductBalance,
  Uom,
  UomFactors,
  MachineBasis,
  PurchaseTransportBasis
} from '@shared/types'
import { toCm, properCase } from '@shared/types'
import { addMovement, finishedBalance } from './movements'
import { plantUomFactors } from './plants'
import type { Db } from '../db'

/** Best-effort per-plant factors for a rack, taken from its first loading's plant. */
async function rackPlantFactors(d: Db, rackId: number): Promise<UomFactors> {
  const row = (await d
    .prepare(`SELECT plant_id FROM rack_loadings WHERE rack_id = ? ORDER BY id LIMIT 1`)
    .get(rackId)) as { plant_id: number } | undefined
  return plantUomFactors(row?.plant_id)
}

const RACK_STATUSES: RackStatus[] = ['loading', 'in_transit', 'reached', 'closed']

function roundQty(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000
}
function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
function computeAmount(rate: number | null, qty: number): number | null {
  if (rate == null || isNaN(rate)) return null
  return roundMoney(rate * qty)
}

/* ---------------- Racks ---------------- */

const RACK_AGG = `
  COALESCE((SELECT SUM(total_cm) FROM rack_loadings WHERE rack_id = r.id),0) AS loaded_cm,
  COALESCE((SELECT SUM(qty_cm) FROM rack_unloadings WHERE rack_id = r.id),0) AS unloaded_cm,
  COALESCE((SELECT SUM(amount) FROM rack_loadings WHERE rack_id = r.id),0)
    + COALESCE((SELECT SUM(amount) FROM rack_unloadings WHERE rack_id = r.id),0) AS transport_cost,
  COALESCE((SELECT SUM(amount) FROM rack_expenses WHERE rack_id = r.id),0) AS expense_total,
  COALESCE((SELECT SUM(qty_cm) FROM rack_sales WHERE rack_id = r.id),0) AS sold_cm,
  COALESCE((SELECT SUM(amount) FROM rack_sales WHERE rack_id = r.id),0) AS sales_amount`

function decorate(r: Rack): Rack {
  r.loaded_cm = roundQty(r.loaded_cm ?? 0)
  r.unloaded_cm = roundQty(r.unloaded_cm ?? 0)
  r.sold_cm = roundQty(r.sold_cm ?? 0)
  // Overall leftover = everything loaded that never turned into a sale.
  r.balance_cm = roundQty(r.loaded_cm - r.sold_cm)
  // Lost/pending between plant and destination yard.
  r.transit_shortage_cm = roundQty(r.loaded_cm - r.unloaded_cm)
  // Once a rack is closed the unsold leftover is booked as wastage/shortage.
  r.shortage_cm = r.status === 'closed' ? r.balance_cm : 0
  r.transport_cost = roundMoney(r.transport_cost ?? 0)
  r.expense_total = roundMoney(r.expense_total ?? 0)
  r.sales_amount = roundMoney(r.sales_amount ?? 0)
  r.profit = roundMoney(r.sales_amount - r.transport_cost - r.expense_total)
  return r
}

export interface RackFilter {
  status?: RackStatus
  from?: string
  to?: string
}

export async function listRacks(filter: RackFilter = {}): Promise<Rack[]> {
  const d = getDb()
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (filter.status) {
    where.push('r.status = @status')
    params.status = filter.status
  }
  if (filter.from) {
    where.push('r.date >= @from')
    params.from = filter.from
  }
  if (filter.to) {
    where.push('r.date <= @to')
    params.to = filter.to
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const rows = (await d
    .prepare(`SELECT r.*, ${RACK_AGG} FROM racks r ${clause} ORDER BY r.date DESC, r.id DESC`)
    .all(params)) as Rack[]
  return rows.map(decorate)
}

async function getRack(d: Db, id: number): Promise<Rack> {
  const row = (await d.prepare(`SELECT r.*, ${RACK_AGG} FROM racks r WHERE r.id = ?`).get(id)) as
    | Rack
    | undefined
  if (!row) throw new Error('Rack not found.')
  return decorate(row)
}

export async function createRack(p: {
  rack_no: string
  destination: string
  date: string
  remarks: string
}): Promise<Rack> {
  const d = getDb()
  const no = (p.rack_no || '').trim()
  if (!no) throw new Error('Railway rack no. is required.')
  const dup = await d.prepare(`SELECT id FROM racks WHERE rack_no = ?`).get(no)
  if (dup) throw new Error(`Rack "${no}" already exists.`)
  const info = await d
    .prepare(`INSERT INTO racks (rack_no, destination, date, remarks) VALUES (?, ?, ?, ?)`)
    .run(no, properCase(p.destination), p.date, p.remarks ?? '')
  return getRack(d, Number(info.lastInsertRowid))
}

export async function updateRack(p: {
  id: number
  rack_no: string
  destination: string
  date: string
  remarks: string
}): Promise<Rack> {
  const d = getDb()
  const no = (p.rack_no || '').trim()
  if (!no) throw new Error('Railway rack no. is required.')
  const dup = await d.prepare(`SELECT id FROM racks WHERE rack_no = ? AND id <> ?`).get(no, p.id)
  if (dup) throw new Error(`Rack "${no}" already exists.`)
  const old = (await d.prepare(`SELECT * FROM racks WHERE id = ?`).get(p.id)) as Rack | undefined
  if (!old) throw new Error('Rack not found.')
  await d.transaction(async () => {
    await d.prepare(`UPDATE racks SET rack_no=?, destination=?, date=?, remarks=? WHERE id=?`).run(
      no,
      properCase(p.destination),
      p.date,
      p.remarks ?? '',
      p.id
    )
    // Keep stock movement notes in sync with the renamed rack.
    if (old.rack_no !== no) {
      await d.prepare(
        `UPDATE stock_movements SET note = ? WHERE type='rack_load' AND ref_no IN
           (SELECT loading_no FROM rack_loadings WHERE rack_id = ?)`
      ).run(`Loaded to rack ${no}`, p.id)
    }
  })
  return getRack(d, p.id)
}

export async function setRackStatus(p: { id: number; status: RackStatus }): Promise<Rack> {
  const d = getDb()
  if (!RACK_STATUSES.includes(p.status)) throw new Error('Invalid rack status.')
  await d.prepare(`UPDATE racks SET status=? WHERE id=?`).run(p.status, p.id)
  return getRack(d, p.id)
}

export async function deleteRack(payload: { id: number }): Promise<{ ok: boolean; error?: string }> {
  const d = getDb()
  const counts = (await d
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM rack_loadings WHERE rack_id = @id) AS l,
        (SELECT COUNT(*) FROM rack_expenses WHERE rack_id = @id) AS e,
        (SELECT COUNT(*) FROM rack_sales WHERE rack_id = @id) AS s`
    )
    .get({ id: payload.id })) as { l: number; e: number; s: number }
  if (counts.l || counts.e || counts.s) {
    return {
      ok: false,
      error: 'Cannot delete: rack has loadings, expenses or sales. Remove them first.'
    }
  }
  await d.prepare(`DELETE FROM racks WHERE id = ?`).run(payload.id)
  return { ok: true }
}

export async function getRackDetail(payload: { id: number }): Promise<RackDetailData> {
  const d = getDb()
  const rack = await getRack(d, payload.id)
  const loadings = (await d
    .prepare(
      `SELECT rl.*, p.name AS plant_name, t.name AS transporter_name, r.rack_no
       FROM rack_loadings rl
       JOIN plants p ON p.id = rl.plant_id
       JOIN transporters t ON t.id = rl.transporter_id
       JOIN racks r ON r.id = rl.rack_id
       WHERE rl.rack_id = ?
       ORDER BY rl.date DESC, rl.id DESC`
    )
    .all(payload.id)) as RackLoading[]
  const unloadings = (await d
    .prepare(
      `SELECT ru.*, r.rack_no, t.name AS transporter_name
       FROM rack_unloadings ru
       JOIN racks r ON r.id = ru.rack_id
       LEFT JOIN transporters t ON t.id = ru.transporter_id
       WHERE ru.rack_id = ?
       ORDER BY ru.date DESC, ru.id DESC`
    )
    .all(payload.id)) as RackUnloading[]
  const expenses = (await d
    .prepare(`SELECT * FROM rack_expenses WHERE rack_id = ? ORDER BY date DESC, id DESC`)
    .all(payload.id)) as RackExpense[]
  const sales = (await d
    .prepare(
      `SELECT rs.*, c.name AS customer_name, r.rack_no,
        (SELECT COALESCE(SUM(charge),0) FROM rack_sale_transporters rst WHERE rst.rack_sale_id = rs.id) AS transport_total,
        (SELECT COALESCE(SUM(amount),0) FROM rack_sale_machines rsm WHERE rsm.rack_sale_id = rs.id) AS machine_total
       FROM rack_sales rs
       JOIN customers c ON c.id = rs.customer_id
       JOIN racks r ON r.id = rs.rack_id
       WHERE rs.rack_id = ?
       ORDER BY rs.date DESC, rs.id DESC`
    )
    .all(payload.id)) as RackSale[]
  const products = (await d
    .prepare(
      `SELECT product_name,
        ROUND(COALESCE(SUM(loaded),0),3) AS loaded_cm,
        ROUND(COALESCE(SUM(unloaded),0),3) AS unloaded_cm,
        ROUND(COALESCE(SUM(sold),0),3) AS sold_cm,
        ROUND(COALESCE(SUM(loaded),0) - COALESCE(SUM(unloaded),0),3) AS transit_shortage_cm,
        ROUND(COALESCE(SUM(unloaded),0) - COALESCE(SUM(sold),0),3) AS balance_cm
       FROM (
         SELECT product_name, total_cm AS loaded, 0 AS unloaded, 0 AS sold FROM rack_loadings WHERE rack_id = @id
         UNION ALL
         SELECT product_name, 0 AS loaded, qty_cm AS unloaded, 0 AS sold FROM rack_unloadings WHERE rack_id = @id
         UNION ALL
         SELECT product_name, 0 AS loaded, 0 AS unloaded, qty_cm AS sold FROM rack_sales WHERE rack_id = @id
       ) AS m
       GROUP BY product_name ORDER BY product_name`
    )
    .all({ id: payload.id })) as RackProductBalance[]
  return { rack, loadings, unloadings, expenses, sales, products }
}

async function loadedOf(d: Db, rackId: number, productName: string): Promise<number> {
  return (
    (await d
      .prepare(
        `SELECT COALESCE(SUM(total_cm),0) AS q FROM rack_loadings WHERE rack_id=? AND product_name=?`
      )
      .get(rackId, productName)) as { q: number }
  ).q
}

async function unloadedOf(
  d: Db,
  rackId: number,
  productName: string,
  excludeId?: number
): Promise<number> {
  return (
    (await d
      .prepare(
        `SELECT COALESCE(SUM(qty_cm),0) AS q FROM rack_unloadings
         WHERE rack_id=? AND product_name=? ${excludeId ? 'AND id <> ?' : ''}`
      )
      .get(...(excludeId ? [rackId, productName, excludeId] : [rackId, productName]))) as {
      q: number
    }
  ).q
}

async function soldOf(
  d: Db,
  rackId: number,
  productName: string,
  excludeId?: number
): Promise<number> {
  return (
    (await d
      .prepare(
        `SELECT COALESCE(SUM(qty_cm),0) AS q FROM rack_sales
         WHERE rack_id=? AND product_name=? ${excludeId ? 'AND id <> ?' : ''}`
      )
      .get(...(excludeId ? [rackId, productName, excludeId] : [rackId, productName]))) as {
      q: number
    }
  ).q
}

/** Quantity at destination still available to sell = unloaded - sold. */
async function rackSellable(
  d: Db,
  rackId: number,
  productName: string,
  excludeSaleId?: number
): Promise<number> {
  return roundQty(
    (await unloadedOf(d, rackId, productName)) - (await soldOf(d, rackId, productName, excludeSaleId))
  )
}

/** Quantity still on the rake that can still be unloaded = loaded - unloaded. */
async function rackUnloadable(
  d: Db,
  rackId: number,
  productName: string,
  excludeUnloadId?: number
): Promise<number> {
  return roundQty(
    (await loadedOf(d, rackId, productName)) -
      (await unloadedOf(d, rackId, productName, excludeUnloadId))
  )
}

/* ---------------- Loadings (plant -> railway yard) ---------------- */

export interface LoadingInput {
  id?: number
  rack_id: number
  plant_id: number
  product_name: string
  transporter_id: number
  vehicle_no: string
  trips: number
  per_trip_cm: number
  total_cm?: number
  rate: number | null
  diesel_litres: number | null
  diesel_amount: number | null
  outsourced?: boolean | number
  date: string
  remarks: string
}

function resolveLoading(p: LoadingInput): { total: number; amount: number | null } {
  let total = Number(p.total_cm) || 0
  if (!(total > 0)) total = roundQty((Number(p.trips) || 0) * (Number(p.per_trip_cm) || 0))
  if (!(total > 0)) throw new Error('Total quantity must be greater than 0 (trips × per-trip m³).')
  return { total: roundQty(total), amount: computeAmount(p.rate, total) }
}

export async function addLoading(p: LoadingInput): Promise<RackLoading> {
  const d = getDb()
  const rack = (await d.prepare(`SELECT * FROM racks WHERE id = ?`).get(p.rack_id)) as Rack | undefined
  if (!rack) throw new Error('Rack not found.')
  if (rack.status === 'closed') throw new Error('Rack is closed. Re-open it to add loadings.')
  if (!p.product_name?.trim()) throw new Error('Product is required.')
  const { total, amount } = resolveLoading(p)
  const outsourced = !!p.outsourced
  if (!outsourced) {
    const available = await finishedBalance(d, p.plant_id, p.product_name)
    if (total > available)
      throw new Error(
        `Not enough finished goods. Available ${p.product_name}: ${available} m³, requested: ${total} m³.`
      )
  }
  const id = await d.transaction(async () => {
    const no = await nextNumber('RKL', 'rack_loading')
    const info = await d
      .prepare(
        `INSERT INTO rack_loadings
          (loading_no, rack_id, plant_id, product_name, transporter_id, vehicle_no, trips, per_trip_cm,
           total_cm, rate, amount, diesel_litres, diesel_amount, outsourced, date, remarks)
         VALUES (@loading_no,@rack_id,@plant_id,@product_name,@transporter_id,@vehicle_no,@trips,@per_trip_cm,
           @total_cm,@rate,@amount,@diesel_litres,@diesel_amount,@outsourced,@date,@remarks)`
      )
      .run({
        loading_no: no,
        rack_id: p.rack_id,
        plant_id: p.plant_id,
        product_name: p.product_name.trim(),
        transporter_id: p.transporter_id,
        vehicle_no: p.vehicle_no ?? '',
        trips: Number(p.trips) || 0,
        per_trip_cm: Number(p.per_trip_cm) || 0,
        total_cm: total,
        rate: p.rate,
        amount,
        diesel_litres: p.diesel_litres,
        diesel_amount: p.diesel_amount,
        outsourced: outsourced ? 1 : 0,
        date: p.date,
        remarks: p.remarks ?? ''
      })
    if (!outsourced) {
      await addMovement(d, {
        type: 'rack_load',
        material_type: 'finished',
        ref_no: no,
        plant_id: p.plant_id,
        product_name: p.product_name.trim(),
        change_qty: -total,
        date: p.date,
        note: `Loaded to rack ${rack.rack_no}`
      })
      if ((await finishedBalance(d, p.plant_id, p.product_name)) < 0)
        throw new Error('Stock cannot go negative.')
    }
    return Number(info.lastInsertRowid)
  })
  return (await d.prepare(`SELECT * FROM rack_loadings WHERE id = ?`).get(id)) as RackLoading
}

export async function updateLoading(p: LoadingInput): Promise<RackLoading> {
  const d = getDb()
  if (!p.id) throw new Error('Missing loading id.')
  const old = (await d.prepare(`SELECT * FROM rack_loadings WHERE id = ?`).get(p.id)) as
    | RackLoading
    | undefined
  if (!old) throw new Error('Loading not found.')
  if (!p.product_name?.trim()) throw new Error('Product is required.')
  const { total, amount } = resolveLoading(p)
  const outsourced = !!p.outsourced
  await d.transaction(async () => {
    await d.prepare(
      `UPDATE rack_loadings SET plant_id=@plant_id, product_name=@product_name, transporter_id=@transporter_id,
         vehicle_no=@vehicle_no, trips=@trips, per_trip_cm=@per_trip_cm, total_cm=@total_cm,
         rate=@rate, amount=@amount, diesel_litres=@diesel_litres, diesel_amount=@diesel_amount,
         outsourced=@outsourced, date=@date, remarks=@remarks WHERE id=@id`
    ).run({
      id: p.id,
      plant_id: p.plant_id,
      product_name: p.product_name.trim(),
      transporter_id: p.transporter_id,
      vehicle_no: p.vehicle_no ?? '',
      trips: Number(p.trips) || 0,
      per_trip_cm: Number(p.per_trip_cm) || 0,
      total_cm: total,
      rate: p.rate,
      amount,
      diesel_litres: p.diesel_litres,
      diesel_amount: p.diesel_amount,
      outsourced: outsourced ? 1 : 0,
      date: p.date,
      remarks: p.remarks ?? ''
    })
    // Rebuild the plant-stock movement to match the current outsourced flag.
    await d.prepare(`DELETE FROM stock_movements WHERE ref_no=? AND type='rack_load'`).run(old.loading_no)
    if (!outsourced) {
      await addMovement(d, {
        type: 'rack_load',
        material_type: 'finished',
        ref_no: old.loading_no,
        plant_id: p.plant_id,
        product_name: p.product_name.trim(),
        change_qty: -total,
        date: p.date,
        note: `Loaded to rack`
      })
      if ((await finishedBalance(d, old.plant_id, old.product_name)) < 0)
        throw new Error('Edit would make finished goods stock negative.')
      if ((await finishedBalance(d, p.plant_id, p.product_name)) < 0)
        throw new Error('Edit would make finished goods stock negative.')
    }
    // The rack must still have loaded at least as much as has been unloaded.
    if ((await rackUnloadable(d, old.rack_id, old.product_name)) < 0)
      throw new Error('Edit would leave more unloaded than loaded for this product.')
    if ((await rackUnloadable(d, old.rack_id, p.product_name.trim())) < 0)
      throw new Error('Edit would leave more unloaded than loaded for this product.')
  })
  return (await d.prepare(`SELECT * FROM rack_loadings WHERE id = ?`).get(p.id)) as RackLoading
}

export async function deleteLoading(payload: { id: number }): Promise<{ ok: boolean; error?: string }> {
  const d = getDb()
  const old = (await d.prepare(`SELECT * FROM rack_loadings WHERE id = ?`).get(payload.id)) as
    | RackLoading
    | undefined
  if (!old) return { ok: false, error: 'Loading not found.' }
  try {
    await d.transaction(async () => {
      await d.prepare(`DELETE FROM stock_movements WHERE ref_no=? AND type='rack_load'`).run(
        old.loading_no
      )
      await d.prepare(`DELETE FROM rack_loadings WHERE id = ?`).run(payload.id)
      if ((await rackUnloadable(d, old.rack_id, old.product_name)) < 0)
        throw new Error('Cannot delete: this material has already been unloaded at the destination.')
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/* ---------------- Unloadings (railway yard / destination) ---------------- */

export interface UnloadingInput {
  id?: number
  rack_id: number
  product_name: string
  transporter_id: number | null
  vehicle_no: string
  trips: number
  per_trip_cm: number
  total_cm?: number
  rate: number | null
  diesel_litres: number | null
  diesel_amount: number | null
  date: string
  remarks: string
}

function resolveUnloading(p: UnloadingInput): { total: number; amount: number | null } {
  let total = Number(p.total_cm) || 0
  if (!(total > 0)) total = roundQty((Number(p.trips) || 0) * (Number(p.per_trip_cm) || 0))
  if (!(total > 0)) throw new Error('Unloaded quantity must be greater than 0 (trips × per-trip m³).')
  return { total: roundQty(total), amount: computeAmount(p.rate, total) }
}

function unloadingFields(p: UnloadingInput, total: number, amount: number | null): Record<string, unknown> {
  return {
    rack_id: p.rack_id,
    product_name: p.product_name.trim(),
    transporter_id: p.transporter_id ?? null,
    vehicle_no: p.vehicle_no ?? '',
    trips: Number(p.trips) || 0,
    per_trip_cm: Number(p.per_trip_cm) || 0,
    total_cm: total,
    uom: 'CM',
    quantity: total,
    qty_cm: total,
    rate: p.rate,
    amount,
    diesel_litres: p.diesel_litres,
    diesel_amount: p.diesel_amount,
    date: p.date,
    remarks: p.remarks ?? ''
  }
}

export async function addUnloading(p: UnloadingInput): Promise<RackUnloading> {
  const d = getDb()
  const rack = (await d.prepare(`SELECT * FROM racks WHERE id = ?`).get(p.rack_id)) as Rack | undefined
  if (!rack) throw new Error('Rack not found.')
  if (rack.status === 'closed') throw new Error('Rack is closed. Re-open it to add unloadings.')
  if (!p.product_name?.trim()) throw new Error('Product is required.')
  const { total, amount } = resolveUnloading(p)
  const onRake = await rackUnloadable(d, p.rack_id, p.product_name.trim())
  if (total > onRake)
    throw new Error(
      `Cannot unload more than was loaded. On rake — ${p.product_name}: ${onRake} m³, requested: ${total} m³.`
    )
  const no = await nextNumber('RKU', 'rack_unloading')
  const info = await d
    .prepare(
      `INSERT INTO rack_unloadings
        (unloading_no, rack_id, product_name, transporter_id, vehicle_no, trips, per_trip_cm, total_cm,
         uom, quantity, qty_cm, rate, amount, diesel_litres, diesel_amount, date, remarks)
       VALUES (@unloading_no,@rack_id,@product_name,@transporter_id,@vehicle_no,@trips,@per_trip_cm,@total_cm,
         @uom,@quantity,@qty_cm,@rate,@amount,@diesel_litres,@diesel_amount,@date,@remarks)`
    )
    .run({ unloading_no: no, ...unloadingFields(p, total, amount) })
  return (await d.prepare(`SELECT * FROM rack_unloadings WHERE id = ?`).get(info.lastInsertRowid)) as RackUnloading
}

export async function updateUnloading(p: UnloadingInput): Promise<RackUnloading> {
  const d = getDb()
  if (!p.id) throw new Error('Missing unloading id.')
  const old = (await d.prepare(`SELECT * FROM rack_unloadings WHERE id = ?`).get(p.id)) as
    | RackUnloading
    | undefined
  if (!old) throw new Error('Unloading not found.')
  if (!p.product_name?.trim()) throw new Error('Product is required.')
  const { total, amount } = resolveUnloading(p)
  await d.transaction(async () => {
    await d.prepare(
      `UPDATE rack_unloadings SET product_name=@product_name, transporter_id=@transporter_id,
         vehicle_no=@vehicle_no, trips=@trips, per_trip_cm=@per_trip_cm, total_cm=@total_cm,
         uom=@uom, quantity=@quantity, qty_cm=@qty_cm, rate=@rate, amount=@amount,
         diesel_litres=@diesel_litres, diesel_amount=@diesel_amount, date=@date, remarks=@remarks WHERE id=@id`
    ).run({ id: p.id, ...unloadingFields(p, total, amount) })
    if (
      (await rackUnloadable(d, old.rack_id, old.product_name)) < 0 ||
      (await rackUnloadable(d, old.rack_id, p.product_name.trim())) < 0
    )
      throw new Error('Edit would leave more unloaded than loaded for this product.')
    if (
      (await rackSellable(d, old.rack_id, old.product_name)) < 0 ||
      (await rackSellable(d, old.rack_id, p.product_name.trim())) < 0
    )
      throw new Error('Edit would leave sales exceeding the unloaded quantity.')
  })
  return (await d.prepare(`SELECT * FROM rack_unloadings WHERE id = ?`).get(p.id)) as RackUnloading
}

export async function deleteUnloading(payload: { id: number }): Promise<{ ok: boolean; error?: string }> {
  const d = getDb()
  const old = (await d.prepare(`SELECT * FROM rack_unloadings WHERE id = ?`).get(payload.id)) as
    | RackUnloading
    | undefined
  if (!old) return { ok: false, error: 'Unloading not found.' }
  try {
    await d.transaction(async () => {
      await d.prepare(`DELETE FROM rack_unloadings WHERE id = ?`).run(payload.id)
      if ((await rackSellable(d, old.rack_id, old.product_name)) < 0)
        throw new Error('Cannot delete: material from this unloading has already been sold.')
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/* ---------------- Expenses ---------------- */

export interface ExpenseInput {
  id?: number
  rack_id: number
  expense_type: string
  amount: number
  date: string
  remarks: string
}

export async function listExpenseTypes(): Promise<string[]> {
  const d = getDb()
  const rows = (await d.prepare(`SELECT name FROM expense_types ORDER BY name`).all()) as {
    name: string
  }[]
  return rows.map((r) => r.name)
}

export async function createExpenseType(payload: { name: string }): Promise<{ ok: boolean; error?: string }> {
  const d = getDb()
  const name = properCase(payload.name)
  if (!name) return { ok: false, error: 'Expense type name is required.' }
  const dup = await d.prepare(`SELECT id FROM expense_types WHERE name = ? COLLATE NOCASE`).get(name)
  if (dup) return { ok: false, error: `"${name}" already exists.` }
  await d.prepare(`INSERT INTO expense_types (name) VALUES (?)`).run(name)
  return { ok: true }
}

export async function deleteExpenseType(payload: { name: string }): Promise<{ ok: boolean }> {
  const d = getDb()
  await d.prepare(`DELETE FROM expense_types WHERE name = ?`).run(payload.name)
  return { ok: true }
}

export async function addExpense(p: ExpenseInput): Promise<RackExpense> {
  const d = getDb()
  const type = properCase(p.expense_type)
  if (!type) throw new Error('Expense type is required.')
  if (!(Number(p.amount) > 0)) throw new Error('Amount must be greater than 0.')
  const id = await d.transaction(async () => {
    await d
      .prepare(
        dbKind() === 'mysql'
          ? `INSERT IGNORE INTO expense_types (name) VALUES (?)`
          : `INSERT INTO expense_types (name) VALUES (?) ON CONFLICT(name) DO NOTHING`
      )
      .run(type)
    const info = await d
      .prepare(
        `INSERT INTO rack_expenses (rack_id, expense_type, amount, date, remarks) VALUES (?, ?, ?, ?, ?)`
      )
      .run(p.rack_id, type, roundMoney(Number(p.amount)), p.date, p.remarks ?? '')
    return Number(info.lastInsertRowid)
  })
  return (await d.prepare(`SELECT * FROM rack_expenses WHERE id = ?`).get(id)) as RackExpense
}

export async function updateExpense(p: ExpenseInput): Promise<RackExpense> {
  const d = getDb()
  if (!p.id) throw new Error('Missing expense id.')
  const type = properCase(p.expense_type)
  if (!type) throw new Error('Expense type is required.')
  if (!(Number(p.amount) > 0)) throw new Error('Amount must be greater than 0.')
  await d.transaction(async () => {
    await d
      .prepare(
        dbKind() === 'mysql'
          ? `INSERT IGNORE INTO expense_types (name) VALUES (?)`
          : `INSERT INTO expense_types (name) VALUES (?) ON CONFLICT(name) DO NOTHING`
      )
      .run(type)
    await d.prepare(
      `UPDATE rack_expenses SET expense_type=?, amount=?, date=?, remarks=? WHERE id=?`
    ).run(type, roundMoney(Number(p.amount)), p.date, p.remarks ?? '', p.id)
  })
  return (await d.prepare(`SELECT * FROM rack_expenses WHERE id = ?`).get(p.id)) as RackExpense
}

export async function deleteExpense(payload: { id: number }): Promise<{ ok: boolean }> {
  const d = getDb()
  await d.prepare(`DELETE FROM rack_expenses WHERE id = ?`).run(payload.id)
  return { ok: true }
}

/** All expenses across racks (for the expenses register report). */
export interface ExpenseFilter {
  rack_id?: number
  expense_type?: string
  from?: string
  to?: string
}

export async function listExpenses(filter: ExpenseFilter = {}): Promise<RackExpense[]> {
  const d = getDb()
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (filter.rack_id) {
    where.push('e.rack_id = @rack_id')
    params.rack_id = filter.rack_id
  }
  if (filter.expense_type) {
    where.push('e.expense_type = @expense_type')
    params.expense_type = filter.expense_type
  }
  if (filter.from) {
    where.push('e.date >= @from')
    params.from = filter.from
  }
  if (filter.to) {
    where.push('e.date <= @to')
    params.to = filter.to
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return (await d
    .prepare(
      `SELECT e.*, r.rack_no
       FROM rack_expenses e
       JOIN racks r ON r.id = e.rack_id
       ${clause}
       ORDER BY e.date DESC, e.id DESC`
    )
    .all(params)) as RackExpense[]
}

/* ---------------- Sales (rack -> customer, any UOM) ---------------- */

interface RackSaleTransporterInput {
  transporter_id: number
  vehicle_no?: string
  basis?: PurchaseTransportBasis
  qty?: number
  rate?: number
  charge?: number
}
interface RackSaleMachineInput {
  asset_id: number
  basis?: MachineBasis
  qty?: number
  rate?: number
  outsource_id?: number | null
}

/** Replace the transporter + machine cost lines for a rack sale. */
async function writeRackSaleChildLines(
  d: Db,
  saleId: number,
  transporters?: RackSaleTransporterInput[],
  machines?: RackSaleMachineInput[]
): Promise<void> {
  await d.prepare(`DELETE FROM rack_sale_transporters WHERE rack_sale_id = ?`).run(saleId)
  await d.prepare(`DELETE FROM rack_sale_machines WHERE rack_sale_id = ?`).run(saleId)
  const tStmt = d.prepare(
    `INSERT INTO rack_sale_transporters (rack_sale_id, transporter_id, vehicle_no, basis, qty, rate, charge) VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  for (const t of transporters ?? []) {
    if (!t.transporter_id) continue
    const basis: PurchaseTransportBasis = t.basis === 'trip' || t.basis === 'uom' ? t.basis : 'flat'
    const qty = basis === 'flat' ? 0 : Number(t.qty) || 0
    const rate = basis === 'flat' ? 0 : Number(t.rate) || 0
    const charge = basis === 'flat' ? roundMoney(Number(t.charge) || 0) : roundMoney(qty * rate)
    await tStmt.run(saleId, t.transporter_id, properCase(t.vehicle_no || ''), basis, qty, rate, charge)
  }
  const mStmt = d.prepare(
    `INSERT INTO rack_sale_machines (rack_sale_id, asset_id, basis, qty, rate, amount, outsource_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  for (const m of machines ?? []) {
    if (!m.asset_id) continue
    const basis: MachineBasis = m.basis === 'cm' ? 'cm' : 'hour'
    const qty = Number(m.qty) || 0
    const rate = Number(m.rate) || 0
    await mStmt.run(saleId, m.asset_id, basis, qty, rate, roundMoney(qty * rate), m.outsource_id ?? null)
  }
}

/** Full rack sale with its transporter + machine cost lines (for the edit modal). */
export async function getSaleDetail(payload: { id: number }): Promise<RackSale | null> {
  const d = getDb()
  const sale = (await d.prepare(`SELECT * FROM rack_sales WHERE id = ?`).get(payload.id)) as RackSale | undefined
  if (!sale) return null
  sale.transporters = (await d
    .prepare(
      `SELECT rst.*, t.name AS transporter_name FROM rack_sale_transporters rst
       JOIN transporters t ON t.id = rst.transporter_id WHERE rst.rack_sale_id = ? ORDER BY rst.id`
    )
    .all(payload.id)) as RackSaleTransporter[]
  sale.machines = (await d
    .prepare(
      `SELECT rsm.*, a.name AS asset_name, o.name AS outsource_name FROM rack_sale_machines rsm
       JOIN assets a ON a.id = rsm.asset_id
       LEFT JOIN outsource o ON o.id = rsm.outsource_id WHERE rsm.rack_sale_id = ? ORDER BY rsm.id`
    )
    .all(payload.id)) as RackSaleMachine[]
  return sale
}

export interface SaleInput {
  id?: number
  rack_id: number
  customer_id: number
  product_name: string
  uom: Uom
  quantity: number
  rate: number | null
  truck_no?: string
  /** Transporter cost lines (post to the transporter ledger + the rack). */
  transporters?: RackSaleTransporterInput[]
  /** Machine-usage cost lines (post to the rack; optional vendor payable). */
  machines?: RackSaleMachineInput[]
  date: string
  remarks: string
}

function resolveSale(p: SaleInput, factors?: UomFactors): { qtyCm: number; amount: number | null } {
  if (!(Number(p.quantity) > 0)) throw new Error('Quantity must be greater than 0.')
  if (!['CM', 'TON', 'CFT'].includes(p.uom)) throw new Error('Invalid unit of measure.')
  const qtyCm = roundQty(toCm(Number(p.quantity), p.uom, factors))
  // Rate is per selected UOM, so amount = rate × quantity in that UOM.
  return { qtyCm, amount: computeAmount(p.rate, Number(p.quantity)) }
}

export async function addSale(p: SaleInput): Promise<RackSale> {
  const d = getDb()
  const rack = (await d.prepare(`SELECT * FROM racks WHERE id = ?`).get(p.rack_id)) as Rack | undefined
  if (!rack) throw new Error('Rack not found.')
  if (rack.status === 'loading' || rack.status === 'in_transit')
    throw new Error(`Sales start once the rack has reached its destination. Mark rack "${rack.rack_no}" as Reached first.`)
  if (rack.status === 'closed') throw new Error('Rack is closed. Re-open it to add sales.')
  const { qtyCm, amount } = resolveSale(p, await rackPlantFactors(d, p.rack_id))
  const available = await rackSellable(d, p.rack_id, p.product_name)
  if (qtyCm > available)
    throw new Error(
      `Not enough unloaded material at destination. Available ${p.product_name}: ${available} m³, requested: ${qtyCm} m³. Add an unloading first.`
    )
  const id = await d.transaction(async () => {
    const no = await nextNumber('SL', 'rack_sale')
    const info = await d
      .prepare(
        `INSERT INTO rack_sales
          (sale_no, rack_id, customer_id, product_name, uom, quantity, qty_cm, rate, amount, truck_no, date, remarks)
         VALUES (@sale_no,@rack_id,@customer_id,@product_name,@uom,@quantity,@qty_cm,@rate,@amount,@truck_no,@date,@remarks)`
      )
      .run({
        sale_no: no,
        rack_id: p.rack_id,
        customer_id: p.customer_id,
        product_name: p.product_name.trim(),
        uom: p.uom,
        quantity: Number(p.quantity),
        qty_cm: qtyCm,
        rate: p.rate,
        amount,
        truck_no: (p.truck_no ?? '').trim(),
        date: p.date,
        remarks: p.remarks ?? ''
      })
    const saleId = Number(info.lastInsertRowid)
    await writeRackSaleChildLines(d, saleId, p.transporters, p.machines)
    return saleId
  })
  return (await d.prepare(`SELECT * FROM rack_sales WHERE id = ?`).get(id)) as RackSale
}

export async function updateSale(p: SaleInput): Promise<RackSale> {
  const d = getDb()
  if (!p.id) throw new Error('Missing sale id.')
  const old = (await d.prepare(`SELECT * FROM rack_sales WHERE id = ?`).get(p.id)) as RackSale | undefined
  if (!old) throw new Error('Sale not found.')
  const { qtyCm, amount } = resolveSale(p, await rackPlantFactors(d, old.rack_id))
  const available = await rackSellable(d, old.rack_id, p.product_name, p.id)
  if (qtyCm > available)
    throw new Error(
      `Not enough unloaded material at destination. Available ${p.product_name}: ${available} m³, requested: ${qtyCm} m³.`
    )
  await d.transaction(async () => {
    await d.prepare(
      `UPDATE rack_sales SET customer_id=@customer_id, product_name=@product_name, uom=@uom,
         quantity=@quantity, qty_cm=@qty_cm, rate=@rate, amount=@amount, truck_no=@truck_no, date=@date, remarks=@remarks
       WHERE id=@id`
    ).run({
      id: p.id,
      customer_id: p.customer_id,
      product_name: p.product_name.trim(),
      uom: p.uom,
      quantity: Number(p.quantity),
      qty_cm: qtyCm,
      rate: p.rate,
      amount,
      truck_no: (p.truck_no ?? '').trim(),
      date: p.date,
      remarks: p.remarks ?? ''
    })
    await writeRackSaleChildLines(d, p.id!, p.transporters, p.machines)
  })
  return (await d.prepare(`SELECT * FROM rack_sales WHERE id = ?`).get(p.id)) as RackSale
}

export async function deleteSale(payload: { id: number }): Promise<{ ok: boolean }> {
  const d = getDb()
  await d.transaction(async () => {
    await d.prepare(`DELETE FROM rack_sale_transporters WHERE rack_sale_id = ?`).run(payload.id)
    await d.prepare(`DELETE FROM rack_sale_machines WHERE rack_sale_id = ?`).run(payload.id)
    await d.prepare(`DELETE FROM rack_sales WHERE id = ?`).run(payload.id)
  })
  return { ok: true }
}

/** All rack sales across racks (for reports / customer summary). */
export interface SaleFilter {
  rack_id?: number
  customer_id?: number
  product_name?: string
  from?: string
  to?: string
}

export async function listSales(filter: SaleFilter = {}): Promise<RackSale[]> {
  const d = getDb()
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (filter.rack_id) {
    where.push('rs.rack_id = @rack_id')
    params.rack_id = filter.rack_id
  }
  if (filter.customer_id) {
    where.push('rs.customer_id = @customer_id')
    params.customer_id = filter.customer_id
  }
  if (filter.product_name) {
    where.push('rs.product_name = @product_name')
    params.product_name = filter.product_name
  }
  if (filter.from) {
    where.push('rs.date >= @from')
    params.from = filter.from
  }
  if (filter.to) {
    where.push('rs.date <= @to')
    params.to = filter.to
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return (await d
    .prepare(
      `SELECT rs.*, c.name AS customer_name, r.rack_no
       FROM rack_sales rs
       JOIN customers c ON c.id = rs.customer_id
       JOIN racks r ON r.id = rs.rack_id
       ${clause}
       ORDER BY rs.date DESC, rs.id DESC`
    )
    .all(params)) as RackSale[]
}
