import { getDb } from '../db'
import type {
  PartyType,
  LedgerType,
  PaymentDirection,
  PaymentEntry,
  LedgerEntry,
  LedgerStatement,
  PartyBalance,
  DueRow,
  OpeningBalance
} from '@shared/types'
import { plantScopeSql } from './partyPlants'

const PARTY_TABLE: Record<PartyType, string> = {
  customer: 'customers',
  supplier: 'suppliers',
  transporter: 'transporters',
  outsource: 'outsource'
}

/** Ledger heads that accept payments (the base parties + fleet vehicles/JCBs). */
const PAYMENT_TABLES: Partial<Record<LedgerType, string>> = {
  customer: 'customers',
  supplier: 'suppliers',
  transporter: 'transporters',
  outsource: 'outsource',
  rack_vehicle: 'rack_vehicles',
  rack_jcb: 'rack_jcbs'
}

function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

async function partyName(partyType: LedgerType, partyId: number): Promise<string> {
  const d = getDb()
  if (partyType === 'rack') {
    const row = (await d.prepare(`SELECT rack_no AS name FROM racks WHERE id = ?`).get(partyId)) as
      | { name: string }
      | undefined
    if (!row) throw new Error('Rack not found.')
    return row.name
  }
  if (partyType === 'company') {
    const row = (await d.prepare(`SELECT name FROM companies WHERE id = ?`).get(partyId)) as
      | { name: string }
      | undefined
    if (!row) throw new Error('Company not found.')
    return row.name
  }
  if (partyType === 'plant') {
    const row = (await d.prepare(`SELECT name FROM plants WHERE id = ?`).get(partyId)) as
      | { name: string }
      | undefined
    if (!row) throw new Error('Plant not found.')
    return row.name
  }
  if (partyType === 'business') {
    const row = (await d.prepare(`SELECT name FROM businesses WHERE id = ?`).get(partyId)) as
      | { name: string }
      | undefined
    if (!row) throw new Error('Business not found.')
    return row.name
  }
  if (partyType === 'machine') {
    const row = (await d.prepare(`SELECT name FROM assets WHERE id = ?`).get(partyId)) as
      | { name: string }
      | undefined
    if (!row) throw new Error('Machine not found.')
    return row.name
  }
  if (partyType === 'rack_vehicle') {
    const row = (await d.prepare(`SELECT vehicle_no AS name FROM rack_vehicles WHERE id = ?`).get(partyId)) as
      | { name: string }
      | undefined
    if (!row) throw new Error('Vehicle not found.')
    return row.name
  }
  if (partyType === 'rack_jcb') {
    const row = (await d.prepare(`SELECT name FROM rack_jcbs WHERE id = ?`).get(partyId)) as
      | { name: string }
      | undefined
    if (!row) throw new Error('JCB not found.')
    return row.name
  }
  const table = PARTY_TABLE[partyType as PartyType]
  if (!table) throw new Error('Invalid party type.')
  const row = (await d.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(partyId)) as
    | { name: string }
    | undefined
  if (!row) throw new Error('Party not found.')
  return row.name
}

/** Gather the supplier/customer/transporter records linked to a company. */
async function companyLinks(companyId: number): Promise<{ type: PartyType; id: number }[]> {
  const d = getDb()
  const links: { type: PartyType; id: number }[] = []
  // Only these three have a company_id column.
  for (const type of ['customer', 'supplier', 'transporter'] as PartyType[]) {
    const rows = (await d
      .prepare(`SELECT id FROM ${PARTY_TABLE[type]} WHERE company_id = ?`)
      .all(companyId)) as {
      id: number
    }[]
    for (const r of rows) links.push({ type, id: r.id })
  }
  return links
}

/* ---------------- Payments ---------------- */

export interface PaymentInput {
  party_type: LedgerType
  party_id: number
  direction: PaymentDirection
  amount: number
  mode: string
  ref: string
  date: string
  remarks: string
}

export async function addPayment(p: PaymentInput): Promise<PaymentEntry> {
  const d = getDb()
  if (!PAYMENT_TABLES[p.party_type]) throw new Error('Invalid party type.')
  if (p.direction !== 'in' && p.direction !== 'out') throw new Error('Invalid payment direction.')
  if (!(Number(p.amount) > 0)) throw new Error('Amount must be greater than 0.')
  await partyName(p.party_type, p.party_id) // validates existence
  const info = await d
    .prepare(
      `INSERT INTO payments (party_type, party_id, direction, amount, mode, ref, date, remarks)
       VALUES (@party_type,@party_id,@direction,@amount,@mode,@ref,@date,@remarks)`
    )
    .run({
      party_type: p.party_type,
      party_id: p.party_id,
      direction: p.direction,
      amount: roundMoney(Number(p.amount)),
      mode: p.mode || 'cash',
      ref: p.ref ?? '',
      date: p.date,
      remarks: p.remarks ?? ''
    })
  return (await d
    .prepare(`SELECT * FROM payments WHERE id = ?`)
    .get(info.lastInsertRowid)) as PaymentEntry
}

export interface PaymentFilter {
  party_type?: PartyType
  party_id?: number
  from?: string
  to?: string
}

