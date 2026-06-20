import { getDb } from '../db'
import type { BudgetReport, BudgetItem } from '@shared/types'

// Budget heads: the five plant-expense categories plus Diesel and Payroll,
// each with where its 'actual' spend is read from.
const HEADS: { head: string; label: string; source: 'expense' | 'diesel' | 'payroll' }[] = [
  { head: 'electricity', label: 'Electricity', source: 'expense' },
  { head: 'maintenance', label: 'Maintenance', source: 'expense' },
  { head: 'fixed', label: 'Fixed Costs', source: 'expense' },
  { head: 'tipper_rent', label: 'Tipper Rent', source: 'expense' },
  { head: 'equipment_rent', label: 'Equipment Rent', source: 'expense' },
  { head: 'other', label: 'Other', source: 'expense' },
  { head: 'diesel', label: 'Diesel', source: 'diesel' },
  { head: 'payroll', label: 'Payroll / Wages', source: 'payroll' }
]

function money(n: unknown): number {
  const v = Number(n)
  return Number.isFinite(v) ? Math.round((v + Number.EPSILON) * 100) / 100 : 0
}

export async function getBudget(payload: {
  plant_id: number
  from: string
  to: string
}): Promise<BudgetReport> {
  const d = getDb()
  const { plant_id, from, to } = payload
  const empty: BudgetReport = { plant_id, from, to, items: [], total_budget: 0, total_actual: 0 }
  if (!plant_id || !from || !to) return empty

  // Saved budget amounts for this plant + period.
  const saved = (await d
    .prepare(`SELECT head, amount FROM budgets WHERE plant_id = ? AND from_date = ? AND to_date = ?`)
    .all(plant_id, from, to)) as { head: string; amount: number }[]
  const budgetByHead = new Map(saved.map((r) => [r.head, money(r.amount)]))

  // Actuals.
  const expRows = (await d
    .prepare(
      `SELECT category, COALESCE(SUM(amount),0) AS amt FROM plant_expenses
       WHERE plant_id = ? AND date >= ? AND date <= ? GROUP BY category`
    )
    .all(plant_id, from, to)) as { category: string; amt: number }[]
  const expByCat = new Map(expRows.map((r) => [r.category, money(r.amt)]))

  const diesel = (await d
    .prepare(
      `SELECT COALESCE(SUM(amount),0) AS amt FROM diesel_purchases
       WHERE plant_id = ? AND date >= ? AND date <= ?`
    )
    .get(plant_id, from, to)) as { amt: number }
  const payroll = (await d
    .prepare(
      `SELECT COALESCE(SUM(amount),0) AS amt FROM wage_entries
       WHERE plant_id = ? AND date >= ? AND date <= ?`
    )
    .get(plant_id, from, to)) as { amt: number }
  // Machine-usage costs from purchases/mining count towards Equipment Rent.
  const machine = (await d
    .prepare(
      `SELECT COALESCE(SUM(pm.amount),0) AS amt FROM purchase_machines pm
       JOIN purchases pu ON pu.id = pm.purchase_id
       WHERE pu.plant_id = ? AND pu.date >= ? AND pu.date <= ?`
    )
    .get(plant_id, from, to)) as { amt: number }
  // Machine-usage costs from direct sales also count towards Equipment Rent.
  const saleMachine = (await d
    .prepare(
      `SELECT COALESCE(SUM(dm.amount),0) AS amt FROM dispatch_machines dm
       JOIN dispatches di ON di.id = dm.dispatch_id
       WHERE di.plant_id = ? AND di.date >= ? AND di.date <= ?`
    )
    .get(plant_id, from, to)) as { amt: number }

  const items: BudgetItem[] = HEADS.map((h) => {
    const budget = budgetByHead.get(h.head) ?? 0
    let actual =
      h.source === 'diesel'
        ? money(diesel.amt)
        : h.source === 'payroll'
          ? money(payroll.amt)
          : expByCat.get(h.head) ?? 0
    if (h.head === 'equipment_rent') actual = money(actual + money(machine.amt) + money(saleMachine.amt))
    return { head: h.head, label: h.label, budget, actual, variance: money(budget - actual) }
  })

  return {
    plant_id,
    from,
    to,
    items,
    total_budget: money(items.reduce((s, i) => s + i.budget, 0)),
    total_actual: money(items.reduce((s, i) => s + i.actual, 0))
  }
}

export async function saveBudget(payload: {
  plant_id: number
  from: string
  to: string
  items: { head: string; amount: number }[]
}): Promise<{ ok: boolean; error?: string }> {
  const d = getDb()
  if (!payload.plant_id) return { ok: false, error: 'Select a plant.' }
  if (!payload.from || !payload.to) return { ok: false, error: 'Select a date range.' }
  const valid = new Set(HEADS.map((h) => h.head))
  await d.transaction(async () => {
    await d
      .prepare(`DELETE FROM budgets WHERE plant_id = ? AND from_date = ? AND to_date = ?`)
      .run(payload.plant_id, payload.from, payload.to)
    const stmt = d.prepare(
      `INSERT INTO budgets (plant_id, head, from_date, to_date, amount) VALUES (?, ?, ?, ?, ?)`
    )
    for (const it of payload.items ?? []) {
      if (!valid.has(it.head)) continue
      await stmt.run(payload.plant_id, it.head, payload.from, payload.to, money(it.amount))
    }
  })
  return { ok: true }
}
