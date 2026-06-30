import { getDb } from '../db'
import { nextNumber } from '../db'
import type { PlantExpense, ExpenseCategory, ExpenseCategoryTotal, ExpenseBookRow, PaymentStatus } from '@shared/types'
import { properCase, derivePaymentStatus } from '@shared/types'
import { issuePartsForRef, clearPartsForRef } from './parts'
import { listDieselIssuesAll } from './diesel'

function money(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
function num(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000
}

export interface ExpenseFilter {
  plant_id?: number
  category?: ExpenseCategory
  asset_id?: number
  from?: string
  to?: string
}

export async function listPlantExpenses(filter: ExpenseFilter = {}): Promise<PlantExpense[]> {
  const d = getDb()
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (filter.plant_id) {
    where.push('e.plant_id = @plant_id')
    params.plant_id = filter.plant_id
  }
  if (filter.category) {
    where.push('e.category = @category')
    params.category = filter.category
  }
  if (filter.asset_id) {
    where.push('e.asset_id = @asset_id')
    params.asset_id = filter.asset_id
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
      `SELECT e.*, p.name AS plant_name, a.name AS asset_name, o.name AS outsource_name
       FROM plant_expenses e
       JOIN plants p ON p.id = e.plant_id
       LEFT JOIN assets a ON a.id = e.asset_id
       LEFT JOIN outsource o ON o.id = e.outsource_id
       ${clause}
       ORDER BY e.date DESC, e.id DESC`
    )
    .all(params)) as PlantExpense[]
}