export async function listPayments(filter: PaymentFilter = {}): Promise<PaymentEntry[]> {
  const d = getDb()
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (filter.party_type) {
    where.push('pay.party_type = @party_type')
    params.party_type = filter.party_type
  }
  if (filter.party_id) {
    where.push('pay.party_id = @party_id')
    params.party_id = filter.party_id
  }
  if (filter.from) {
    where.push('pay.date >= @from')
    params.from = filter.from
  }
  if (filter.to) {
    where.push('pay.date <= @to')
    params.to = filter.to
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return (await d
    .prepare(
      `SELECT pay.*, COALESCE(c.name, s.name, t.name, o.name, rv.vehicle_no, rj.name) AS party_name
       FROM payments pay
       LEFT JOIN customers c ON pay.party_type='customer' AND c.id = pay.party_id
       LEFT JOIN suppliers s ON pay.party_type='supplier' AND s.id = pay.party_id
       LEFT JOIN transporters t ON pay.party_type='transporter' AND t.id = pay.party_id
       LEFT JOIN outsource o ON pay.party_type='outsource' AND o.id = pay.party_id
       LEFT JOIN rack_vehicles rv ON pay.party_type='rack_vehicle' AND rv.id = pay.party_id
       LEFT JOIN rack_jcbs rj ON pay.party_type='rack_jcb' AND rj.id = pay.party_id
       ${clause}
       ORDER BY pay.date DESC, pay.id DESC`
    )
    .all(params)) as PaymentEntry[]
}

export async function deletePayment(payload: { id: number }): Promise<{ ok: boolean }> {
  const d = getDb()
  await d.prepare(`DELETE FROM payments WHERE id = ?`).run(payload.id)
  return { ok: true }
}

/* ---------------- Ledger statements ---------------- */

interface RawEntry {
  date: string
  created_at: string
  particulars: string
  ref: string
  qty?: number
  uom?: string
  debit: number
  credit: number
  payment_id?: number
}

/**
 * Build the full ledger for a party (or a rack job account).
 * Customer:    debit = goods sold (dispatches + rack sales) and refunds paid out; credit = receipts.
 *              Positive balance = receivable from the customer.
 * Supplier:    credit = purchase bills (and money received from them); debit = payments made.
 *              Positive balance = payable to the supplier.
 * Transporter: credit = transport bills; debit = diesel given + payments made.
 *              Positive balance = payable to the transporter.
 * Rack:        debit = transport bills + rack expenses (costs); credit = rack sales (revenue).
 *              Positive balance = profit on the rack (excl. raw material cost).
 */
/** Party ledgers that support a manual opening balance. */
const OPENING_TYPES: LedgerType[] = ['customer', 'supplier', 'transporter', 'outsource', 'plant']

/** Synthetic 'Opening Balance' entries for a party. With no plant scope the full ledger shows
 *  every plant's opening (one line each); when a plant is active only that plant's rows (plus
 *  common, plant-unassigned ones) count — an opening tagged to plant A never leaks into plant B.
 *  A plant's own P&L opening (party_type='plant') is never filtered by the active plant. */
async function openingEntries(partyType: LedgerType, partyId: number, plantId?: number): Promise<RawEntry[]> {
  if (!OPENING_TYPES.includes(partyType)) return []
  const scopeByPlant = !!plantId && partyType !== 'plant'
  const params: Record<string, unknown> = { party_type: partyType, party_id: partyId }
  if (scopeByPlant) params.plant_id = plantId
  const rows = (await getDb()
    .prepare(
      `SELECT ob.amount, ob.direction, ob.as_of_date, p.name AS plant_name
       FROM opening_balances ob LEFT JOIN plants p ON p.id = ob.plant_id
       WHERE ob.party_type = @party_type AND ob.party_id = @party_id
       ${scopeByPlant ? 'AND (ob.plant_id = @plant_id OR ob.plant_id IS NULL)' : ''}`
    )
    .all(params)) as { amount: number; direction: string; as_of_date: string; plant_name: string | null }[]
  return rows
    .filter((r) => r.amount > 0)
    .map((r) => ({
      date: r.as_of_date || '1900-04-01',
      created_at: '',
      particulars: r.plant_name ? `Opening Balance — ${r.plant_name}` : 'Opening Balance',
      ref: 'OPENING',
      debit: r.direction === 'debit' ? roundMoney(r.amount) : 0,
      credit: r.direction === 'credit' ? roundMoney(r.amount) : 0
    }))
}

async function buildEntries(partyType: LedgerType, partyId: number, plantId?: number): Promise<RawEntry[]> {
  const d = getDb()
  const entries: RawEntry[] = []
  // Seed the manual opening balances (scoped to the active plant when one is given).
  entries.push(...(await openingEntries(partyType, partyId, plantId)))

  if (partyType === 'rack') {
    const loadings = (await d
      .prepare(
        `SELECT rl.loading_no, rl.date, rl.created_at, COALESCE(rl.amount,0) AS amount,
                rl.total_cm, rl.trips, t.name AS transporter_name
         FROM rack_loadings rl JOIN transporters t ON t.id = rl.transporter_id
         WHERE rl.rack_id = ?`
      )
      .all(partyId)) as {
      loading_no: string
      date: string
      created_at: string
      amount: number
      total_cm: number
      trips: number
      transporter_name: string
    }[]
    for (const x of loadings)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Transport — ${x.trips} trips, ${x.total_cm} m³ (${x.transporter_name})`,
          ref: x.loading_no,
          debit: x.amount,
          credit: 0
        })
    // Unloading charges (JCB / tipper at destination) — a rack cost.
    const runl = (await d
      .prepare(
        `SELECT ru.unloading_no, ru.date, ru.created_at, COALESCE(ru.amount,0) AS amount, ru.qty_cm,
                COALESCE(rv.vehicle_no, rj.name, t.name, 'Carrier') AS who
         FROM rack_unloadings ru
         LEFT JOIN rack_vehicles rv ON rv.id = ru.rack_vehicle_id
         LEFT JOIN rack_jcbs rj ON rj.id = ru.rack_jcb_id
         LEFT JOIN transporters t ON t.id = ru.transporter_id
         WHERE ru.rack_id = ?`
      )
      .all(partyId)) as { unloading_no: string; date: string; created_at: string; amount: number; qty_cm: number; who: string }[]
    for (const x of runl)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Unloading — ${x.qty_cm} m³ (${x.who})`,
          ref: x.unloading_no,
          debit: x.amount,
          credit: 0
        })
    const expenses = (await d
      .prepare(
        `SELECT expense_type, amount, date, created_at, remarks FROM rack_expenses WHERE rack_id = ?`
      )
      .all(partyId)) as {
      expense_type: string
      amount: number
      date: string
      created_at: string
      remarks: string
    }[]
    for (const x of expenses)
      entries.push({
        date: x.date,
        created_at: x.created_at,
        particulars: `Expense — ${x.expense_type}${x.remarks ? ` (${x.remarks})` : ''}`,
        ref: '',
        debit: x.amount,
        credit: 0
      })
    const sales = (await d
      .prepare(
        `SELECT rs.sale_no, rs.date, rs.created_at, COALESCE(rs.amount,0) AS amount,
                rs.product_name, rs.quantity, rs.uom, c.name AS customer_name
         FROM rack_sales rs JOIN customers c ON c.id = rs.customer_id
         WHERE rs.rack_id = ?`
      )
      .all(partyId)) as {
      sale_no: string
      date: string
      created_at: string
      amount: number
      product_name: string
      quantity: number
      uom: string
      customer_name: string
    }[]
    for (const x of sales)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Sale — ${x.product_name} (${x.quantity} ${x.uom}) to ${x.customer_name}`,
          ref: x.sale_no,
          debit: 0,
          credit: x.amount
        })
    // Transporter + machine cost lines on this rack's sales (rack costs → debit).
    const saleTrans = (await d
      .prepare(
        `SELECT rs.sale_no, rs.date, rs.created_at, COALESCE(rst.charge,0) AS charge,
                COALESCE(t.name, rv.vehicle_no, 'Carrier') AS tname
         FROM rack_sale_transporters rst JOIN rack_sales rs ON rs.id = rst.rack_sale_id
         LEFT JOIN transporters t ON t.id = rst.transporter_id
         LEFT JOIN rack_vehicles rv ON rv.id = rst.rack_vehicle_id
         WHERE rs.rack_id = ?`
      )
      .all(partyId)) as { sale_no: string; date: string; created_at: string; charge: number; tname: string }[]
    for (const x of saleTrans)
      if (x.charge > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Sale transport — ${x.tname}`,
          ref: x.sale_no,
          debit: x.charge,
          credit: 0
        })
    const saleMach = (await d
      .prepare(
        `SELECT rs.sale_no, rs.date, rs.created_at, COALESCE(rsm.amount,0) AS amount, a.name AS aname
         FROM rack_sale_machines rsm JOIN rack_sales rs ON rs.id = rsm.rack_sale_id
         JOIN assets a ON a.id = rsm.asset_id WHERE rs.rack_id = ?`
      )
      .all(partyId)) as { sale_no: string; date: string; created_at: string; amount: number; aname: string }[]
    for (const x of saleMach)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Machine — ${x.aname}`,
          ref: x.sale_no,
          debit: x.amount,
          credit: 0
        })
    entries.sort((a, b) =>
      a.date === b.date ? a.created_at.localeCompare(b.created_at) : a.date.localeCompare(b.date)
    )
    return entries
  }

  if (partyType === 'company') {
    const roleLabel: Record<PartyType, string> = {
      customer: 'Customer',
      supplier: 'Supplier',
      transporter: 'Transporter',
      outsource: 'Outsource'
    }
    for (const link of await companyLinks(partyId)) {
      for (const e of await buildEntries(link.type, link.id, plantId))
        entries.push({ ...e, particulars: `[${roleLabel[link.type]}] ${e.particulars}` })
    }
    entries.sort((a, b) =>
      a.date === b.date ? a.created_at.localeCompare(b.created_at) : a.date.localeCompare(b.date)
    )
    return entries
  }

  if (partyType === 'plant') {
    // Plant P&L: income (credit) = direct sales + attributed gross of closed racks;
    // costs (debit) = raw-material purchases + plant operating expenses.
    const sales = (await d
      .prepare(
        `SELECT dispatch_no, date, created_at, product_name, COALESCE(sale_quantity, quantity) AS quantity, uom,
          (COALESCE(amount,0)
            + CASE WHEN transport_billed=1 THEN transport_charge ELSE 0 END
            + CASE WHEN other_billed=1 THEN other_charge ELSE 0 END) AS billed
         FROM dispatches WHERE plant_id = ? AND amount IS NOT NULL`
      )
      .all(partyId)) as {
      dispatch_no: string
      date: string
      created_at: string
      product_name: string
      quantity: number
      uom: string
      billed: number
    }[]
    for (const x of sales)
      if (x.billed > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Direct sale — ${x.product_name} (${x.quantity} ${x.uom})`,
          ref: x.dispatch_no,
          debit: 0,
          credit: x.billed
        })

    const racks = (await d
      .prepare(
        `SELECT r.id, r.rack_no, r.date, r.created_at,
          (SELECT COALESCE(SUM(amount),0) FROM rack_sales WHERE rack_id=r.id)
            - (SELECT COALESCE(SUM(amount),0) FROM rack_loadings WHERE rack_id=r.id)
            - (SELECT COALESCE(SUM(amount),0) FROM rack_unloadings WHERE rack_id=r.id)
            - (SELECT COALESCE(SUM(amount),0) FROM rack_expenses WHERE rack_id=r.id)
            - (SELECT COALESCE(SUM(rst.charge),0) FROM rack_sale_transporters rst
                 JOIN rack_sales rs ON rs.id=rst.rack_sale_id WHERE rs.rack_id=r.id)
            - (SELECT COALESCE(SUM(rsm.amount),0) FROM rack_sale_machines rsm
                 JOIN rack_sales rs ON rs.id=rsm.rack_sale_id WHERE rs.rack_id=r.id) AS profit,
          (SELECT COALESCE(SUM(total_cm),0) FROM rack_loadings WHERE rack_id=r.id AND plant_id=@pid) AS plant_cm,
          (SELECT COALESCE(SUM(total_cm),0) FROM rack_loadings WHERE rack_id=r.id) AS total_cm
         FROM racks r
         WHERE r.status='closed'
           AND EXISTS (SELECT 1 FROM rack_loadings WHERE rack_id=r.id AND plant_id=@pid)`
      )
      .all({ pid: partyId })) as {
      rack_no: string
      date: string
      created_at: string
      profit: number
      plant_cm: number
      total_cm: number
    }[]
    for (const r of racks) {
      const share = r.total_cm > 0 ? r.plant_cm / r.total_cm : 0
      const attributed = r.profit * share
      if (Math.abs(attributed) < 0.005) continue
      entries.push({
        date: r.date,
        created_at: r.created_at,
        particulars: `Rack ${r.rack_no} gross${share < 0.999 ? ' (share)' : ''}`,
        ref: r.rack_no,
        debit: attributed < 0 ? -attributed : 0,
        credit: attributed > 0 ? attributed : 0
      })
    }

    const purchases = (await d
      .prepare(
        `SELECT purchase_no, date, created_at, COALESCE(amount,0) AS amount, quantity
         FROM purchases WHERE plant_id = ? AND amount IS NOT NULL`
      )
      .all(partyId)) as {
      purchase_no: string
      date: string
      created_at: string
      amount: number
      quantity: number
    }[]
    for (const x of purchases)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Raw material purchase (${x.quantity} m³)`,
          ref: x.purchase_no,
          debit: x.amount,
          credit: 0
        })

    const catLabel: Record<string, string> = {
      electricity: 'Electricity',
      maintenance: 'Maintenance',
      fixed: 'Fixed Cost',
      tipper_rent: 'Tipper Rent',
      equipment_rent: 'Equipment Rent',
      other: 'Other Expense'
    }
    const expenses = (await d
      .prepare(
        `SELECT expense_no, date, created_at, category, title, amount
         FROM plant_expenses WHERE plant_id = ?`
      )
      .all(partyId)) as {
      expense_no: string
      date: string
      created_at: string
      category: string
      title: string
      amount: number
    }[]
    for (const x of expenses)
      entries.push({
        date: x.date,
        created_at: x.created_at,
        particulars: `${catLabel[x.category] ?? 'Expense'}${x.title ? ` — ${x.title}` : ''}`,
        ref: x.expense_no,
        debit: x.amount,
        credit: 0
      })

    // Purchase transport + machine (mining/purchase) costs.
    const ptrans = (await d
      .prepare(
        `SELECT pu.purchase_no, pu.date, pu.created_at, COALESCE(pt.charge,0) AS charge, t.name AS tname
         FROM purchase_transporters pt JOIN purchases pu ON pu.id = pt.purchase_id
         JOIN transporters t ON t.id = pt.transporter_id WHERE pu.plant_id = ?`
      )
      .all(partyId)) as { purchase_no: string; date: string; created_at: string; charge: number; tname: string }[]
    for (const x of ptrans)
      if (x.charge > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Purchase transport — ${x.tname}`,
          ref: x.purchase_no,
          debit: x.charge,
          credit: 0
        })
    const pmach = (await d
      .prepare(
        `SELECT pu.purchase_no, pu.date, pu.created_at, COALESCE(pm.amount,0) AS amount, a.name AS aname
         FROM purchase_machines pm JOIN purchases pu ON pu.id = pm.purchase_id
         JOIN assets a ON a.id = pm.asset_id WHERE pu.plant_id = ?`
      )
      .all(partyId)) as { purchase_no: string; date: string; created_at: string; amount: number; aname: string }[]
    for (const x of pmach)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Machine — ${x.aname}`,
          ref: x.purchase_no,
          debit: x.amount,
          credit: 0
        })

    // Direct-sale transport + machine costs.
    const dtrans = (await d
      .prepare(
        `SELECT di.dispatch_no, di.date, di.created_at, COALESCE(dt.charge,0) AS charge, t.name AS tname
         FROM dispatch_transporters dt JOIN dispatches di ON di.id = dt.dispatch_id
         JOIN transporters t ON t.id = dt.transporter_id WHERE di.plant_id = ?`
      )
      .all(partyId)) as { dispatch_no: string; date: string; created_at: string; charge: number; tname: string }[]
    for (const x of dtrans)
      if (x.charge > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Sale transport — ${x.tname}`,
          ref: x.dispatch_no,
          debit: x.charge,
          credit: 0
        })
    const dmach = (await d
      .prepare(
        `SELECT di.dispatch_no, di.date, di.created_at, COALESCE(dm.amount,0) AS amount, a.name AS aname
         FROM dispatch_machines dm JOIN dispatches di ON di.id = dm.dispatch_id
         JOIN assets a ON a.id = dm.asset_id WHERE di.plant_id = ?`
      )
      .all(partyId)) as { dispatch_no: string; date: string; created_at: string; amount: number; aname: string }[]
    for (const x of dmach)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Machine — ${x.aname}`,
          ref: x.dispatch_no,
          debit: x.amount,
          credit: 0
        })

    const dieselCost = (await d
      .prepare(
        `SELECT purchase_no, date, created_at, COALESCE(amount,0) AS amount, litres
         FROM diesel_purchases WHERE plant_id = ?`
      )
      .all(partyId)) as {
      purchase_no: string
      date: string
      created_at: string
      amount: number
      litres: number
    }[]
    for (const x of dieselCost)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Diesel purchase (${x.litres} L)`,
          ref: x.purchase_no,
          debit: x.amount,
          credit: 0
        })

    const wages = (await d
      .prepare(
        `SELECT w.entry_no, w.date, w.created_at, w.amount, w.period, e.name AS emp
         FROM wage_entries w JOIN employees e ON e.id = w.employee_id
         WHERE w.plant_id = ?`
      )
      .all(partyId)) as {
      entry_no: string
      date: string
      created_at: string
      amount: number
      period: string
      emp: string
    }[]
    for (const x of wages)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Wages — ${x.emp} (${x.period})`,
          ref: x.entry_no,
          debit: x.amount,
          credit: 0
        })

    entries.sort((a, b) =>
      a.date === b.date ? a.created_at.localeCompare(b.created_at) : a.date.localeCompare(b.date)
    )
    return entries
  }

  if (partyType === 'business') {
    // P&L for one of the owner's firms: rent earned by its machines (income) minus
    // maintenance / other expenses / operator wages / diesel issued to those machines (cost).
    const assetIds = (
      (await d.prepare(`SELECT id FROM assets WHERE business_id = ?`).all(partyId)) as {
        id: number
      }[]
    ).map((a) => a.id)
    if (assetIds.length === 0) return entries
    const inC = assetIds.map(() => '?').join(',')
    const rents = (await d
      .prepare(
        `SELECT pe.expense_no, pe.date, pe.created_at, pe.amount, pe.category, a.name AS asset
         FROM plant_expenses pe JOIN assets a ON a.id = pe.asset_id
         WHERE pe.asset_id IN (${inC}) AND pe.category IN ('tipper_rent','equipment_rent')`
      )
      .all(...assetIds)) as {
      expense_no: string
      date: string
      created_at: string
      amount: number
      category: string
      asset: string
    }[]
    for (const x of rents)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Rent earned — ${x.asset}`,
          ref: x.expense_no,
          debit: 0,
          credit: x.amount
        })
    const costs = (await d
      .prepare(
        `SELECT pe.expense_no, pe.date, pe.created_at, pe.amount, pe.category, a.name AS asset
         FROM plant_expenses pe JOIN assets a ON a.id = pe.asset_id
         WHERE pe.asset_id IN (${inC}) AND pe.category NOT IN ('tipper_rent','equipment_rent')`
      )
      .all(...assetIds)) as {
      expense_no: string
      date: string
      created_at: string
      amount: number
      category: string
      asset: string
    }[]
    for (const x of costs)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `${x.category === 'maintenance' ? 'Maintenance' : 'Expense'} — ${x.asset}`,
          ref: x.expense_no,
          debit: x.amount,
          credit: 0
        })
    const wages = (await d
      .prepare(
        `SELECT w.entry_no, w.date, w.created_at, w.amount, e.name AS emp, a.name AS asset
         FROM wage_entries w JOIN employees e ON e.id = w.employee_id JOIN assets a ON a.id = w.asset_id
         WHERE w.asset_id IN (${inC})`
      )
      .all(...assetIds)) as {
      entry_no: string
      date: string
      created_at: string
      amount: number
      emp: string
      asset: string
    }[]
    for (const x of wages)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Operator wages — ${x.emp} (${x.asset})`,
          ref: x.entry_no,
          debit: x.amount,
          credit: 0
        })
    const avgRow = (await d
      .prepare(
        `SELECT COALESCE(SUM(amount),0) AS a, COALESCE(SUM(litres),0) AS l FROM diesel_purchases WHERE amount IS NOT NULL`
      )
      .get()) as { a: number; l: number }
    const avg = avgRow.l > 0 ? avgRow.a / avgRow.l : 0
    const diesel = (await d
      .prepare(
        `SELECT di.issue_no, di.date, di.created_at, di.litres, a.name AS asset
         FROM diesel_issues di JOIN assets a ON a.id = di.asset_id WHERE di.asset_id IN (${inC})`
      )
      .all(...assetIds)) as {
      issue_no: string
      date: string
      created_at: string
      litres: number
      asset: string
    }[]
    for (const x of diesel)
      if (x.litres > 0 && avg > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Diesel ${x.litres} L — ${x.asset}`,
          ref: x.issue_no,
          debit: roundMoney(x.litres * avg),
          credit: 0
        })
    entries.sort((a, b) =>
      a.date === b.date ? a.created_at.localeCompare(b.created_at) : a.date.localeCompare(b.date)
    )
    return entries
  }

  if (partyType === 'machine') {
    // Per-machine P&L: income = logbook run income + rent earned; cost = diesel, maintenance/other
    // expenses, operator wages. (Parts + scrap income are added with the parts module.)
    const mcatLabel: Record<string, string> = {
      electricity: 'Electricity',
      maintenance: 'Maintenance',
      fixed: 'Fixed Expense',
      other: 'Other Expense'
    }
    const logs = (await d
      .prepare(
        `SELECT date, created_at, work_type, usage_qty, COALESCE(amount,0) AS amount
         FROM machine_logs WHERE asset_id = ? AND amount IS NOT NULL`
      )
      .all(partyId)) as { date: string; created_at: string; work_type: string; usage_qty: number; amount: number }[]
    for (const x of logs)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Run income — ${x.work_type || 'usage'} (${x.usage_qty})`,
          ref: '',
          debit: 0,
          credit: x.amount
        })
    const pexp = (await d
      .prepare(
        `SELECT expense_no, date, created_at, COALESCE(amount,0) AS amount, category
         FROM plant_expenses WHERE asset_id = ?`
      )
      .all(partyId)) as { expense_no: string; date: string; created_at: string; amount: number; category: string }[]
    for (const x of pexp) {
      if (!(x.amount > 0)) continue
      const isRent = x.category === 'tipper_rent' || x.category === 'equipment_rent'
      entries.push({
        date: x.date,
        created_at: x.created_at,
        particulars: isRent ? 'Rent earned' : (mcatLabel[x.category] ?? 'Expense'),
        ref: x.expense_no,
        debit: isRent ? 0 : x.amount,
        credit: isRent ? x.amount : 0
      })
    }
    const wages = (await d
      .prepare(
        `SELECT w.entry_no, w.date, w.created_at, COALESCE(w.amount,0) AS amount, e.name AS emp, w.period
         FROM wage_entries w JOIN employees e ON e.id = w.employee_id WHERE w.asset_id = ?`
      )
      .all(partyId)) as { entry_no: string; date: string; created_at: string; amount: number; emp: string; period: string }[]
    for (const x of wages)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Operator wages — ${x.emp} (${x.period})`,
          ref: x.entry_no,
          debit: x.amount,
          credit: 0
        })
    const avgRow = (await d
      .prepare(`SELECT COALESCE(SUM(amount),0) AS a, COALESCE(SUM(litres),0) AS l FROM diesel_purchases WHERE amount IS NOT NULL`)
      .get()) as { a: number; l: number }
    const avg = avgRow.l > 0 ? avgRow.a / avgRow.l : 0
    const diesel = (await d
      .prepare(`SELECT issue_no, date, created_at, litres FROM diesel_issues WHERE asset_id = ?`)
      .all(partyId)) as { issue_no: string; date: string; created_at: string; litres: number }[]
    for (const x of diesel)
      if (x.litres > 0 && avg > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Diesel ${x.litres} L`,
          ref: x.issue_no,
          debit: roundMoney(x.litres * avg),
          credit: 0
        })
    entries.sort((a, b) =>
      a.date === b.date ? a.created_at.localeCompare(b.created_at) : a.date.localeCompare(b.date)
    )
    return entries
  }

  if (partyType === 'outsource') {
    // Expenses attributed to the outsource vendor are payable to them; settlements come via payments.
    const exp = (await d
      .prepare(
        `SELECT expense_no, date, created_at, category, amount, paid_amount
         FROM plant_expenses WHERE outsource_id = ?`
      )
      .all(partyId)) as {
      expense_no: string
      date: string
      created_at: string
      category: string
      amount: number
      paid_amount: number
    }[]
    for (const x of exp) {
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Outsourced — ${x.category}`,
          ref: x.expense_no,
          debit: 0,
          credit: x.amount
        })
      if (x.paid_amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Paid against bill`,
          ref: x.expense_no,
          debit: x.paid_amount,
          credit: 0
        })
    }
    // Machine-usage lines on purchases hired from this vendor — payable.
    const mach = (await d
      .prepare(
        `SELECT pu.purchase_no, pu.date, pu.created_at, COALESCE(pm.amount,0) AS amount, a.name AS aname
         FROM purchase_machines pm JOIN purchases pu ON pu.id = pm.purchase_id
         JOIN assets a ON a.id = pm.asset_id WHERE pm.outsource_id = ?`
      )
      .all(partyId)) as { purchase_no: string; date: string; created_at: string; amount: number; aname: string }[]
    for (const x of mach)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Machine hire — ${x.aname}`,
          ref: x.purchase_no,
          debit: 0,
          credit: x.amount
        })
    // Machine-usage lines on direct sales hired from this vendor — payable.
    const dmach = (await d
      .prepare(
        `SELECT di.dispatch_no, di.date, di.created_at, COALESCE(dm.amount,0) AS amount, a.name AS aname
         FROM dispatch_machines dm JOIN dispatches di ON di.id = dm.dispatch_id
         JOIN assets a ON a.id = dm.asset_id WHERE dm.outsource_id = ?`
      )
      .all(partyId)) as { dispatch_no: string; date: string; created_at: string; amount: number; aname: string }[]
    for (const x of dmach)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Machine hire — ${x.aname}`,
          ref: x.dispatch_no,
          debit: 0,
          credit: x.amount
        })
    // Machine-usage lines on rack sales hired from this vendor — payable.
    const rsmach = (await d
      .prepare(
        `SELECT rs.sale_no, rs.date, rs.created_at, COALESCE(rsm.amount,0) AS amount, a.name AS aname
         FROM rack_sale_machines rsm JOIN rack_sales rs ON rs.id = rsm.rack_sale_id
         JOIN assets a ON a.id = rsm.asset_id WHERE rsm.outsource_id = ?`
      )
      .all(partyId)) as { sale_no: string; date: string; created_at: string; amount: number; aname: string }[]
    for (const x of rsmach)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Machine hire — ${x.aname}`,
          ref: x.sale_no,
          debit: 0,
          credit: x.amount
        })
    // Outsourced direct sales bought from this vendor — what we owe them for the goods (payable).
    const osale = (await d
      .prepare(
        `SELECT dispatch_no, date, created_at, product_name, uom,
                COALESCE(sale_quantity, quantity) AS qty,
                ROUND(COALESCE(buy_rate,0) * COALESCE(sale_quantity, quantity), 2) AS amount
         FROM dispatches
         WHERE outsourced = 1 AND outsource_id = ? AND COALESCE(buy_rate,0) > 0`
      )
      .all(partyId)) as {
      dispatch_no: string
      date: string
      created_at: string
      product_name: string
      uom: string
      qty: number
      amount: number
    }[]
    for (const x of osale)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Outsourced supply — ${x.product_name}`,
          ref: x.dispatch_no,
          qty: x.qty,
          uom: x.uom,
          debit: 0,
          credit: x.amount
        })
  }

  if (partyType === 'customer') {
    const dispatches = (await d
      .prepare(
        `SELECT dispatch_no, date, created_at, product_name, COALESCE(sale_quantity, quantity) AS quantity, uom,
          rate, COALESCE(vehicle_no,'') AS vehicle_no, COALESCE(challan_no,'') AS challan_no,
          COALESCE(amount,0) AS goods,
          CASE WHEN transport_billed=1 THEN COALESCE(transport_charge,0) ELSE 0 END AS transport,
          CASE WHEN other_billed=1 THEN COALESCE(other_charge,0) ELSE 0 END AS other,
          (COALESCE(amount,0)
            + CASE WHEN transport_billed=1 THEN transport_charge ELSE 0 END
            + CASE WHEN other_billed=1 THEN other_charge ELSE 0 END) AS billed,
          paid_amount
         FROM dispatches WHERE customer_id = ?`
      )
      .all(partyId)) as {
      dispatch_no: string
      date: string
      created_at: string
      product_name: string
      quantity: number
      uom: string
      rate: number | null
      vehicle_no: string
      challan_no: string
      goods: number
      transport: number
      other: number
      billed: number
      paid_amount: number
    }[]
    const uomLabel = (u: string): string => (u === 'CM' ? 'm³' : u === 'TON' ? 'Ton' : u === 'CFT' ? 'CFT' : u)
    for (const x of dispatches) {
      if (x.billed > 0) {
        // A rich, professional line: product, rate/unit, vehicle, challan and any billed extras.
        const bits = [`Direct sale — ${x.product_name}`]
        if (x.rate != null) bits.push(`@ ${roundMoney(x.rate)}/${uomLabel(x.uom)}`)
        if (x.vehicle_no) bits.push(`Veh ${x.vehicle_no}`)
        if (x.challan_no) bits.push(`Challan ${x.challan_no}`)
        if (x.transport > 0) bits.push(`+ transport ${roundMoney(x.transport)}`)
        if (x.other > 0) bits.push(`+ other ${roundMoney(x.other)}`)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: bits.join(' · '),
          ref: x.dispatch_no,
          qty: x.quantity,
          uom: x.uom,
          debit: x.billed,
          credit: 0
        })
      }
      if (x.paid_amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Received against sale`,
          ref: x.dispatch_no,
          debit: 0,
          credit: x.paid_amount
        })
    }
    const sales = (await d
      .prepare(
        `SELECT rs.sale_no, rs.date, rs.created_at, COALESCE(rs.amount,0) AS amount,
                rs.product_name, rs.quantity, rs.uom, r.rack_no
         FROM rack_sales rs JOIN racks r ON r.id = rs.rack_id
         WHERE rs.customer_id = ? AND rs.amount IS NOT NULL`
      )
      .all(partyId)) as {
      sale_no: string
      date: string
      created_at: string
      amount: number
      product_name: string
      quantity: number
      uom: string
      rack_no: string
    }[]
    for (const x of sales)
      entries.push({
        date: x.date,
        created_at: x.created_at,
        particulars: `Rack sale — ${x.product_name} · Rack ${x.rack_no}`,
        ref: x.sale_no,
        qty: x.quantity,
        uom: x.uom,
        debit: x.amount,
        credit: 0
      })
  }

  if (partyType === 'supplier') {
    const purchases = (await d
      .prepare(
        `SELECT purchase_no, date, created_at, COALESCE(amount,0) AS amount, paid_amount, quantity, uom,
                COALESCE(material_type,'raw') AS material_type, product_name
         FROM purchases WHERE supplier_id = ?`
      )
      .all(partyId)) as {
      purchase_no: string
      date: string
      created_at: string
      amount: number
      paid_amount: number
      quantity: number
      uom: string
      material_type: string
      product_name: string | null
    }[]
    for (const x of purchases) {
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Purchase — ${x.material_type === 'finished' && x.product_name ? x.product_name : 'raw material'}`,
          ref: x.purchase_no,
          qty: x.quantity,
          uom: x.uom,
          debit: 0,
          credit: x.amount
        })
      if (x.paid_amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Paid against bill`,
          ref: x.purchase_no,
          debit: x.paid_amount,
          credit: 0
        })
    }
    const diesel = (await d
      .prepare(
        `SELECT purchase_no, date, created_at, COALESCE(amount,0) AS amount, paid_amount, litres
         FROM diesel_purchases WHERE supplier_id = ?`
      )
      .all(partyId)) as {
      purchase_no: string
      date: string
      created_at: string
      amount: number
      paid_amount: number
      litres: number
    }[]
    for (const x of diesel) {
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Diesel purchase`,
          ref: x.purchase_no,
          qty: x.litres,
          uom: 'L',
          debit: 0,
          credit: x.amount
        })
      if (x.paid_amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Paid against diesel bill`,
          ref: x.purchase_no,
          debit: x.paid_amount,
          credit: 0
        })
    }
  }

  if (partyType === 'transporter') {
    const loadings = (await d
      .prepare(
        `SELECT rl.loading_no, rl.date, rl.created_at, COALESCE(rl.amount,0) AS amount,
                COALESCE(rl.diesel_amount,0) AS diesel, COALESCE(rl.diesel_charged,0) AS diesel_charged, rl.total_cm, rl.trips, r.rack_no
         FROM rack_loadings rl JOIN racks r ON r.id = rl.rack_id
         WHERE rl.transporter_id = ?`
      )
      .all(partyId)) as {
      loading_no: string
      date: string
      created_at: string
      amount: number
      diesel: number
      diesel_charged: number
      total_cm: number
      trips: number
      rack_no: string
    }[]
    for (const x of loadings) {
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Transport — ${x.trips} trips, ${x.total_cm} m³ · Rack ${x.rack_no}`,
          ref: x.loading_no,
          debit: 0,
          credit: x.amount
        })
      if (x.diesel > 0 && x.diesel_charged)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Diesel issued (deduction)`,
          ref: x.loading_no,
          debit: x.diesel,
          credit: 0
        })
    }
    const unloadings = (await d
      .prepare(
        `SELECT ru.unloading_no, ru.date, ru.created_at, COALESCE(ru.amount,0) AS amount,
                COALESCE(ru.diesel_amount,0) AS diesel, COALESCE(ru.diesel_charged,0) AS diesel_charged, ru.total_cm, ru.trips, r.rack_no
         FROM rack_unloadings ru JOIN racks r ON r.id = ru.rack_id
         WHERE ru.transporter_id = ?`
      )
      .all(partyId)) as {
      unloading_no: string
      date: string
      created_at: string
      amount: number
      diesel: number
      diesel_charged: number
      total_cm: number
      trips: number
      rack_no: string
    }[]
    for (const x of unloadings) {
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Unloading transport — ${x.trips} trips, ${x.total_cm} m³ · Rack ${x.rack_no}`,
          ref: x.unloading_no,
          debit: 0,
          credit: x.amount
        })
      if (x.diesel > 0 && x.diesel_charged)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Diesel issued (deduction)`,
          ref: x.unloading_no,
          debit: x.diesel,
          credit: 0
        })
    }
    // Transport charges from direct sales carried by this transporter (payable).
    const sales = (await d
      .prepare(
        `SELECT dispatch_no, date, created_at, product_name, COALESCE(transport_charge,0) AS charge
         FROM dispatches WHERE transporter_id = ? AND COALESCE(transport_charge,0) > 0`
      )
      .all(partyId)) as {
      dispatch_no: string
      date: string
      created_at: string
      product_name: string
      charge: number
    }[]
    for (const x of sales)
      entries.push({
        date: x.date,
        created_at: x.created_at,
        particulars: `Transport — direct sale ${x.product_name}`,
        ref: x.dispatch_no,
        debit: 0,
        credit: x.charge
      })
    // Transport charged on purchases (bringing material in) — payable.
    const pin = (await d
      .prepare(
        `SELECT pu.purchase_no, pu.date, pu.created_at, COALESCE(pt.charge,0) AS charge, COALESCE(pt.vehicle_no,'') AS vno
         FROM purchase_transporters pt JOIN purchases pu ON pu.id = pt.purchase_id
         WHERE pt.transporter_id = ?`
      )
      .all(partyId)) as { purchase_no: string; date: string; created_at: string; charge: number; vno: string }[]
    for (const x of pin)
      if (x.charge > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Transport — purchase inward${x.vno ? ` (${x.vno})` : ''}`,
          ref: x.purchase_no,
          debit: 0,
          credit: x.charge
        })
    // Transporter cost lines on direct sales — payable.
    const dtin = (await d
      .prepare(
        `SELECT di.dispatch_no, di.date, di.created_at, COALESCE(dt.charge,0) AS charge, COALESCE(dt.vehicle_no,'') AS vno
         FROM dispatch_transporters dt JOIN dispatches di ON di.id = dt.dispatch_id
         WHERE dt.transporter_id = ?`
      )
      .all(partyId)) as { dispatch_no: string; date: string; created_at: string; charge: number; vno: string }[]
    for (const x of dtin)
      if (x.charge > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Transport — direct sale${x.vno ? ` (${x.vno})` : ''}`,
          ref: x.dispatch_no,
          debit: 0,
          credit: x.charge
        })
    // Transporter cost lines on rack sales — payable; sale-time diesel charged is recovered (debit).
    const rstin = (await d
      .prepare(
        `SELECT rs.sale_no, rs.date, rs.created_at, COALESCE(rst.charge,0) AS charge, COALESCE(rst.vehicle_no,'') AS vno,
                COALESCE(rst.diesel_amount,0) AS diesel, COALESCE(rst.diesel_charged,0) AS diesel_charged
         FROM rack_sale_transporters rst JOIN rack_sales rs ON rs.id = rst.rack_sale_id
         WHERE rst.transporter_id = ?`
      )
      .all(partyId)) as {
      sale_no: string; date: string; created_at: string; charge: number; vno: string; diesel: number; diesel_charged: number
    }[]
    for (const x of rstin) {
      if (x.charge > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Transport — rack sale${x.vno ? ` (${x.vno})` : ''}`,
          ref: x.sale_no,
          debit: 0,
          credit: x.charge
        })
      if (x.diesel > 0 && x.diesel_charged)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Diesel issued (deduction)`,
          ref: x.sale_no,
          debit: x.diesel,
          credit: 0
        })
    }
    // Diesel issued and charged to this transporter — recovered from what we owe (debit).
    const dsl = (await d
      .prepare(
        `SELECT issue_no, date, created_at, COALESCE(litres,0) AS litres, COALESCE(amount,0) AS amount
         FROM diesel_issues WHERE transporter_id = ? AND charged = 1 AND COALESCE(amount,0) > 0`
      )
      .all(partyId)) as {
      issue_no: string
      date: string
      created_at: string
      litres: number
      amount: number
    }[]
    for (const x of dsl)
      entries.push({
        date: x.date,
        created_at: x.created_at,
        particulars: `Diesel issued — ${x.litres} L`,
        ref: x.issue_no,
        debit: x.amount,
        credit: 0
      })
  }

  if (partyType === 'rack_vehicle') {
    // Unloading work this tipper did at the destination — payable to it.
    const unl = (await d
      .prepare(
        `SELECT ru.unloading_no, ru.date, ru.created_at, COALESCE(ru.amount,0) AS amount,
                COALESCE(ru.diesel_amount,0) AS diesel, COALESCE(ru.diesel_charged,0) AS diesel_charged,
                ru.qty_cm, ru.trips, r.rack_no
         FROM rack_unloadings ru JOIN racks r ON r.id = ru.rack_id WHERE ru.rack_vehicle_id = ?`
      )
      .all(partyId)) as {
      unloading_no: string; date: string; created_at: string; amount: number; diesel: number
      diesel_charged: number; qty_cm: number; trips: number; rack_no: string
    }[]
    for (const x of unl) {
      if (x.amount > 0)
        entries.push({
          date: x.date, created_at: x.created_at,
          particulars: `Unloading — ${x.trips} trips, ${x.qty_cm} m³ · Rack ${x.rack_no}`,
          ref: x.unloading_no, debit: 0, credit: x.amount
        })
      if (x.diesel > 0 && x.diesel_charged)
        entries.push({ date: x.date, created_at: x.created_at, particulars: `Diesel issued (deduction)`, ref: x.unloading_no, debit: x.diesel, credit: 0 })
    }
    // Transport this tipper did at sale time — payable to it.
    const st = (await d
      .prepare(
        `SELECT rs.sale_no, rs.date, rs.created_at, COALESCE(rst.charge,0) AS charge,
                COALESCE(rst.diesel_amount,0) AS diesel, COALESCE(rst.diesel_charged,0) AS diesel_charged, r.rack_no
         FROM rack_sale_transporters rst JOIN rack_sales rs ON rs.id = rst.rack_sale_id
         JOIN racks r ON r.id = rs.rack_id WHERE rst.rack_vehicle_id = ?`
      )
      .all(partyId)) as {
      sale_no: string; date: string; created_at: string; charge: number; diesel: number; diesel_charged: number; rack_no: string
    }[]
    for (const x of st) {
      if (x.charge > 0)
        entries.push({
          date: x.date, created_at: x.created_at,
          particulars: `Sale transport · Rack ${x.rack_no}`, ref: x.sale_no, debit: 0, credit: x.charge
        })
      if (x.diesel > 0 && x.diesel_charged)
        entries.push({ date: x.date, created_at: x.created_at, particulars: `Diesel issued (deduction)`, ref: x.sale_no, debit: x.diesel, credit: 0 })
    }
  }

  if (partyType === 'rack_jcb') {
    const wLabel: Record<string, string> = { unloading: 'unloading (per wagon)', loading: 'loading (per tipper)', other: 'other work (per hour)' }
    const unl = (await d
      .prepare(
        `SELECT ru.unloading_no, ru.date, ru.created_at, COALESCE(ru.amount,0) AS amount,
                COALESCE(ru.diesel_amount,0) AS diesel, COALESCE(ru.diesel_charged,0) AS diesel_charged,
                ru.qty_cm, ru.trips, ru.work_type, r.rack_no
         FROM rack_unloadings ru JOIN racks r ON r.id = ru.rack_id WHERE ru.rack_jcb_id = ?`
      )
      .all(partyId)) as {
      unloading_no: string; date: string; created_at: string; amount: number; diesel: number
      diesel_charged: number; qty_cm: number; trips: number; work_type: string | null; rack_no: string
    }[]
    for (const x of unl) {
      if (x.amount > 0)
        entries.push({
          date: x.date, created_at: x.created_at,
          particulars: `JCB ${wLabel[x.work_type ?? 'unloading'] ?? 'work'} — ${x.trips} · Rack ${x.rack_no}`,
          ref: x.unloading_no, debit: 0, credit: x.amount
        })
      if (x.diesel > 0 && x.diesel_charged)
        entries.push({ date: x.date, created_at: x.created_at, particulars: `Diesel issued (deduction)`, ref: x.unloading_no, debit: x.diesel, credit: 0 })
    }
  }

  const payments = (await getDb()
    .prepare(`SELECT * FROM payments WHERE party_type = ? AND party_id = ?`)
    .all(partyType, partyId)) as PaymentEntry[]
  for (const p of payments) {
    const received = p.direction === 'in'
    // Money received: credit for customers (receipt), credit for supplier/transporter (refund).
    entries.push({
      date: p.date,
      created_at: p.created_at,
      particulars:
        (received ? 'Payment received' : 'Payment made') +
        (p.mode ? ` (${p.mode})` : '') +
        (p.remarks ? ` — ${p.remarks}` : ''),
      ref: p.ref || `PAY-${p.id}`,
      debit: received ? 0 : p.amount,
      credit: received ? p.amount : 0,
      payment_id: p.id
    })
  }

  entries.sort((a, b) =>
    a.date === b.date ? a.created_at.localeCompare(b.created_at) : a.date.localeCompare(b.date)
  )
  return entries
}

