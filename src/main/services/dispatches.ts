import { getDb, nextNumber, type Db } from '../db'
import type {
  Dispatch,
  DeliveryStatus,
  DispatchStatus,
  PaymentStatus,
  VehicleType,
  Uom,
  UomFactors,
  MachineBasis,
  PurchaseTransportBasis,
  DispatchTransporter,
  DispatchMachine
} from '@shared/types'
import { properCase, toCm, derivePaymentStatus } from '@shared/types'
import { addMovement, finishedBalance } from './movements'
import { plantUomFactors } from './plants'
import { createPurchase, removeLinkedPurchase } from './purchases'

export interface DispatchFilter {
  customer_id?: number
  plant_id?: number
  product_name?: string
  delivery_status?: DeliveryStatus
  dispatch_status?: DispatchStatus
  payment_status?: PaymentStatus
  rate_pending?: boolean
  from?: string
  to?: string
}

// Amount the customer is billed: goods value plus any charges flagged as billable.
const BILLED_TOTAL_SQL = `(COALESCE(di.amount,0)
  + CASE WHEN di.transport_billed = 1 THEN di.transport_charge ELSE 0 END
  + CASE WHEN di.other_billed = 1 THEN di.other_charge ELSE 0 END)`

function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100
}

/**
 * Resolve the sale invoice/voucher number: use the user's value if given (must be
 * unique), otherwise auto-generate the next SALE number. Runs inside a transaction.
 */
async function resolveInvoiceNo(d: Db, provided: string | undefined): Promise<string> {
  const wanted = (provided ?? '').trim()
  if (!wanted) return nextNumber('SALE', 'dispatch')
  const dupe = (await d.prepare(`SELECT id FROM dispatches WHERE dispatch_no = ?`).get(wanted)) as
    | { id: number }
    | undefined
  if (dupe) throw new Error(`Invoice number "${wanted}" is already used by another sale.`)
  return wanted
}

/** A transporter cost line as accepted from the UI. */
interface DispatchTransporterInput {
  transporter_id: number
  vehicle_no?: string
  basis?: PurchaseTransportBasis
  qty?: number
  rate?: number
  charge?: number
}
/** A machine-usage cost line as accepted from the UI. */
interface DispatchMachineInput {
  asset_id: number
  basis?: MachineBasis
  qty?: number
  rate?: number
  outsource_id?: number | null
}

