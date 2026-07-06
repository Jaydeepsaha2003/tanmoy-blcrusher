import { getDb, nextNumber } from '../db'
import type { Employee, WageEntry, WageType, PaymentStatus } from '@shared/types'
import { properCase, derivePaymentStatus } from '@shared/types'
import { getWorkdaySettings } from './system'
import { ensureUniqueName } from './names'

function money(n: number): number {
  const v = Number(n)
  return Number.isFinite(v) ? Math.round((v + Number.EPSILON) * 100) / 100 : 0
}

/** Working days in a YYYY-MM month, excluding the configured weekly-off weekdays. */
export async function workingDaysIn(period: string): Promise<number> {
  const [y, m] = period.split('-').map(Number)
  if (!y || !m) return 0
  const offs = new Set((await getWorkdaySettings()).weekly_offs)
  const days = new Date(y, m, 0).getDate()
  let count = 0
  for (let day = 1; day <= days; day++) {
    if (!offs.has(new Date(y, m - 1, day).getDay())) count++
  }
  return count
}

export async function getWorkingDays(payload: { period: string }): Promise<{ working_days: number }> {
  return { working_days: await workingDaysIn(payload.period) }
}

/* ---------------- Employees ---------------- */

export async function listEmployees(payload: { plant_id?: number } = {}): Promise<Employee[]> {
  const d = getDb()
  const clause = payload.plant_id ? `WHERE (e.plant_id IS NULL OR e.plant_id = @plant_id)` : ''
  return (await d
    .prepare(
      `SELECT e.*, p.name AS plant_name
       FROM employees e LEFT JOIN plants p ON p.id = e.plant_id
       ${clause}
       ORDER BY e.name`
    )
    .all(payload)) as Employee[]
}

export interface EmployeeProfile {
  photo?: string | null
  dob?: string | null
  joining_date?: string | null
  address?: string
  aadhaar_no?: string
  pan_no?: string
  dl_no?: string
  bank_account?: string
  bank_ifsc?: string
}

/** Profile field values, defaulted, for INSERT/UPDATE named params. */
function profileFields(p: EmployeeProfile): Record<string, unknown> {
  const s = (v?: string): string => (v ?? '').trim()
  return {
    photo: p.photo || null,
    dob: p.dob || null,
    joining_date: p.joining_date || null,
    address: p.address ?? '',
    aadhaar_no: s(p.aadhaar_no),
    pan_no: s(p.pan_no).toUpperCase(),
    dl_no: s(p.dl_no).toUpperCase(),
    bank_account: s(p.bank_account),
    bank_ifsc: s(p.bank_ifsc).toUpperCase()
  }
}

export async function createEmployee(p: {
  name: string
  designation: string
  wage_type: WageType
  monthly_salary?: number
  daily_wage?: number
  ot_rate?: number
  plant_id?: number | null
  contact: string
  status: string
  remarks: string
} & EmployeeProfile): Promise<Employee> {
  const d = getDb()
  if (!p.name?.trim()) throw new Error('Name is required.')
  await ensureUniqueName('employees', p.name, { label: 'An employee' })
  const info = await d
    .prepare(
      `INSERT INTO employees (name, designation, wage_type, monthly_salary, daily_wage, ot_rate, plant_id, contact, status, remarks,
         photo, dob, joining_date, address, aadhaar_no, pan_no, dl_no, bank_account, bank_ifsc)
       VALUES (@name,@designation,@wage_type,@monthly_salary,@daily_wage,@ot_rate,@plant_id,@contact,@status,@remarks,
         @photo,@dob,@joining_date,@address,@aadhaar_no,@pan_no,@dl_no,@bank_account,@bank_ifsc)`
    )
    .run({
      name: properCase(p.name),
      designation: properCase(p.designation),
      wage_type: p.wage_type || 'monthly',
      monthly_salary: Number(p.monthly_salary) || 0,
      daily_wage: Number(p.daily_wage) || 0,
      ot_rate: Number(p.ot_rate) || 0,
      plant_id: p.plant_id ?? null,
      contact: p.contact ?? '',
      status: p.status || 'active',
      remarks: p.remarks ?? '',
      ...profileFields(p)
    })
  return (await d.prepare(`SELECT * FROM employees WHERE id = ?`).get(info.lastInsertRowid)) as Employee
}