function runningSign(partyType: LedgerType): 1 | -1 {
  // Customer/company balance grows with debits (net receivable); supplier/transporter with credits
  // (payable); rack with credits (sales revenue minus costs = profit).
  return partyType === 'customer' || partyType === 'company' ? 1 : -1
}

export async function getLedger(payload: {
  party_type: LedgerType
  party_id: number
  /** Active plant: scopes opening balances to that plant (+ common) so a plant-tagged
   *  opening never shows under another plant. Omit for the combined, all-plants account. */
  plant_id?: number
  from?: string
  to?: string
}): Promise<LedgerStatement> {
  const name = await partyName(payload.party_type, payload.party_id)
  const all = await buildEntries(payload.party_type, payload.party_id, payload.plant_id)
  const sign = runningSign(payload.party_type)

  let opening = 0
  let visible = all
  if (payload.from) {
    const before = all.filter((e) => e.date < payload.from!)
    opening = before.reduce((acc, e) => acc + sign * (e.debit - e.credit), 0)
    visible = all.filter((e) => e.date >= payload.from!)
  }
  if (payload.to) visible = visible.filter((e) => e.date <= payload.to!)

  const entries: LedgerEntry[] = []
  let bal = opening
  if (payload.from) {
    entries.push({
      date: payload.from,
      particulars: 'Opening Balance b/f',
      ref: '',
      debit: 0,
      credit: 0,
      balance: roundMoney(opening)
    })
  }
  let totalDebit = 0
  let totalCredit = 0
  for (const e of visible) {
    bal += sign * (e.debit - e.credit)
    totalDebit += e.debit
    totalCredit += e.credit
    entries.push({
      date: e.date,
      particulars: e.particulars,
      ref: e.ref,
      qty: e.qty,
      uom: e.uom,
      debit: roundMoney(e.debit),
      credit: roundMoney(e.credit),
      balance: roundMoney(bal),
      payment_id: e.payment_id
    })
  }

  // A plant statement also carries its outstanding receivable/payable and the
  // manual opening carry-forward, shown as a summary above the P&L lines.
  let extra: { opening?: number; receivable?: number; payable?: number } = {}
  if (payload.party_type === 'plant') {
    const rp = await plantReceivablePayable(payload.party_id)
    extra = { opening: await plantOpeningNet(payload.party_id, sign), receivable: rp.receivable, payable: rp.payable }
  }

  return {
    party_type: payload.party_type,
    party_id: payload.party_id,
    party_name: name,
    entries,
    total_debit: roundMoney(totalDebit),
    total_credit: roundMoney(totalCredit),
    closing: roundMoney(bal),
    ...extra
  }
}