/** Replace the transporter + machine cost lines for a direct sale. */
async function writeDispatchChildLines(
  d: Db,
  dispatchId: number,
  transporters?: DispatchTransporterInput[],
  machines?: DispatchMachineInput[]
): Promise<void> {
  await d.prepare(`DELETE FROM dispatch_transporters WHERE dispatch_id = ?`).run(dispatchId)
  await d.prepare(`DELETE FROM dispatch_machines WHERE dispatch_id = ?`).run(dispatchId)
  const tStmt = d.prepare(
    `INSERT INTO dispatch_transporters (dispatch_id, transporter_id, vehicle_no, basis, qty, rate, charge) VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  for (const t of transporters ?? []) {
    if (!t.transporter_id) continue
    const basis: PurchaseTransportBasis = t.basis === 'trip' || t.basis === 'uom' ? t.basis : 'flat'
    const qty = basis === 'flat' ? 0 : Number(t.qty) || 0
    const rate = basis === 'flat' ? 0 : Number(t.rate) || 0
    const charge = basis === 'flat' ? round2(Number(t.charge) || 0) : round2(qty * rate)
    await tStmt.run(dispatchId, t.transporter_id, properCase(t.vehicle_no || ''), basis, qty, rate, charge)
  }
  const mStmt = d.prepare(
    `INSERT INTO dispatch_machines (dispatch_id, asset_id, basis, qty, rate, amount, outsource_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  for (const m of machines ?? []) {
    if (!m.asset_id) continue
    const basis: MachineBasis = m.basis === 'cm' ? 'cm' : 'hour'
    const qty = Number(m.qty) || 0
    const rate = Number(m.rate) || 0
    await mStmt.run(dispatchId, m.asset_id, basis, qty, rate, round2(qty * rate), m.outsource_id ?? null)
  }
}

/** Full direct sale with its transporter + machine cost lines (for the edit modal). */
export async function getDispatchDetail(payload: { id: number }): Promise<Dispatch | null> {
  const d = getDb()
  const di = (await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(payload.id)) as Dispatch | undefined
  if (!di) return null
  di.transporters = (await d
    .prepare(
      `SELECT dt.*, t.name AS transporter_name FROM dispatch_transporters dt
       JOIN transporters t ON t.id = dt.transporter_id WHERE dt.dispatch_id = ? ORDER BY dt.id`
    )
    .all(payload.id)) as DispatchTransporter[]
  di.machines = (await d
    .prepare(
      `SELECT dm.*, a.name AS asset_name, o.name AS outsource_name FROM dispatch_machines dm
       JOIN assets a ON a.id = dm.asset_id
       LEFT JOIN outsource o ON o.id = dm.outsource_id WHERE dm.dispatch_id = ? ORDER BY dm.id`
    )
    .all(payload.id)) as DispatchMachine[]
  return di
}

/** Find (or create) the internal customer/supplier that stands in for a plant in inter-plant trade. */
async function plantName(plantId: number): Promise<string> {
  const r = (await getDb().prepare(`SELECT name FROM plants WHERE id = ?`).get(plantId)) as
    | { name: string }
    | undefined
  return r?.name ?? `Plant ${plantId}`
}
async function ensureInternalCustomer(refPlantId: number): Promise<number> {
  const d = getDb()
  const ex = (await d.prepare(`SELECT id FROM customers WHERE plant_ref_id = ?`).get(refPlantId)) as
    | { id: number }
    | undefined
  if (ex) return ex.id
  const info = await d
    .prepare(
      `INSERT INTO customers (name, contact, address, remarks, plant_ref_id) VALUES (?, '', '', 'Internal — inter-plant', ?)`
    )
    .run(properCase(await plantName(refPlantId)), refPlantId)
  return Number(info.lastInsertRowid)
}
async function ensureInternalSupplier(refPlantId: number): Promise<number> {
  const d = getDb()
  const ex = (await d.prepare(`SELECT id FROM suppliers WHERE plant_ref_id = ?`).get(refPlantId)) as
    | { id: number }
    | undefined
  if (ex) return ex.id
  const info = await d
    .prepare(
      `INSERT INTO suppliers (name, contact, address, remarks, plant_ref_id) VALUES (?, '', '', 'Internal — inter-plant', ?)`
    )
    .run(properCase(await plantName(refPlantId)), refPlantId)
  return Number(info.lastInsertRowid)
}

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
  if (filter.dispatch_status) {
    where.push('di.dispatch_status = @dispatch_status')
    params.dispatch_status = filter.dispatch_status
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
        o.name AS outsource_name, o.head AS outsource_head, t.name AS transporter_name,
        tp.name AS to_plant_name,
        ${BILLED_TOTAL_SQL} AS billed_total,
        (SELECT COALESCE(SUM(charge),0) FROM dispatch_transporters dt WHERE dt.dispatch_id = di.id) AS transport_total,
        (SELECT COALESCE(SUM(amount),0) FROM dispatch_machines dm WHERE dm.dispatch_id = di.id) AS machine_total
       FROM dispatches di
       JOIN customers c ON c.id = di.customer_id
       JOIN plants p ON p.id = di.plant_id
       LEFT JOIN outsource o ON o.id = di.outsource_id
       LEFT JOIN transporters t ON t.id = di.transporter_id
       LEFT JOIN plants tp ON tp.id = di.to_plant_id
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
  /** Optional user-supplied invoice/voucher no; blank → auto-generated. */
  dispatch_no?: string
  customer_id: number
  plant_id: number
  product_name: string
  uom: Uom
  quantity: number
  sale_quantity?: number | null
  rate: number | null
  /** Outsource sale only: vendor buy rate per unit. */
  buy_rate?: number | null
  transport_charge?: number
  transport_billed?: boolean | number
  other_charge?: number
  other_billed?: boolean | number
  vehicle_no: string
  vehicle_type: VehicleType
  transporter_id?: number | null
  driver: string
  challan_no: string
  outsourced?: boolean | number
  outsource_id?: number | null
  delivery_status: DeliveryStatus
  paid_amount?: number
  /** When set, sell to our own other plant — mirrors a finished-goods purchase there. */
  to_plant_id?: number | null
  /** Transporter cost lines (post to the transporter & plant ledgers). */
  transporters?: DispatchTransporterInput[]
  /** Machine-usage cost lines (post to plant Equipment Rent; optional vendor payable). */
  machines?: DispatchMachineInput[]
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
  if (!['CM', 'TON', 'CFT'].includes(p.uom)) throw new Error('Invalid unit of measure.')
  const product = properCase(p.product_name)
  const outsourcedFlag = !!p.outsourced
  // Sale quantity is optional (added later). null = not set yet → bill the actual.
  const saleQty =
    p.sale_quantity == null || (p.sale_quantity as unknown) === '' ? null : Number(p.sale_quantity)
  if (saleQty != null && saleQty < 0) throw new Error('Sale quantity cannot be negative.')
  // An outsource sale moves no stock, so the actual qty is optional — fall back to the sale qty.
  const rawActual = Number(p.quantity)
  const actualQty =
    rawActual > 0 ? rawActual : outsourcedFlag && saleQty != null && saleQty > 0 ? saleQty : rawActual
  if (!(actualQty > 0)) throw new Error('Actual quantity must be greater than 0.')
  const billableQty = saleQty != null ? saleQty : actualQty
  // Stock always moves by the ACTUAL quantity dispatched from the plant.
  const qtyCm = roundQty(toCm(actualQty, p.uom, factors))
  const amount = computeAmount(p.rate, billableQty)
  const transport = Number(p.transport_charge) || 0
  const other = Number(p.other_charge) || 0
  const billed = (amount ?? 0) + (p.transport_billed ? transport : 0) + (p.other_billed ? other : 0)
  const paid = Number(p.paid_amount) || 0
  const outsourced = outsourcedFlag
  // Buy rate is only meaningful on an outsource sale (drives the vendor payable + profit).
  const buyRate =
    outsourced && p.buy_rate != null && (p.buy_rate as unknown) !== '' ? Number(p.buy_rate) : null
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
      buy_rate: buyRate,
      amount,
      transport_charge: transport,
      transport_billed: p.transport_billed ? 1 : 0,
      other_charge: other,
      other_billed: p.other_billed ? 1 : 0,
      vehicle_no: p.vehicle_no ?? '',
      vehicle_type: p.vehicle_type || 'own',
      transporter_id: p.transporter_id ?? null,
      driver: properCase(p.driver),
      challan_no: (p.challan_no ?? '').trim(),
      outsourced: outsourced ? 1 : 0,
      outsource_id: outsourced ? (p.outsource_id ?? null) : null,
      delivery_status: p.delivery_status,
      payment_status: derivePaymentStatus(billed, paid),
      paid_amount: paid,
      date: p.date,
      remarks: p.remarks ?? ''
    }
  }
}

