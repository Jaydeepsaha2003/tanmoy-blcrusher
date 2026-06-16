import { getDb, nextNumber } from '../db'
import type { PlantExpense, ExpenseCategory, ExpenseCategoryTotal, PaymentStatus } from '@shared/types'
import { properCase, derivePaymentStatus } from '@shared/types'

function money(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
function num(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000
}

export interface ExpenseFilter {
  plant_id?: number
  category?: ExpenseCategory
  from?: string
  to?: string
}

export function listPlantExpenses(filter: ExpenseFilter = {}): PlantExpense[] {
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
  if (filter.from) {
    where.push('e.date >= @from')
    params.from = filter.from
  }
  if (filter.to) {
    where.push('e.date <= @to')
    params.to = filter.to
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return d
    .prepare(
      `SELECT e.*, p.name AS plant_name, a.name AS asset_name, o.name AS outsource_name
       FROM plant_expenses e
       JOIN plants p ON p.id = e.plant_id
       LEFT JOIN assets a ON a.id = e.asset_id
       LEFT JOIN outsource o ON o.id = e.outsource_id
       ${clause}
       ORDER BY e.date DESC, e.id DESC`
    )
    .all(params) as PlantExpense[]
}

export function expenseTotals(filter: ExpenseFilter = {}): ExpenseCategoryTotal[] {
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
  return d
    .prepare(
      `SELECT category, ROUND(COALESCE(SUM(amount),0),2) AS amount
       FROM plant_expenses ${clause} GROUP BY category ORDER BY amount DESC`
    )
    .all(params) as ExpenseCategoryTotal[]
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

export function createPlantExpense(p: ExpenseInput): PlantExpense {
  const d = getDb()
  const fields = resolve(p)
  const no = nextNumber('PEX', 'plant_expense')
  const info = d
    .prepare(
      `INSERT INTO plant_expenses
        (expense_no, plant_id, category, title, asset_id, outsource_id, meter_open, meter_close, units, rate, hours,
         parts, amount, payment_status, paid_amount, date, remarks)
       VALUES (@expense_no,@plant_id,@category,@title,@asset_id,@outsource_id,@meter_open,@meter_close,@units,@rate,@hours,
         @parts,@amount,@payment_status,@paid_amount,@date,@remarks)`
    )
    .run({ expense_no: no, ...fields })
  return d.prepare(`SELECT * FROM plant_expenses WHERE id = ?`).get(info.lastInsertRowid) as PlantExpense
}

export function updatePlantExpense(p: ExpenseInput): PlantExpense {
  const d = getDb()
  if (!p.id) throw new Error('Missing expense id.')
  const fields = resolve(p)
  d.prepare(
    `UPDATE plant_expenses SET plant_id=@plant_id, category=@category, title=@title, asset_id=@asset_id,
       outsource_id=@outsource_id,
       meter_open=@meter_open, meter_close=@meter_close, units=@units, rate=@rate, hours=@hours,
       parts=@parts, amount=@amount, payment_status=@payment_status, paid_amount=@paid_amount,
       date=@date, remarks=@remarks WHERE id=@id`
  ).run({ id: p.id, ...fields })
  return d.prepare(`SELECT * FROM plant_expenses WHERE id = ?`).get(p.id) as PlantExpense
}

export function deletePlantExpense(payload: { id: number }): { ok: boolean } {
  const d = getDb()
  d.prepare(`DELETE FROM plant_expenses WHERE id = ?`).run(payload.id)
  return { ok: true }
}
