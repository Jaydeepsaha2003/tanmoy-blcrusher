import { getDb, nextNumber } from '../db'
import type { Dispatch, DeliveryStatus, PaymentStatus, VehicleType, Uom, UomFactors } from '@shared/types'
import { properCase, toCm, derivePaymentStatus } from '@shared/types'
import { addMovement, finishedBalance } from './movements'
import { plantUomFactors } from './plants'

export interface DispatchFilter {
  customer_id?: number
  plant_id?: number
  product_name?: string
  delivery_status?: DeliveryStatus
  payment_status?: PaymentStatus
  rate_pending?: boolean
  from?: string
  to?: string
}

// Amount the customer is billed: goods value plus any charges flagged as billable.
const BILLED_TOTAL_SQL = `(COALESCE(di.amount,0)
  + CASE WHEN di.transport_billed = 1 THEN di.transport_charge ELSE 0 END
  + CASE WHEN di.other_billed = 1 THEN di.other_charge ELSE 0 END)`

export async function listDispatches(filter: DispatchFilter = {}): Promise<Dispatch[]> {
  const d = getDb()
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (filter.customer_id) {
    where.push('di.customer_id = @customer_id')
    params.customer_id = filter.customer_id
  }
  if (filter.plant_id) {
    where.push('di.plant_id = @plant_id')
    params.plant_id = filter.plant_id
  }
  if (filter.product_name) {
    where.push('di.product_name = @product_name')
    params.product_name = filter.product_name
  }
  if (filter.delivery_status) {
    where.push('di.delivery_status = @delivery_status')
    params.delivery_status = filter.delivery_status
  }
  if (filter.payment_status) {
    where.push('di.payment_status = @payment_status')
    params.payment_status = filter.payment_status
  }
  if (filter.rate_pending) {
    where.push('di.rate IS NULL')
  }
  if (filter.from) {
    where.push('di.date >= @from')
    params.from = filter.from
  }
  if (filter.to) {
    where.push('di.date <= @to')
    params.to = filter.to
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return (await d
    .prepare(
      `SELECT di.*, c.name AS customer_name, p.name AS plant_name,
        ${BILLED_TOTAL_SQL} AS billed_total
       FROM dispatches di
       JOIN customers c ON c.id = di.customer_id
       JOIN plants p ON p.id = di.plant_id
       ${clause}
       ORDER BY di.date DESC, di.id DESC`
    )
    .all(params)) as Dispatch[]
}

function computeAmount(rate: number | null, qty: number): number | null {
  if (rate == null || isNaN(rate)) return null
  return Math.round((rate * qty + Number.EPSILON) * 100) / 100
}

function roundQty(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000
}

export interface DispatchInput {
  id?: number
  customer_id: number
  plant_id: number
  product_name: string
  uom: Uom
  quantity: number
  sale_quantity?: number | null
  rate: number | null
  transport_charge?: number
  transport_billed?: boolean | number
  other_charge?: number
  other_billed?: boolean | number
  vehicle_no: string
  vehicle_type: VehicleType
  driver: string
  challan_no: string
  outsourced?: boolean | number
  delivery_status: DeliveryStatus
  paid_amount?: number
  date: string
  remarks: string
}

function normalize(p: DispatchInput, factors?: UomFactors): {
  product: string
  qtyCm: number
  amount: number | null
  outsourced: boolean
  fields: Record<string, unknown>
} {
  if (!(Number(p.quantity) > 0)) throw new Error('Actual quantity must be greater than 0.')
  if (!['CM', 'TON', 'CFT'].includes(p.uom)) throw new Error('Invalid unit of measure.')
  const product = properCase(p.product_name)
  const actualQty = Number(p.quantity)
  // Sale quantity is optional (added later). null = not set yet → bill the actual.
  const saleQty =
    p.sale_quantity == null || (p.sale_quantity as unknown) === '' ? null : Number(p.sale_quantity)
  if (saleQty != null && saleQty < 0) throw new Error('Sale quantity cannot be negative.')
  const billableQty = saleQty != null ? saleQty : actualQty
  // Stock always moves by the ACTUAL quantity dispatched from the plant.
  const qtyCm = roundQty(toCm(actualQty, p.uom, factors))
  const amount = computeAmount(p.rate, billableQty)
  const transport = Number(p.transport_charge) || 0
  const other = Number(p.other_charge) || 0
  const billed = (amount ?? 0) + (p.transport_billed ? transport : 0) + (p.other_billed ? other : 0)
  const paid = Number(p.paid_amount) || 0
  const outsourced = !!p.outsourced
  return {
    product,
    qtyCm,
    amount,
    outsourced,
    fields: {
      customer_id: p.customer_id,
      plant_id: p.plant_id,
      product_name: product,
      uom: p.uom,
      quantity: actualQty,
      qty_cm: qtyCm,
      sale_quantity: saleQty,
      rate: p.rate,
      amount,
      transport_charge: transport,
      transport_billed: p.transport_billed ? 1 : 0,
      other_charge: other,
      other_billed: p.other_billed ? 1 : 0,
      vehicle_no: p.vehicle_no ?? '',
      vehicle_type: p.vehicle_type || 'own',
      driver: properCase(p.driver),
      challan_no: (p.challan_no ?? '').trim(),
      outsourced: outsourced ? 1 : 0,
      delivery_status: p.delivery_status,
      payment_status: derivePaymentStatus(billed, paid),
      paid_amount: paid,
      date: p.date,
      remarks: p.remarks ?? ''
    }
  }
}

export async function createDispatch(p: DispatchInput): Promise<Dispatch> {
  const d = getDb()
  const { product, qtyCm, outsourced, fields } = normalize(p, await plantUomFactors(p.plant_id))
  if (!outsourced) {
    const available = await finishedBalance(d, p.plant_id, product)
    if (qtyCm > available)
      throw new Error(
        `Not enough finished goods. Available ${product}: ${available} m³, requested: ${qtyCm} m³.`
      )
  }
  const id = await d.transaction(async () => {
    const no = await nextNumber('SALE', 'dispatch')
    const info = await d
      .prepare(
        `INSERT INTO dispatches
          (dispatch_no, customer_id, plant_id, product_name, uom, quantity, qty_cm, sale_quantity, rate, amount,
           transport_charge, transport_billed, other_charge, other_billed,
           vehicle_no, vehicle_type, driver, challan_no, outsourced, delivery_status, payment_status, paid_amount, date, remarks)
         VALUES (@dispatch_no,@customer_id,@plant_id,@product_name,@uom,@quantity,@qty_cm,@sale_quantity,@rate,@amount,
           @transport_charge,@transport_billed,@other_charge,@other_billed,
           @vehicle_no,@vehicle_type,@driver,@challan_no,@outsourced,@delivery_status,@payment_status,@paid_amount,@date,@remarks)`
      )
      .run({ dispatch_no: no, ...fields })
    if (!outsourced) {
      await addMovement(d, {
        type: 'dispatch',
        material_type: 'finished',
        ref_no: no,
        plant_id: p.plant_id,
        product_name: product,
        change_qty: -qtyCm,
        date: p.date,
        note: 'Direct sale to customer'
      })
      if ((await finishedBalance(d, p.plant_id, product)) < 0) throw new Error('Stock cannot go negative.')
    }
    return Number(info.lastInsertRowid)
  })
  return (await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(id)) as Dispatch
}

export async function updateDispatch(p: DispatchInput): Promise<Dispatch> {
  const d = getDb()
  if (!p.id) throw new Error('Missing dispatch id.')
  const old = (await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(p.id)) as Dispatch
  if (!old) throw new Error('Dispatch not found.')
  const { product, qtyCm, outsourced, fields } = normalize(p, await plantUomFactors(p.plant_id))
  await d.transaction(async () => {
    await d.prepare(
      `UPDATE dispatches SET customer_id=@customer_id, plant_id=@plant_id, product_name=@product_name,
        uom=@uom, quantity=@quantity, qty_cm=@qty_cm, sale_quantity=@sale_quantity, rate=@rate, amount=@amount,
        transport_charge=@transport_charge, transport_billed=@transport_billed,
        other_charge=@other_charge, other_billed=@other_billed,
        vehicle_no=@vehicle_no, vehicle_type=@vehicle_type, driver=@driver, challan_no=@challan_no,
        outsourced=@outsourced, delivery_status=@delivery_status, payment_status=@payment_status, paid_amount=@paid_amount,
        date=@date, remarks=@remarks WHERE id=@id`
    ).run({ id: p.id, ...fields })
    // Rebuild the stock movement to match the current outsourced flag.
    await d.prepare(`DELETE FROM stock_movements WHERE ref_no=? AND type='dispatch'`).run(old.dispatch_no)
    if (!outsourced) {
      await addMovement(d, {
        type: 'dispatch',
        material_type: 'finished',
        ref_no: old.dispatch_no,
        plant_id: p.plant_id,
        product_name: product,
        change_qty: -qtyCm,
        date: p.date,
        note: 'Direct sale to customer'
      })
      if ((await finishedBalance(d, old.plant_id, old.product_name)) < 0)
        throw new Error('Edit would make finished goods stock negative.')
      if ((await finishedBalance(d, p.plant_id, product)) < 0)
        throw new Error('Edit would make finished goods stock negative.')
    }
  })
  return (await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(p.id)) as Dispatch
}

export async function setRate(payload: { id: number; rate: number }): Promise<Dispatch> {
  const d = getDb()
  const row = (await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(payload.id)) as Dispatch
  // Bill the sale quantity when it has been entered, else the actual quantity.
  const billableQty = row.sale_quantity != null ? row.sale_quantity : row.quantity
  const amount = computeAmount(payload.rate, billableQty)
  await d.prepare(`UPDATE dispatches SET rate=?, amount=? WHERE id=?`).run(payload.rate, amount, payload.id)
  return (await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(payload.id)) as Dispatch
}

export async function setDelivery(payload: {
  id: number
  delivery_status: DeliveryStatus
}): Promise<Dispatch> {
  const d = getDb()
  await d.prepare(`UPDATE dispatches SET delivery_status=? WHERE id=?`).run(
    payload.delivery_status,
    payload.id
  )
  return (await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(payload.id)) as Dispatch
}

export async function setPayment(payload: {
  id: number
  paid_amount: number
  payment_status: PaymentStatus
}): Promise<Dispatch> {
  const d = getDb()
  await d.prepare(`UPDATE dispatches SET paid_amount=?, payment_status=? WHERE id=?`).run(
    Number(payload.paid_amount) || 0,
    payload.payment_status,
    payload.id
  )
  return (await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(payload.id)) as Dispatch
}

export async function deleteDispatch(payload: {
  id: number
}): Promise<{ ok: boolean; error?: string }> {
  const d = getDb()
  const old = (await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(payload.id)) as Dispatch
  if (!old) return { ok: false, error: 'Sale not found.' }
  await d.transaction(async () => {
    await d.prepare(`DELETE FROM stock_movements WHERE ref_no=? AND type='dispatch'`).run(old.dispatch_no)
    await d.prepare(`DELETE FROM dispatches WHERE id = ?`).run(payload.id)
  })
  return { ok: true }
}