/** Create the finished-goods purchase that mirrors an inter-plant sale in the destination plant. */
async function createMirrorPurchase(
  sourcePlantId: number,
  destPlantId: number,
  dispatchId: number,
  product: string,
  qtyCm: number,
  amount: number | null,
  date: string
): Promise<number> {
  const supplierId = await ensureInternalSupplier(sourcePlantId)
  // Express the transfer in m³ so stock is conserved regardless of per-plant density factors;
  // rate per m³ keeps the purchase value equal to the sale value.
  const ratePerCm = amount != null && qtyCm > 0 ? round2(amount / qtyCm) : null
  const mirror = await createPurchase({
    supplier_id: supplierId,
    plant_id: destPlantId,
    material_type: 'finished',
    product_name: product,
    purchase_mode: 'purchase',
    from_plant_id: sourcePlantId,
    linked_dispatch_id: dispatchId,
    uom: 'CM',
    quantity: qtyCm,
    rate: ratePerCm,
    paid_amount: 0,
    payment_status: 'unpaid',
    date,
    remarks: `Inter-plant — received from ${await plantName(sourcePlantId)}`
  })
  return mirror.id
}

export async function createDispatch(p: DispatchInput): Promise<Dispatch> {
  const d = getDb()
  const interPlant =
    p.to_plant_id != null && Number(p.to_plant_id) > 0 && Number(p.to_plant_id) !== Number(p.plant_id)
  const { product, qtyCm, amount, outsourced, fields } = normalize(p, await plantUomFactors(p.plant_id))
  if (!outsourced) {
    const available = await finishedBalance(d, p.plant_id, product)
    if (qtyCm > available)
      throw new Error(
        `Not enough finished goods. Available ${product}: ${available} m³, requested: ${qtyCm} m³.`
      )
  }
  const id = await d.transaction(async () => {
    const toPlantId: number | null = interPlant ? Number(p.to_plant_id) : null
    const customerId = interPlant ? await ensureInternalCustomer(toPlantId!) : p.customer_id
    const no = await resolveInvoiceNo(d, p.dispatch_no)
    const info = await d
      .prepare(
        `INSERT INTO dispatches
          (dispatch_no, customer_id, plant_id, product_name, uom, quantity, qty_cm, sale_quantity, rate, buy_rate, amount,
           transport_charge, transport_billed, other_charge, other_billed,
           vehicle_no, vehicle_type, transporter_id, driver, challan_no, outsourced, outsource_id,
           delivery_status, dispatch_status, payment_status, paid_amount, to_plant_id, linked_purchase_id, date, remarks)
         VALUES (@dispatch_no,@customer_id,@plant_id,@product_name,@uom,@quantity,@qty_cm,@sale_quantity,@rate,@buy_rate,@amount,
           @transport_charge,@transport_billed,@other_charge,@other_billed,
           @vehicle_no,@vehicle_type,@transporter_id,@driver,@challan_no,@outsourced,@outsource_id,
           @delivery_status,@dispatch_status,@payment_status,@paid_amount,@to_plant_id,@linked_purchase_id,@date,@remarks)`
      )
      .run({
        dispatch_no: no,
        dispatch_status: 'pending',
        ...fields,
        customer_id: customerId,
        to_plant_id: toPlantId,
        linked_purchase_id: null
      })
    const dispatchId = Number(info.lastInsertRowid)
    await writeDispatchChildLines(d, dispatchId, p.transporters, p.machines)
    if (!outsourced) {
      await addMovement(d, {
        type: 'dispatch',
        material_type: 'finished',
        ref_no: no,
        plant_id: p.plant_id,
        product_name: product,
        change_qty: -qtyCm,
        date: p.date,
        note: interPlant ? `Inter-plant sale to ${await plantName(toPlantId!)}` : 'Direct sale to customer'
      })
      if ((await finishedBalance(d, p.plant_id, product)) < 0) throw new Error('Stock cannot go negative.')
    }
    if (interPlant) {
      const purchaseId = await createMirrorPurchase(p.plant_id, toPlantId!, dispatchId, product, qtyCm, amount, p.date)
      await d.prepare(`UPDATE dispatches SET linked_purchase_id=? WHERE id=?`).run(purchaseId, dispatchId)
    }
    return dispatchId
  })
  return (await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(id)) as Dispatch
}

