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

const PARTY_TABLE: Record<PartyType, string> = {
  customer: 'customers',
  supplier: 'suppliers',
  transporter: 'transporters',
  outsource: 'outsource'
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
  party_type: PartyType
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
  if (!PARTY_TABLE[p.party_type]) throw new Error('Invalid party type.')
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
      `SELECT pay.*, COALESCE(c.name, s.name, t.name) AS party_name
       FROM payments pay
       LEFT JOIN customers c ON pay.party_type='customer' AND c.id = pay.party_id
       LEFT JOIN suppliers s ON pay.party_type='supplier' AND s.id = pay.party_id
       LEFT JOIN transporters t ON pay.party_type='transporter' AND t.id = pay.party_id
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
const OPENING_TYPES: LedgerType[] = ['customer', 'supplier', 'transporter', 'outsource']

/** A synthetic 'Opening Balance' entry from the stored opening, or null. */
async function openingEntry(partyType: LedgerType, partyId: number): Promise<RawEntry | null> {
  if (!OPENING_TYPES.includes(partyType)) return null
  const row = (await getDb()
    .prepare(`SELECT amount, direction, as_of_date FROM opening_balances WHERE party_type = ? AND party_id = ?`)
    .get(partyType, partyId)) as { amount: number; direction: string; as_of_date: string } | undefined
  if (!row || !(row.amount > 0)) return null
  return {
    date: row.as_of_date || '1900-04-01',
    created_at: '',
    particulars: 'Opening Balance',
    ref: 'OPENING',
    debit: row.direction === 'debit' ? roundMoney(row.amount) : 0,
    credit: row.direction === 'credit' ? roundMoney(row.amount) : 0
  }
}

async function buildEntries(partyType: LedgerType, partyId: number): Promise<RawEntry[]> {
  const d = getDb()
  const entries: RawEntry[] = []
  // Seed the manual opening balance (carry-forward into later FYs is computed by getLedger).
  const op = await openingEntry(partyType, partyId)
  if (op) entries.push(op)

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
      for (const e of await buildEntries(link.type, link.id))
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
            - (SELECT COALESCE(SUM(amount),0) FROM rack_expenses WHERE rack_id=r.id) AS profit,
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
  }

  if (partyType === 'customer') {
    const dispatches = (await d
      .prepare(
        `SELECT dispatch_no, date, created_at, product_name, COALESCE(sale_quantity, quantity) AS quantity, uom,
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
      billed: number
      paid_amount: number
    }[]
    for (const x of dispatches) {
      if (x.billed > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Direct sale — ${x.product_name} (${x.quantity} ${x.uom})`,
          ref: x.dispatch_no,
          debit: x.billed,
          credit: 0
        })
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
        particulars: `Rack sale — ${x.product_name} (${x.quantity} ${x.uom}) · Rack ${x.rack_no}`,
        ref: x.sale_no,
        debit: x.amount,
        credit: 0
      })
  }

  if (partyType === 'supplier') {
    const purchases = (await d
      .prepare(
        `SELECT purchase_no, date, created_at, COALESCE(amount,0) AS amount, paid_amount, quantity
         FROM purchases WHERE supplier_id = ?`
      )
      .all(partyId)) as {
      purchase_no: string
      date: string
      created_at: string
      amount: number
      paid_amount: number
      quantity: number
    }[]
    for (const x of purchases) {
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Purchase — raw material (${x.quantity} m³)`,
          ref: x.purchase_no,
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
          particulars: `Diesel purchase (${x.litres} L)`,
          ref: x.purchase_no,
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
                COALESCE(rl.diesel_amount,0) AS diesel, rl.total_cm, rl.trips, r.rack_no
         FROM rack_loadings rl JOIN racks r ON r.id = rl.rack_id
         WHERE rl.transporter_id = ?`
      )
      .all(partyId)) as {
      loading_no: string
      date: string
      created_at: string
      amount: number
      diesel: number
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
      if (x.diesel > 0)
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
                COALESCE(ru.diesel_amount,0) AS diesel, ru.total_cm, ru.trips, r.rack_no
         FROM rack_unloadings ru JOIN racks r ON r.id = ru.rack_id
         WHERE ru.transporter_id = ?`
      )
      .all(partyId)) as {
      unloading_no: string
      date: string
      created_at: string
      amount: number
      diesel: number
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
      if (x.diesel > 0)
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
  from?: string
  to?: string
}): Promise<LedgerStatement> {
  const name = await partyName(payload.party_type, payload.party_id)
  const all = await buildEntries(payload.party_type, payload.party_id)
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
      debit: roundMoney(e.debit),
      credit: roundMoney(e.credit),
      balance: roundMoney(bal),
      payment_id: e.payment_id
    })
  }

  return {
    party_type: payload.party_type,
    party_id: payload.party_id,
    party_name: name,
    entries,
    total_debit: roundMoney(totalDebit),
    total_credit: roundMoney(totalCredit),
    closing: roundMoney(bal)
  }
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
  } else {
    const table = PARTY_TABLE[payload.party_type as PartyType]
    if (!table) throw new Error('Invalid party type.')
    // Plant filter returns common parties plus that plant's own.
    const clause = payload.plant_id ? `WHERE (plant_id IS NULL OR plant_id = @plant_id)` : ''
    parties = (await d
      .prepare(`SELECT id, name FROM ${table} ${clause} ORDER BY name`)
      .all(payload.plant_id ? { plant_id: payload.plant_id } : {})) as {
      id: number
      name: string
    }[]
  }
  const sign = runningSign(payload.party_type)
  const result: PartyBalance[] = []
  for (const p of parties) {
    const entries = await buildEntries(payload.party_type, p.id)
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

export async function getOpeningBalance(payload: {
  party_type: LedgerType
  party_id: number
}): Promise<OpeningBalance | null> {
  const row = (await getDb()
    .prepare(
      `SELECT id, party_type, party_id, amount, direction, as_of_date, remarks
       FROM opening_balances WHERE party_type = ? AND party_id = ?`
    )
    .get(payload.party_type, payload.party_id)) as OpeningBalance | undefined
  return row ?? null
}

export async function setOpeningBalance(payload: {
  party_type: LedgerType
  party_id: number
  amount: number
  direction: 'debit' | 'credit'
  as_of_date: string
  remarks?: string
}): Promise<{ ok: boolean; error?: string }> {
  if (!OPENING_TYPES.includes(payload.party_type))
    return { ok: false, error: 'Opening balance is only available for customer, supplier, transporter and outsource ledgers.' }
  if (!payload.party_id) return { ok: false, error: 'Select a party.' }
  const amount = roundMoney(Number(payload.amount) || 0)
  const direction = payload.direction === 'credit' ? 'credit' : 'debit'
  const asOf = payload.as_of_date || new Date().toISOString().slice(0, 10)
  const d = getDb()
  await d.transaction(async () => {
    // One opening per account — replace any existing.
    await d
      .prepare(`DELETE FROM opening_balances WHERE party_type = ? AND party_id = ?`)
      .run(payload.party_type, payload.party_id)
    if (amount > 0) {
      await d
        .prepare(
          `INSERT INTO opening_balances (party_type, party_id, amount, direction, as_of_date, remarks)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(payload.party_type, payload.party_id, amount, direction, asOf, payload.remarks ?? '')
    }
  })
  return { ok: true }
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