/** A plant's outstanding receivable (unpaid sales + customer openings tagged to it) and
 *  payable (unpaid supplier/diesel/outsource bills + their openings tagged to it). */
async function plantReceivablePayable(plantId: number): Promise<{ receivable: number; payable: number }> {
  const d = getDb()
  const r = (await d
    .prepare(
      `SELECT COALESCE(SUM(
          (COALESCE(amount,0)
           + CASE WHEN transport_billed=1 THEN transport_charge ELSE 0 END
           + CASE WHEN other_billed=1 THEN other_charge ELSE 0 END)
          - COALESCE(paid_amount,0)),0)
        + (SELECT COALESCE(SUM(CASE WHEN direction='debit' THEN amount ELSE -amount END),0)
             FROM opening_balances WHERE party_type='customer' AND plant_id=@pid) AS q
       FROM dispatches WHERE plant_id = @pid AND to_plant_id IS NULL`
    )
    .get({ pid: plantId })) as { q: number }
  const p = (await d
    .prepare(
      `SELECT
        (SELECT COALESCE(SUM(COALESCE(amount,0)-COALESCE(paid_amount,0)),0)
           FROM purchases WHERE plant_id=@pid AND linked_dispatch_id IS NULL) +
        (SELECT COALESCE(SUM(COALESCE(amount,0)-COALESCE(paid_amount,0)),0)
           FROM diesel_purchases WHERE plant_id=@pid) +
        (SELECT COALESCE(SUM(COALESCE(amount,0)-COALESCE(paid_amount,0)),0)
           FROM plant_expenses WHERE plant_id=@pid AND outsource_id IS NOT NULL) +
        (SELECT COALESCE(SUM(ROUND(COALESCE(buy_rate,0)*COALESCE(sale_quantity,quantity),2)),0)
           FROM dispatches WHERE plant_id=@pid AND outsourced=1 AND outsource_id IS NOT NULL AND to_plant_id IS NULL) +
        (SELECT COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END),0)
           FROM opening_balances WHERE party_type IN ('supplier','transporter','outsource') AND plant_id=@pid) AS q`
    )
    .get({ pid: plantId })) as { q: number }
  return { receivable: roundMoney(r.q), payable: roundMoney(p.q) }
}