export async function updateDispatch(p: DispatchInput): Promise<Dispatch> {
  const d = getDb()
  if (!p.id) throw new Error('Missing dispatch id.')
  const old = (await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(p.id)) as Dispatch
  if (!old) throw new Error('Dispatch not found.')
  const interPlant =
    p.to_plant_id != null && Number(p.to_plant_id) > 0 && Number(p.to_plant_id) !== Number(p.plant_id)
  const { product, qtyCm, amount, outsourced, fields } = normalize(p, await plantUomFactors(p.plant_id))
  await d.transaction(async () => {
    // Reverse any existing mirror purchase first (restores the destination plant's stock).
    if (old.linked_purchase_id) await removeLinkedPurchase(old.linked_purchase_id)
    const toPlantId: number | null = interPlant ? Number(p.to_plant_id) : null
    const customerId = interPlant ? await ensureInternalCustomer(toPlantId!) : p.customer_id
    // Invoice/voucher no may be edited; blank keeps the existing one.
    const wantedNo = (p.dispatch_no ?? '').trim()
    let newNo = old.dispatch_no
    if (wantedNo && wantedNo !== old.dispatch_no) {
      const dupe = (await d
        .prepare(`SELECT id FROM dispatches WHERE dispatch_no = ? AND id <> ?`)
        .get(wantedNo, p.id)) as { id: number } | undefined
      if (dupe) throw new Error(`Invoice number "${wantedNo}" is already used by another sale.`)
      newNo = wantedNo
    }
    await d.prepare(
      `UPDATE dispatches SET dispatch_no=@dispatch_no, customer_id=@customer_id, plant_id=@plant_id, product_name=@product_name,
        uom=@uom, quantity=@quantity, qty_cm=@qty_cm, sale_quantity=@sale_quantity, rate=@rate, buy_rate=@buy_rate, amount=@amount,
        transport_charge=@transport_charge, transport_billed=@transport_billed,
        other_charge=@other_charge, other_billed=@other_billed,
        vehicle_no=@vehicle_no, vehicle_type=@vehicle_type, transporter_id=@transporter_id, driver=@driver, challan_no=@challan_no,
        outsourced=@outsourced, outsource_id=@outsource_id, delivery_status=@delivery_status, payment_status=@payment_status, paid_amount=@paid_amount,
        to_plant_id=@to_plant_id, linked_purchase_id=NULL, date=@date, remarks=@remarks WHERE id=@id`
    ).run({ id: p.id, ...fields, dispatch_no: newNo, customer_id: customerId, to_plant_id: toPlantId })
    await writeDispatchChildLines(d, p.id!, p.transporters, p.machines)
    // Rebuild the stock movement to match the current outsourced flag (re-key to the new no).
    await d.prepare(`DELETE FROM stock_movements WHERE ref_no=? AND type='dispatch'`).run(old.dispatch_no)
    if (!outsourced) {
      await addMovement(d, {
        type: 'dispatch',
        material_type: 'finished',
        ref_no: newNo,
        plant_id: p.plant_id,
        product_name: product,
        change_qty: -qtyCm,
        date: p.date,
        note: interPlant ? `Inter-plant sale to ${await plantName(toPlantId!)}` : 'Direct sale to customer'
      })
      if ((await finishedBalance(d, old.plant_id, old.product_name)) < 0)
        throw new Error('Edit would make finished goods stock negative.')
      if ((await finishedBalance(d, p.plant_id, product)) < 0)
        throw new Error('Edit would make finished goods stock negative.')
    }
    if (interPlant) {
      const purchaseId = await createMirrorPurchase(p.plant_id, toPlantId!, p.id!, product, qtyCm, amount, p.date)
      await d.prepare(`UPDATE dispatches SET linked_purchase_id=? WHERE id=?`).run(purchaseId, p.id)
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
  // Re-derive payment status against the new billed total (goods + any billed charges).
  const billed =
    (amount ?? 0) +
    (row.transport_billed ? Number(row.transport_charge) || 0 : 0) +
    (row.other_billed ? Number(row.other_charge) || 0 : 0)
  const status = derivePaymentStatus(billed, Number(row.paid_amount) || 0)
  await d.transaction(async () => {
    await d.prepare(`UPDATE dispatches SET rate=?, amount=?, payment_status=? WHERE id=?`).run(payload.rate, amount, status, payload.id)
    // Keep the mirror purchase's cost in sync when a rate is set on an inter-plant sale.
    if (row.linked_purchase_id && amount != null && row.qty_cm > 0) {
      const ratePerCm = round2(amount / row.qty_cm)
      await d.prepare(`UPDATE purchases SET rate=?, amount=? WHERE id=?`).run(ratePerCm, amount, row.linked_purchase_id)
    }
  })
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

export async function setDispatch(payload: {
  id: number
  dispatch_status: DispatchStatus
}): Promise<Dispatch> {
  const d = getDb()
  const status = payload.dispatch_status === 'dispatched' ? 'dispatched' : 'pending'
  await d.prepare(`UPDATE dispatches SET dispatch_status=? WHERE id=?`).run(status, payload.id)
  return (await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(payload.id)) as Dispatch
}

export async function setPayment(payload: {
  id: number
  paid_amount: number
  payment_status?: PaymentStatus
}): Promise<Dispatch> {
  const d = getDb()
  const row = (await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(payload.id)) as Dispatch | undefined
  if (!row) throw new Error('Sale not found.')
  // Always derive status from the amount paid vs the billed total — never trust the client.
  const billed =
    (row.amount ?? 0) +
    (row.transport_billed ? Number(row.transport_charge) || 0 : 0) +
    (row.other_billed ? Number(row.other_charge) || 0 : 0)
  const paid = Number(payload.paid_amount) || 0
  await d.prepare(`UPDATE dispatches SET paid_amount=?, payment_status=? WHERE id=?`).run(
    paid,
    derivePaymentStatus(billed, paid),
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
  try {
    await d.transaction(async () => {
      // Reverse the mirror purchase first (and guard the destination plant's stock).
      if (old.linked_purchase_id) await removeLinkedPurchase(old.linked_purchase_id)
      await d.prepare(`DELETE FROM stock_movements WHERE ref_no=? AND type='dispatch'`).run(old.dispatch_no)
      await d.prepare(`DELETE FROM dispatch_transporters WHERE dispatch_id = ?`).run(payload.id)
      await d.prepare(`DELETE FROM dispatch_machines WHERE dispatch_id = ?`).run(payload.id)
      await d.prepare(`DELETE FROM dispatches WHERE id = ?`).run(payload.id)
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
