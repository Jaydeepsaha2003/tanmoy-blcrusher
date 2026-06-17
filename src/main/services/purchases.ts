import { getDb, nextNumber } from '../db'
import type { Purchase, PaymentStatus, Uom } from '@shared/types'
import { derivePaymentStatus, toCm } from '@shared/types'
import { addMovement, rawLocationBalance } from './movements'

export interface PurchaseFilter {
  supplier_id?: number
  plant_id?: number
  payment_status?: PaymentStatus
  from?: string
  to?: string
}

export async function listPurchases(filter: PurchaseFilter = {}): Promise<Purchase[]> {
  const d = getDb()
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (filter.supplier_id) {
    where.push('pu.supplier_id = @supplier_id')
    params.supplier_id = filter.supplier_id
  }
  if (filter.plant_id) {
    where.push('pu.plant_id = @plant_id')
    params.plant_id = filter.plant_id
  }
  if (filter.payment_status) {
    where.push('pu.payment_status = @payment_status')
    params.payment_status = filter.payment_status
  }
  if (filter.from) {
    where.push('pu.date >= @from')
    params.from = filter.from
  }
  if (filter.to) {
    where.push('pu.date <= @to')
    params.to = filter.to
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return (await d
    .prepare(
      `SELECT pu.*, s.name AS supplier_name, p.name AS plant_name, l.name AS stock_location_name
       FROM purchases pu
       JOIN suppliers s ON s.id = pu.supplier_id
       JOIN plants p ON p.id = pu.plant_id
       JOIN stock_locations l ON l.id = pu.stock_location_id
       ${clause}
       ORDER BY pu.date DESC, pu.id DESC`
    )
    .all(params)) as Purchase[]
}

function computeAmount(rate: number | null, qty: number): number | null {
  if (rate == null || isNaN(rate)) return null
  return Math.round((rate * qty + Number.EPSILON) * 100) / 100
}

function roundQty(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000
}

export interface PurchaseInput {
  id?: number
  supplier_id: number
  plant_id: number
  stock_location_id: number
  uom: Uom
  quantity: number
  rate: number | null
  paid_amount: number
  payment_status: PaymentStatus
  date: string
  remarks: string
}

export async function createPurchase(p: PurchaseInput): Promise<Purchase> {
  const d = getDb()
  if (!(p.quantity > 0)) throw new Error('Quantity must be greater than 0.')
  const uom: Uom = (['CM', 'TON', 'CFT'] as const).includes(p.uom) ? p.uom : 'CM'
  const qtyCm = roundQty(toCm(p.quantity, uom))
  const amount = computeAmount(p.rate, p.quantity)
  const id = await d.transaction(async () => {
    const no = await nextNumber('PUR', 'purchase')
    const info = await d
      .prepare(
        `INSERT INTO purchases
          (purchase_no, supplier_id, plant_id, stock_location_id, uom, quantity, qty_cm, rate, amount, paid_amount, payment_status, date, remarks)
         VALUES (@purchase_no,@supplier_id,@plant_id,@stock_location_id,@uom,@quantity,@qty_cm,@rate,@amount,@paid_amount,@payment_status,@date,@remarks)`
      )
      .run({
        purchase_no: no,
        supplier_id: p.supplier_id,
        plant_id: p.plant_id,
        stock_location_id: p.stock_location_id,
        uom,
        quantity: p.quantity,
        qty_cm: qtyCm,
        rate: p.rate,
        amount,
        paid_amount: p.paid_amount || 0,
        payment_status: derivePaymentStatus(amount ?? 0, p.paid_amount || 0),
        date: p.date,
        remarks: p.remarks ?? ''
      })
    await addMovement(d, {
      type: 'purchase',
      material_type: 'raw',
      ref_no: no,
      plant_id: p.plant_id,
      stock_location_id: p.stock_location_id,
      change_qty: qtyCm,
      date: p.date,
      note: 'Raw material received'
    })
    return Number(info.lastInsertRowid)
  })
  return (await d.prepare(`SELECT * FROM purchases WHERE id = ?`).get(id)) as Purchase
}

export async function updatePurchase(p: PurchaseInput): Promise<Purchase> {
  const d = getDb()
  if (!p.id) throw new Error('Missing purchase id.')
  if (!(p.quantity > 0)) throw new Error('Quantity must be greater than 0.')
  const old = (await d.prepare(`SELECT * FROM purchases WHERE id = ?`).get(p.id)) as Purchase
  if (!old) throw new Error('Purchase not found.')
  const uom: Uom = (['CM', 'TON', 'CFT'] as const).includes(p.uom) ? p.uom : 'CM'
  const qtyCm = roundQty(toCm(p.quantity, uom))
  const amount = computeAmount(p.rate, p.quantity)
  await d.transaction(async () => {
    await d.prepare(
      `UPDATE purchases SET supplier_id=@supplier_id, plant_id=@plant_id, stock_location_id=@stock_location_id,
         uom=@uom, quantity=@quantity, qty_cm=@qty_cm, rate=@rate, amount=@amount, paid_amount=@paid_amount,
         payment_status=@payment_status, date=@date, remarks=@remarks WHERE id=@id`
    ).run({
      id: p.id,
      supplier_id: p.supplier_id,
      plant_id: p.plant_id,
      stock_location_id: p.stock_location_id,
      uom,
      quantity: p.quantity,
      qty_cm: qtyCm,
      rate: p.rate,
      amount,
      paid_amount: p.paid_amount || 0,
      payment_status: derivePaymentStatus(amount ?? 0, p.paid_amount || 0),
      date: p.date,
      remarks: p.remarks ?? ''
    })
    // Re-point the linked stock movement (in base m³).
    await d.prepare(
      `UPDATE stock_movements SET plant_id=?, stock_location_id=?, change_qty=?, date=?
       WHERE ref_no=? AND type='purchase'`
    ).run(p.plant_id, p.stock_location_id, qtyCm, p.date, old.purchase_no)

    if ((await rawLocationBalance(d, old.stock_location_id)) < 0)
      throw new Error('Edit would make the original location stock negative.')
    if ((await rawLocationBalance(d, p.stock_location_id)) < 0)
      throw new Error('Edit would make the location stock negative.')
  })
  return (await d.prepare(`SELECT * FROM purchases WHERE id = ?`).get(p.id)) as Purchase
}

export async function deletePurchase(payload: { id: number }): Promise<{ ok: boolean; error?: string }> {
  const d = getDb()
  const old = (await d.prepare(`SELECT * FROM purchases WHERE id = ?`).get(payload.id)) as Purchase
  if (!old) return { ok: false, error: 'Purchase not found.' }
  try {
    await d.transaction(async () => {
      await d.prepare(`DELETE FROM stock_movements WHERE ref_no=? AND type='purchase'`).run(
        old.purchase_no
      )
      if ((await rawLocationBalance(d, old.stock_location_id)) < 0)
        throw new Error('Cannot delete: this material has already been consumed in production.')
      await d.prepare(`DELETE FROM purchases WHERE id = ?`).run(payload.id)
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function setPurchasePayment(payload: {
  id: number
  paid_amount: number
  payment_status: PaymentStatus
}): Promise<Purchase> {
  const d = getDb()
  await d.prepare(`UPDATE purchases SET paid_amount=?, payment_status=? WHERE id=?`).run(
    payload.paid_amount || 0,
    payload.payment_status,
    payload.id
  )
  return (await d.prepare(`SELECT * FROM purchases WHERE id = ?`).get(payload.id)) as Purchase
}