export async function updateEmployee(p: {
  id: number
  name: string
  designation: string
  wage_type: WageType
  monthly_salary?: number
  daily_wage?: number
  ot_rate?: number
  plant_id?: number | null
  contact: string
  status: string
  remarks: string
} & EmployeeProfile): Promise<Employee> {
  const d = getDb()
  if (!p.name?.trim()) throw new Error('Name is required.')
  await ensureUniqueName('employees', p.name, { id: p.id, label: 'An employee' })
  await d.prepare(
    `UPDATE employees SET name=@name, designation=@designation, wage_type=@wage_type, monthly_salary=@monthly_salary,
       daily_wage=@daily_wage, ot_rate=@ot_rate, plant_id=@plant_id, contact=@contact, status=@status, remarks=@remarks,
       photo=@photo, dob=@dob, joining_date=@joining_date, address=@address, aadhaar_no=@aadhaar_no,
       pan_no=@pan_no, dl_no=@dl_no, bank_account=@bank_account, bank_ifsc=@bank_ifsc WHERE id=@id`
  ).run({
    id: p.id,
    name: properCase(p.name),
    designation: properCase(p.designation),
    wage_type: p.wage_type || 'monthly',
    monthly_salary: Number(p.monthly_salary) || 0,
    daily_wage: Number(p.daily_wage) || 0,
    ot_rate: Number(p.ot_rate) || 0,
    plant_id: p.plant_id ?? null,
    contact: p.contact ?? '',
    status: p.status || 'active',
    remarks: p.remarks ?? '',
    ...profileFields(p)
  })
  return (await d.prepare(`SELECT * FROM employees WHERE id = ?`).get(p.id)) as Employee
}

export async function deleteEmployee(payload: {
  id: number
}): Promise<{ ok: boolean; error?: string }> {
  const d = getDb()
  const used = (await d.prepare(`SELECT COUNT(*) AS c FROM wage_entries WHERE employee_id = ?`).get(payload.id)) as {
    c: number
  }
  if (used.c > 0) return { ok: false, error: 'Cannot delete: this employee has wage records.' }
  await d.prepare(`DELETE FROM employees WHERE id = ?`).run(payload.id)
  return { ok: true }
}

/* ---------------- Wage entries ---------------- */

export interface WageFilter {
  plant_id?: number
  employee_id?: number
  asset_id?: number
  period?: string
  payment_status?: PaymentStatus
  from?: string
  to?: string
}