/** The plant's manual opening balance, sign-adjusted (profit positive). */
async function plantOpeningNet(plantId: number, sign: 1 | -1): Promise<number> {
  const row = (await getDb()
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN direction='debit' THEN amount ELSE -amount END),0) AS net
       FROM opening_balances WHERE party_type='plant' AND party_id=?`
    )
    .get(plantId)) as { net: number }
  return roundMoney(sign * (Number(row.net) || 0))
}

export async function getPartyBalances(payload: {
  party_type: LedgerType
  plant_id?: number
}): Promise<PartyBalance[]> {
  const d = getDb()
  let parties: { id: number; name: string }[]
  if (payload.party_type === 'rack') {
    parties = (await d
      .prepare(`SELECT id, rack_no AS name FROM racks ORDER BY date DESC, id DESC`)
      .all()) as { id: number; name: string }[]
  } else if (payload.party_type === 'company') {
    parties = (await d.prepare(`SELECT id, name FROM companies ORDER BY name`).all()) as {
      id: number
      name: string
    }[]
  } else if (payload.party_type === 'plant') {
    parties = (await d.prepare(`SELECT id, name FROM plants ORDER BY name`).all()) as {
      id: number
      name: string
    }[]
  } else if (payload.party_type === 'business') {
    parties = (await d.prepare(`SELECT id, name FROM businesses ORDER BY name`).all()) as {
      id: number
      name: string
    }[]
  } else if (payload.party_type === 'outsource') {
    parties = (await d.prepare(`SELECT id, name FROM outsource ORDER BY name`).all()) as {
      id: number
      name: string
    }[]
  } else if (payload.party_type === 'rack_vehicle') {
    const clause = payload.plant_id ? `WHERE ${plantScopeSql('t', 'rack_vehicle')}` : ''
    parties = (await d
      .prepare(`SELECT t.id, t.vehicle_no AS name FROM rack_vehicles t ${clause} ORDER BY t.vehicle_no`)
      .all(payload.plant_id ? { plant_id: payload.plant_id } : {})) as { id: number; name: string }[]
  } else if (payload.party_type === 'rack_jcb') {
    const clause = payload.plant_id ? `WHERE ${plantScopeSql('t', 'rack_jcb')}` : ''
    parties = (await d
      .prepare(`SELECT t.id, t.name FROM rack_jcbs t ${clause} ORDER BY t.name`)
      .all(payload.plant_id ? { plant_id: payload.plant_id } : {})) as { id: number; name: string }[]
  } else if (payload.party_type === 'machine') {
    // Machines available at the plant (or shared everywhere when unassigned).
    const clause = payload.plant_id
      ? `WHERE EXISTS (SELECT 1 FROM asset_plants ap WHERE ap.asset_id = a.id AND ap.plant_id = @plant_id)
           OR NOT EXISTS (SELECT 1 FROM asset_plants ap2 WHERE ap2.asset_id = a.id)`
      : ''
    parties = (await d
      .prepare(`SELECT a.id, a.name FROM assets a ${clause} ORDER BY a.asset_type, a.name`)
      .all(payload.plant_id ? { plant_id: payload.plant_id } : {})) as { id: number; name: string }[]
  } else {
    const table = PARTY_TABLE[payload.party_type as PartyType]
    if (!table) throw new Error('Invalid party type.')
    // Plant filter returns common parties (no plants assigned) plus those assigned to it.
    const clause = payload.plant_id ? `WHERE ${plantScopeSql('t', payload.party_type as string)}` : ''
    parties = (await d
      .prepare(`SELECT t.id, t.name FROM ${table} t ${clause} ORDER BY t.name`)
      .all(payload.plant_id ? { plant_id: payload.plant_id } : {})) as {
      id: number
      name: string
    }[]
  }
  const sign = runningSign(payload.party_type)
  const result: PartyBalance[] = []
  for (const p of parties) {
    const entries = await buildEntries(payload.party_type, p.id, payload.plant_id)
    const totalDebit = entries.reduce((a, e) => a + e.debit, 0)
    const totalCredit = entries.reduce((a, e) => a + e.credit, 0)
    result.push({
      party_id: p.id,
      name: p.name,
      total_debit: roundMoney(totalDebit),
      total_credit: roundMoney(totalCredit),
      balance: roundMoney(sign * (totalDebit - totalCredit))
    })
  }
  return result
}

/* ---------------- Opening balances (per account; FY carry-forward is computed) ---------------- */

/** All opening rows for a party (one per plant; plant_id null = common/all plants). */
export async function listOpeningBalances(payload: {
  party_type: LedgerType
  party_id: number
}): Promise<OpeningBalance[]> {
  return (await getDb()
    .prepare(
      `SELECT id, party_type, party_id, plant_id, amount, direction, as_of_date, remarks
       FROM opening_balances WHERE party_type = ? AND party_id = ? ORDER BY plant_id`
    )
    .all(payload.party_type, payload.party_id)) as OpeningBalance[]
}

/** Back-compat single getter — returns the common (all-plants) opening if any, else the first row. */
export async function getOpeningBalance(payload: {
  party_type: LedgerType
  party_id: number
}): Promise<OpeningBalance | null> {
  const rows = await listOpeningBalances(payload)
  return rows.find((r) => r.plant_id == null) ?? rows[0] ?? null
}

interface OpeningRowInput {
  plant_id?: number | null
  amount: number
  direction: 'debit' | 'credit'
  as_of_date?: string
  remarks?: string
}

/** Replace all opening rows for a party with the given per-plant rows (non-zero amounts only). */
export async function setOpeningBalances(payload: {
  party_type: LedgerType
  party_id: number
  rows: OpeningRowInput[]
}): Promise<{ ok: boolean; error?: string }> {
  if (!OPENING_TYPES.includes(payload.party_type))
    return { ok: false, error: 'Opening balance is only available for customer, supplier, transporter, outsource and plant ledgers.' }
  if (!payload.party_id) return { ok: false, error: 'Select a party.' }
  const d = getDb()
  await d.transaction(async () => {
    await d
      .prepare(`DELETE FROM opening_balances WHERE party_type = ? AND party_id = ?`)
      .run(payload.party_type, payload.party_id)
    const stmt = d.prepare(
      `INSERT INTO opening_balances (party_type, party_id, plant_id, amount, direction, as_of_date, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    for (const r of payload.rows ?? []) {
      const amount = roundMoney(Number(r.amount) || 0)
      if (!(amount > 0)) continue
      const direction = r.direction === 'credit' ? 'credit' : 'debit'
      const asOf = r.as_of_date || new Date().toISOString().slice(0, 10)
      await stmt.run(
        payload.party_type,
        payload.party_id,
        r.plant_id ? Number(r.plant_id) : null,
        amount,
        direction,
        asOf,
        r.remarks ?? ''
      )
    }
  })
  return { ok: true }
}

