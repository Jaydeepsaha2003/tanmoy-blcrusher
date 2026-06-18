import { getDb, nextNumber } from '../db'
import type { Purchase, PaymentStatus, Uom, MaterialType } from '@shared/types'
import { derivePaymentStatus, toCm, properCase } from '@shared/types'
import { addMovement, rawLocationBalance, finishedBalance } from './movements'
import { ensureDefaultLocation } from './stockLocations'
import { plantUomFactors } from './plants'

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
  stock_location_id?: number
  /** 'raw' (default) buys raw material into a location; 'finished' buys a product into finished stock. */
  material_type?: MaterialType
  /** Product name, required when material_type = 'finished'. */
  product_name?: string
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
  const kind: MaterialType = p.material_type === 'finished' ? 'finished' : 'raw'
  const product = kind === 'finished' ? properCase(p.product_name || '') : ''
  if (kind === 'finished' && !product) throw new Error('Select a product to purchase.')
  // A stock-location is always stored (NOT NULL); for finished purchases it is the
  // plant's default and is not used for finished-goods tracking.
  const locId = p.stock_location_id || (await ensureDefaultLocation(p.plant_id))
  const uom: Uom = (['CM', 'TON', 'CFT'] as const).includes(p.uom) ? p.uom : 'CM'
  const qtyCm = roundQty(toCm(p.quantity, uom, await plantUomFactors(p.plant_id)))
  const amount = computeAmount(p.rate, p.quantity)
  const id = await d.transaction(async () => {
    const no = await nextNumber('PUR', 'purchase')
    const info = await d
      .prepare(
        `INSERT INTO purchases
          (purchase_no, supplier_id, plant_id, stock_location_id, material_type, product_name, uom, quantity, qty_cm, rate, amount, paid_amount, payment_status, date, remarks)
         VALUES (@purchase_no,@supplier_id,@plant_id,@stock_location_id,@material_type,@product_name,@uom,@quantity,@qty_cm,@rate,@amount,@paid_amount,@payment_status,@date,@remarks)`
      )
      .run({
        purchase_no: no,
        supplier_id: p.supplier_id,
        plant_id: p.plant_id,
        stock_location_id: locId,
        material_type: kind,
        product_name: product,
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
    if (kind === 'finished') {
      await addMovement(d, {
        type: 'purchase',
        material_type: 'finished',
        ref_no: no,
        plant_id: p.plant_id,
        product_name: product,
        change_qty: qtyCm,
        date: p.date,
        note: 'Finished goods purchased'
      })
    } else {
      await addMovement(d, {
        type: 'purchase',
        material_type: 'raw',
        ref_no: no,
        plant_id: p.plant_id,
        stock_location_id: locId,
        change_qty: qtyCm,
        date: p.date,
        note: 'Raw material received'
      })
    }
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
  const kind: MaterialType = p.material_type === 'finished' ? 'finished' : 'raw'
  const product = kind === 'finished' ? properCase(p.product_name || '') : ''
  if (kind === 'finished' && !product) throw new Error('Select a product to purchase.')
  const locId = p.stock_location_id || old.stock_location_id || (await ensureDefaultLocation(p.plant_id))
  const uom: Uom = (['CM', 'TON', 'CFT'] as const).includes(p.uom) ? p.uom : 'CM'
  const qtyCm = roundQty(toCm(p.quantity, uom, await plantUomFactors(p.plant_id)))
  const amount = computeAmount(p.rate, p.quantity)
  await d.transaction(async () => {
    await d.prepare(
      `UPDATE purchases SET supplier_id=@supplier_id, plant_id=@plant_id, stock_location_id=@stock_location_id,
         material_type=@material_type, product_name=@product_name,
         uom=@uom, quantity=@quantity, qty_cm=@qty_cm, rate=@rate, amount=@amount, paid_amount=@paid_amount,
         payment_status=@payment_status, date=@date, remarks=@remarks WHERE id=@id`
    ).run({
      id: p.id,
      supplier_id: p.supplier_id,
      plant_id: p.plant_id,
      stock_location_id: locId,
      material_type: kind,
      product_name: product,
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
    // Rebuild the linked stock movement (kind may have changed on edit).
    await d.prepare(`DELETE FROM stock_movements WHERE ref_no=? AND type='purchase'`).run(old.purchase_no)
    if (kind === 'finished') {
      await addMovement(d, {
        type: 'purchase',
        material_type: 'finished',
        ref_no: old.purchase_no,
        plant_id: p.plant_id,
        product_name: product,
        change_qty: qtyCm,
        date: p.date,
        note: 'Finished goods purchased'
      })
    } else {
      await addMovement(d, {
        type: 'purchase',
        material_type: 'raw',
        ref_no: old.purchase_no,
        plant_id: p.plant_id,
        stock_location_id: locId,
        change_qty: qtyCm,
        date: p.date,
        note: 'Raw material received'
      })
    }

    // Guard against negative balances at any affected location/product (old & new).
    if ((await rawLocationBalance(d, old.stock_location_id)) < 0)
      throw new Error('Edit would make the original location stock negative.')
    if (kind === 'raw' && (await rawLocationBalance(d, locId)) < 0)
      throw new Error('Edit would make the location stock negative.')
    if (old.material_type === 'finished' && old.product_name &&
        (await finishedBalance(d, old.plant_id, old.product_name)) < 0)
      throw new Error('Edit would make the original finished-goods stock negative.')
    if (kind === 'finished' && (await finishedBalance(d, p.plant_id, product)) < 0)
      throw new Error('Edit would make the finished-goods stock negative.')
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
      if (old.material_type === 'finished') {
        if (old.product_name && (await finishedBalance(d, old.plant_id, old.product_name)) < 0)
          throw new Error('Cannot delete: these finished goods have already been dispatched or sold.')
      } else if ((await rawLocationBalance(d, old.stock_location_id)) < 0) {
        throw new Error('Cannot delete: this material has already been consumed in production.')
      }
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