export async function listWageEntries(filter: WageFilter = {}): Promise<WageEntry[]> {
  const d = getDb()
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (filter.plant_id) {
    where.push('w.plant_id = @plant_id')
    params.plant_id = filter.plant_id
  }
  if (filter.employee_id) {
    where.push('w.employee_id = @employee_id')
    params.employee_id = filter.employee_id
  }
  if (filter.asset_id) {
    where.push('w.asset_id = @asset_id')
    params.asset_id = filter.asset_id
  }
  if (filter.period) {
    where.push('w.period = @period')
    params.period = filter.period
  }
  if (filter.payment_status) {
    where.push('w.payment_status = @payment_status')
    params.payment_status = filter.payment_status
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return (await d
    .prepare(
      `SELECT w.*, e.name AS employee_name, e.designation, a.name AS asset_name,
              (SELECT COALESCE(SUM(pce.amount),0) FROM plant_cash_entries pce
                 WHERE pce.type='Advance' AND pce.direction='out'
                   AND pce.employee_id = w.employee_id AND pce.plant_id = w.plant_id
                   AND SUBSTR(pce.date,1,7) = w.period) AS advance
       FROM wage_entries w
       JOIN employees e ON e.id = w.employee_id
       LEFT JOIN assets a ON a.id = w.asset_id
       ${clause}
       ORDER BY w.period DESC, e.name`
    )
    .all(params)) as WageEntry[]
}

export interface WageInput {
  id?: number
  employee_id: number
  plant_id: number
  asset_id?: number | null
  period: string
  days_worked: number
  ot_hours?: number
  ot_rate?: number | null
  deduction?: number
  payment_status: PaymentStatus
  paid_amount?: number
  date: string
  remarks: string
}

async function resolve(p: WageInput): Promise<Record<string, unknown>> {
  const d = getDb()
  const emp = (await d.prepare(`SELECT * FROM employees WHERE id = ?`).get(p.employee_id)) as Employee | undefined
  if (!emp) throw new Error('Employee not found.')
  if (!p.period) throw new Error('Pay period is required.')
  const workingDays = await workingDaysIn(p.period)
  const daysWorked = Number(p.days_worked) || 0
  // A monthly salary is capped at the full month — paid days never exceed the month's working
  // days (overtime is billed separately), so a data-entry slip can't pay more than the salary.
  const earned =
    emp.wage_type === 'monthly'
      ? workingDays > 0
        ? money((emp.monthly_salary / workingDays) * Math.min(daysWorked, workingDays))
        : 0
      : money(emp.daily_wage * daysWorked)
  const otHours = Number(p.ot_hours) || 0
  const otRate = p.ot_rate == null || (p.ot_rate as unknown) === '' ? emp.ot_rate : Number(p.ot_rate)
  const otAmount = money(otHours * otRate)
  const deduction = money(Number(p.deduction) || 0)
  const gross = money(earned + otAmount)
  const amount = money(gross - deduction)
  if (!(amount > 0)) throw new Error('Net wage must be greater than 0.')
  return {
    employee_id: p.employee_id,
    plant_id: p.plant_id,
    asset_id: p.asset_id ?? null,
    period: p.period,
    wage_type: emp.wage_type,
    working_days: workingDays,
    days_worked: daysWorked,
    earned,
    ot_hours: otHours,
    ot_rate: otRate,
    ot_amount: otAmount,
    deduction,
    gross,
    amount,
    payment_status: derivePaymentStatus(amount, Number(p.paid_amount) || 0),
    paid_amount: money(Number(p.paid_amount) || 0),
    date: p.date,
    remarks: p.remarks ?? ''
  }
}

export async function createWageEntry(p: WageInput): Promise<WageEntry> {
  const d = getDb()
  const fields = await resolve(p)
  const no = await nextNumber('WGE', 'wage_entry')
  const info = await d
    .prepare(
      `INSERT INTO wage_entries
        (entry_no, employee_id, plant_id, asset_id, period, wage_type, working_days, days_worked, earned,
         ot_hours, ot_rate, ot_amount, deduction, gross, amount, payment_status, paid_amount, date, remarks)
       VALUES (@entry_no,@employee_id,@plant_id,@asset_id,@period,@wage_type,@working_days,@days_worked,@earned,
         @ot_hours,@ot_rate,@ot_amount,@deduction,@gross,@amount,@payment_status,@paid_amount,@date,@remarks)`
    )
    .run({ entry_no: no, ...fields })
  return (await d.prepare(`SELECT * FROM wage_entries WHERE id = ?`).get(info.lastInsertRowid)) as WageEntry
}

export async function updateWageEntry(p: WageInput): Promise<WageEntry> {
  const d = getDb()
  if (!p.id) throw new Error('Missing wage entry id.')
  const fields = await resolve(p)
  await d.prepare(
    `UPDATE wage_entries SET employee_id=@employee_id, plant_id=@plant_id, asset_id=@asset_id, period=@period, wage_type=@wage_type,
       working_days=@working_days, days_worked=@days_worked, earned=@earned, ot_hours=@ot_hours, ot_rate=@ot_rate,
       ot_amount=@ot_amount, deduction=@deduction, gross=@gross, amount=@amount,
       payment_status=@payment_status, paid_amount=@paid_amount, date=@date, remarks=@remarks WHERE id=@id`
  ).run({ id: p.id, ...fields })
  return (await d.prepare(`SELECT * FROM wage_entries WHERE id = ?`).get(p.id)) as WageEntry
}

export async function deleteWageEntry(payload: { id: number }): Promise<{ ok: boolean }> {
  const d = getDb()
  await d.prepare(`DELETE FROM wage_entries WHERE id = ?`).run(payload.id)
  return { ok: true }
}

/**
 * Pay an employee's outstanding wages from Make Payment: allocates the amount
 * across their unpaid/partial wage entries oldest-first, updating each entry's
 * paid amount + status. Any excess beyond what's due is ignored.
 */
export async function payEmployee(p: {
  employee_id: number
  amount: number
  plant_id?: number | null
  date?: string
  remarks?: string
}): Promise<{ ok: boolean }> {
  const d = getDb()
  if (!p.employee_id) throw new Error('Select an employee.')
  let remaining = money(Number(p.amount) || 0)
  if (!(remaining > 0)) throw new Error('Amount must be greater than 0.')
  await d.transaction(async () => {
    const where = p.plant_id
      ? `employee_id = @employee_id AND plant_id = @plant_id`
      : `employee_id = @employee_id`
    // Each entry's still-due nets off cash advances already given for that month.
    const rows = (await d
      .prepare(
        `SELECT w.id, w.amount, w.paid_amount,
                (SELECT COALESCE(SUM(pce.amount),0) FROM plant_cash_entries pce
                   WHERE pce.type='Advance' AND pce.direction='out'
                     AND pce.employee_id = w.employee_id AND pce.plant_id = w.plant_id
                     AND SUBSTR(pce.date,1,7) = w.period) AS advance
         FROM wage_entries w
         WHERE ${where} AND COALESCE(w.amount,0) - COALESCE(w.paid_amount,0)
               - (SELECT COALESCE(SUM(pce.amount),0) FROM plant_cash_entries pce
                    WHERE pce.type='Advance' AND pce.direction='out'
                      AND pce.employee_id = w.employee_id AND pce.plant_id = w.plant_id
                      AND SUBSTR(pce.date,1,7) = w.period) > 0.005
         ORDER BY w.period, w.id`
      )
      .all({ employee_id: p.employee_id, plant_id: p.plant_id ?? null })) as {
      id: number
      amount: number
      paid_amount: number
      advance: number
    }[]
    for (const w of rows) {
      if (remaining <= 0.005) break
      const due = money((w.amount || 0) - (w.paid_amount || 0) - (w.advance || 0))
      const pay = Math.min(due, remaining)
      const newPaid = money((w.paid_amount || 0) + pay)
      // Status reflects payments + advances already given for the month.
      await d
        .prepare(`UPDATE wage_entries SET paid_amount = ?, payment_status = ? WHERE id = ?`)
        .run(newPaid, derivePaymentStatus(w.amount || 0, money(newPaid + (w.advance || 0))), w.id)
      remaining = money(remaining - pay)
    }
  })
  return { ok: true }
}