/** Back-compat single setter (one common opening). */
export async function setOpeningBalance(payload: {
  party_type: LedgerType
  party_id: number
  plant_id?: number | null
  amount: number
  direction: 'debit' | 'credit'
  as_of_date: string
  remarks?: string
}): Promise<{ ok: boolean; error?: string }> {
  return setOpeningBalances({
    party_type: payload.party_type,
    party_id: payload.party_id,
    rows: [{ plant_id: payload.plant_id ?? null, amount: payload.amount, direction: payload.direction, as_of_date: payload.as_of_date, remarks: payload.remarks }]
  })
}

export async function deleteOpeningBalance(payload: {
  party_type: LedgerType
  party_id: number
}): Promise<{ ok: boolean }> {
  await getDb()
    .prepare(`DELETE FROM opening_balances WHERE party_type = ? AND party_id = ?`)
    .run(payload.party_type, payload.party_id)
  return { ok: true }
}

/**
 * Consolidated outstanding position across suppliers, customers and transporters
 * for the Payment Status screen. Customers are receivable; suppliers/transporters payable.
 */
export async function getAllDues(payload: { plant_id?: number } = {}): Promise<DueRow[]> {
  const types: PartyType[] = ['customer', 'supplier', 'transporter', 'outsource']
  const rows: DueRow[] = []
  for (const t of types) {
    const balances = await getPartyBalances({ party_type: t, plant_id: payload.plant_id })
    for (const b of balances) {
      rows.push({
        party_type: t,
        party_id: b.party_id,
        name: b.name,
        total_debit: b.total_debit,
        total_credit: b.total_credit,
        balance: b.balance,
        kind: t === 'customer' ? 'receivable' : 'payable'
      })
    }
  }
  return rows
}