export async function expenseTotals(filter: ExpenseFilter = {}): Promise<ExpenseCategoryTotal[]> {
  const d = getDb()
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (filter.plant_id) {
    where.push('plant_id = @plant_id')
    params.plant_id = filter.plant_id
  }
  if (filter.from) {
    where.push('date >= @from')
    params.from = filter.from
  }
  if (filter.to) {
    where.push('date <= @to')
    params.to = filter.to
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return (await d
    .prepare(
      `SELECT category, ROUND(COALESCE(SUM(amount),0),2) AS amount
       FROM plant_expenses ${clause} GROUP BY category ORDER BY amount DESC`
    )
    .all(params)) as ExpenseCategoryTotal[]
}

const CAT_LABEL: Record<string, string> = {
  electricity: 'Electricity',
  maintenance: 'Maintenance',
  fixed: 'Fixed Cost',
  tipper_rent: 'Tipper Rent',
  equipment_rent: 'Equipment Rent',
  other: 'Other'
}

/**
 * Consolidated expense book for a plant: native plant expenses PLUS raw/finished
 * purchases, diesel purchases and wages — every outgoing in one read-only list.
 * Pulled-in rows are still entered on their own screens (no data duplication).
 */
export async function expenseBook(filter: ExpenseFilter = {}): Promise<ExpenseBookRow[]> {
  const d = getDb()
  const pid = filter.plant_id
  const cond = (alias: string): { sql: string; params: Record<string, unknown> } => {
    const parts: string[] = []
    const params: Record<string, unknown> = {}
    if (pid) {
      parts.push(`${alias}.plant_id = @plant_id`)
      params.plant_id = pid
    }
    if (filter.from) {
      parts.push(`${alias}.date >= @from`)
      params.from = filter.from
    }
    if (filter.to) {
      parts.push(`${alias}.date <= @to`)
      params.to = filter.to
    }
    return { sql: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params }
  }
  const rows: ExpenseBookRow[] = []

  // 1) Native plant expenses (editable).
  const e = cond('e')
  const exp = (await d
    .prepare(
      `SELECT e.id, e.expense_no, e.date, e.plant_id, p.name AS plant_name, e.category, e.title,
              e.units, e.rate, a.name AS asset_name, e.amount, e.paid_amount, e.payment_status
       FROM plant_expenses e JOIN plants p ON p.id = e.plant_id LEFT JOIN assets a ON a.id = e.asset_id ${e.sql}`
    )
    .all(e.params)) as Record<string, unknown>[]
  for (const x of exp)
    rows.push({
      source: 'expense',
      source_label: 'Expense',
      id: Number(x.id),
      ref_no: String(x.expense_no),
      date: String(x.date),
      plant_id: Number(x.plant_id),
      plant_name: x.plant_name as string,
      category: CAT_LABEL[String(x.category)] ?? String(x.category),
      details: (x.title as string) || (x.asset_name as string) || '-',
      amount: money(Number(x.amount) || 0),
      paid_amount: money(Number(x.paid_amount) || 0),
      payment_status: x.payment_status as PaymentStatus
    })

  // 2) Purchases (raw/finished bought-in; exclude inter-plant mirror purchases).
  const pu = cond('pu')
  const purWhere = pu.sql ? `${pu.sql} AND pu.linked_dispatch_id IS NULL` : 'WHERE pu.linked_dispatch_id IS NULL'
  const purchases = (await d
    .prepare(
      `SELECT pu.id, pu.purchase_no, pu.date, pu.plant_id, pl.name AS plant_name, pu.product_name, pu.quantity,
              s.name AS supplier_name, pu.amount, pu.paid_amount, pu.payment_status
       FROM purchases pu JOIN plants pl ON pl.id = pu.plant_id LEFT JOIN suppliers s ON s.id = pu.supplier_id ${purWhere}`
    )
    .all(pu.params)) as Record<string, unknown>[]
  for (const x of purchases)
    rows.push({
      source: 'purchase',
      source_label: 'Purchase',
      id: 0,
      ref_no: String(x.purchase_no),
      date: String(x.date),
      plant_id: Number(x.plant_id),
      plant_name: x.plant_name as string,
      category: 'Material Purchase',
      details: [x.supplier_name, x.product_name, x.quantity ? `${num(Number(x.quantity))} m³` : ''].filter(Boolean).join(' · ') || '-',
      amount: money(Number(x.amount) || 0),
      paid_amount: money(Number(x.paid_amount) || 0),
      payment_status: x.payment_status as PaymentStatus
    })

  // 3) Diesel purchases.
  const dp = cond('dp')
  const diesel = (await d
    .prepare(
      `SELECT dp.id, dp.purchase_no, dp.date, dp.plant_id, pl.name AS plant_name, dp.litres,
              s.name AS supplier_name, dp.amount, dp.paid_amount, dp.payment_status
       FROM diesel_purchases dp JOIN plants pl ON pl.id = dp.plant_id LEFT JOIN suppliers s ON s.id = dp.supplier_id ${dp.sql}`
    )
    .all(dp.params)) as Record<string, unknown>[]
  for (const x of diesel)
    rows.push({
      source: 'diesel',
      source_label: 'Diesel',
      id: 0,
      ref_no: String(x.purchase_no),
      date: String(x.date),
      plant_id: Number(x.plant_id),
      plant_name: x.plant_name as string,
      category: 'Diesel Purchase',
      details: [x.supplier_name, x.litres ? `${num(Number(x.litres))} L` : ''].filter(Boolean).join(' · ') || '-',
      amount: money(Number(x.amount) || 0),
      paid_amount: money(Number(x.paid_amount) || 0),
      payment_status: x.payment_status as PaymentStatus
    })

  // 4) Wages (payroll).
  const w = cond('w')
  const wages = (await d
    .prepare(
      `SELECT w.id, w.entry_no, w.date, w.plant_id, pl.name AS plant_name, w.period,
              em.name AS emp_name, w.amount, w.paid_amount, w.payment_status
       FROM wage_entries w JOIN plants pl ON pl.id = w.plant_id LEFT JOIN employees em ON em.id = w.employee_id ${w.sql}`
    )
    .all(w.params)) as Record<string, unknown>[]
  for (const x of wages)
    rows.push({
      source: 'wages',
      source_label: 'Wages',
      id: 0,
      ref_no: String(x.entry_no),
      date: String(x.date),
      plant_id: Number(x.plant_id),
      plant_name: x.plant_name as string,
      category: 'Wages',
      details: [x.emp_name, x.period].filter(Boolean).join(' · ') || '-',
      amount: money(Number(x.amount) || 0),
      paid_amount: money(Number(x.paid_amount) || 0),
      payment_status: x.payment_status as PaymentStatus
    })

  // 5) Diesel ISSUES (consumption) — every issuance incl. rack loading/unloading/sale transport.
  // Informational only: shown so the plant sees its diesel consumption, but NOT added to the
  // outgoings total (the diesel PURCHASE above is the booked cost — counting both would double).
  const issues = await listDieselIssuesAll({ plant_id: pid || undefined, from: filter.from, to: filter.to })
  for (const x of issues)
    rows.push({
      source: 'diesel_issue',
      source_label: 'Diesel Issued',
      informational: true,
      id: x.source === 'issue' ? x.id : 0,
      ref_no: x.ref_no,
      date: x.date,
      plant_id: x.plant_id ?? 0,
      plant_name: x.plant_name ?? undefined,
      category: 'Diesel Issued',
      details: [x.recipient, x.context, `${num(x.litres)} L`, x.charged_to ? `charged to ${x.charged_to}` : '']
        .filter(Boolean)
        .join(' · '),
      amount: money(Number(x.amount) || 0),
      paid_amount: 0,
      payment_status: 'paid'
    })

  rows.sort((a, b) => (a.date === b.date ? b.ref_no.localeCompare(a.ref_no) : b.date.localeCompare(a.date)))
  return rows
}

export interface ExpenseInput {
  id?: number
  plant_id: number
  category: ExpenseCategory
  title: string
  asset_id?: number | null
  outsource_id?: number | null
  meter_open?: number | null
  meter_close?: number | null
  rate?: number | null
  hours?: number | null
  parts?: string
  /** Spare parts issued from stock for this entry (maintenance) — FIFO-costed and added to amount. */
  parts_used?: { part_id: number; quantity: number }[]
  amount: number
  payment_status: PaymentStatus
  paid_amount?: number
  date: string
  remarks: string
}

/** Derive units/amount/rate so any one missing piece is auto-filled. */
function resolve(p: ExpenseInput): Record<string, unknown> {
  const cat = p.category
  let meter_open = p.meter_open == null || (p.meter_open as unknown) === '' ? null : Number(p.meter_open)
  let meter_close = p.meter_close == null || (p.meter_close as unknown) === '' ? null : Number(p.meter_close)
  let units: number | null = null
  let rate = p.rate == null || (p.rate as unknown) === '' ? null : Number(p.rate)
  let hours = p.hours == null || (p.hours as unknown) === '' ? null : Number(p.hours)
  let amount = Number(p.amount) || 0

  if (cat === 'electricity') {
    if (meter_open != null && meter_close != null) units = num(meter_close - meter_open)
    if (units != null && units !== 0) {
      if (amount <= 0 && rate != null) amount = money(units * rate)
      else if (amount > 0 && (rate == null || rate === 0)) rate = money(amount / units)
    }
  } else {
    meter_open = null
    meter_close = null
  }

  if (cat === 'tipper_rent' || cat === 'equipment_rent') {
    if (amount <= 0 && hours != null && rate != null) amount = money(hours * rate)
  } else {
    hours = null
  }

  if (!(amount > 0)) throw new Error('Amount must be greater than 0.')

  return {
    plant_id: p.plant_id,
    category: cat,
    title: properCase(p.title),
    asset_id: p.asset_id ?? null,
    outsource_id: p.outsource_id ?? null,
    meter_open,
    meter_close,
    units,
    rate,
    hours,
    parts: p.parts ?? '',
    amount: money(amount),
    payment_status: derivePaymentStatus(amount, Number(p.paid_amount) || 0),
    paid_amount: money(Number(p.paid_amount) || 0),
    date: p.date,
    remarks: p.remarks ?? ''
  }
}

export async function createPlantExpense(p: ExpenseInput): Promise<PlantExpense> {
  const d = getDb()
  const id = await d.transaction(async () => {
    const no = await nextNumber('PEX', 'plant_expense')
    // Issue any spare parts from stock (FIFO) against this entry; their cost adds to the amount.
    const partsCost = p.parts_used?.length
      ? await issuePartsForRef(d, { asset_id: p.asset_id ?? null, ref_no: no, date: p.date, note: properCase(p.title), parts: p.parts_used })
      : 0
    const fields = resolve({ ...p, amount: (Number(p.amount) || 0) + partsCost })
    const info = await d
      .prepare(
        `INSERT INTO plant_expenses
          (expense_no, plant_id, category, title, asset_id, outsource_id, meter_open, meter_close, units, rate, hours,
           parts, amount, payment_status, paid_amount, date, remarks)
         VALUES (@expense_no,@plant_id,@category,@title,@asset_id,@outsource_id,@meter_open,@meter_close,@units,@rate,@hours,
           @parts,@amount,@payment_status,@paid_amount,@date,@remarks)`
      )
      .run({ expense_no: no, ...fields })
    return Number(info.lastInsertRowid)
  })
  return (await d.prepare(`SELECT * FROM plant_expenses WHERE id = ?`).get(id)) as PlantExpense
}

export async function updatePlantExpense(p: ExpenseInput): Promise<PlantExpense> {
  const d = getDb()
  if (!p.id) throw new Error('Missing expense id.')
  const old = (await d.prepare(`SELECT expense_no FROM plant_expenses WHERE id = ?`).get(p.id)) as
    | { expense_no: string }
    | undefined
  if (!old) throw new Error('Expense not found.')
  await d.transaction(async () => {
    // Re-sync the spare parts issued against this entry (restore old, re-issue current).
    await clearPartsForRef(d, old.expense_no)
    const partsCost = p.parts_used?.length
      ? await issuePartsForRef(d, { asset_id: p.asset_id ?? null, ref_no: old.expense_no, date: p.date, note: properCase(p.title), parts: p.parts_used })
      : 0
    const fields = resolve({ ...p, amount: (Number(p.amount) || 0) + partsCost })
    await d.prepare(
      `UPDATE plant_expenses SET plant_id=@plant_id, category=@category, title=@title, asset_id=@asset_id,
         outsource_id=@outsource_id,
         meter_open=@meter_open, meter_close=@meter_close, units=@units, rate=@rate, hours=@hours,
         parts=@parts, amount=@amount, payment_status=@payment_status, paid_amount=@paid_amount,
         date=@date, remarks=@remarks WHERE id=@id`
    ).run({ id: p.id, ...fields })
  })
  return (await d.prepare(`SELECT * FROM plant_expenses WHERE id = ?`).get(p.id)) as PlantExpense
}

export async function deletePlantExpense(payload: { id: number }): Promise<{ ok: boolean }> {
  const d = getDb()
  const old = (await d.prepare(`SELECT expense_no FROM plant_expenses WHERE id = ?`).get(payload.id)) as
    | { expense_no: string }
    | undefined
  await d.transaction(async () => {
    // Restore any spare parts issued against this entry, then remove it.
    if (old?.expense_no) await clearPartsForRef(d, old.expense_no)
    await d.prepare(`DELETE FROM plant_expenses WHERE id = ?`).run(payload.id)
  })
  return { ok: true }
}
