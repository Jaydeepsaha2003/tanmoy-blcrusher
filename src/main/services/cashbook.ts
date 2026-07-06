import { getDb, nextNumber } from '../db'
import type { CashHolder, CashEntry } from '@shared/types'
import { properCase } from '@shared/types'
import { plantIdSet, writePartyPlants, attachPartyPlants, plantScopeSql } from './partyPlants'
import { createPlantExpense, deletePlantExpense } from './plantExpenses'

function money(n: unknown): number {
  const v = Number(n)
  return Number.isFinite(v) ? Math.round((v + Number.EPSILON) * 100) / 100 : 0
}

/* ---------------- Cash holders (custodians) ---------------- */

export async function listCashHolders(payload: { plant_id?: number } = {}): Promise<CashHolder[]> {
  const d = getDb()
  const clause = payload.plant_id ? `WHERE ${plantScopeSql('h', 'cash_holder')}` : ''
  const rows = (await d
    .prepare(`SELECT h.* FROM cashbook_holders h ${clause} ORDER BY h.name`)
    .all(payload)) as CashHolder[]
  await attachPartyPlants(d, 'cash_holder', rows)
  for (const h of rows) {
    const agg = (await d
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN kind='transfer' THEN amount ELSE 0 END),0) AS tin,
                COALESCE(SUM(CASE WHEN kind='expense' THEN amount ELSE 0 END),0) AS tout
         FROM cashbook_entries WHERE holder_id = ?`
      )
      .get(h.id)) as { tin: number; tout: number }
    h.total_in = money(agg.tin)
    h.total_expense = money(agg.tout)
    h.balance = money((h.opening_balance || 0) + agg.tin - agg.tout)
  }
  return rows
}

export async function createCashHolder(p: {
  name: string
  employee_id?: number | null
  opening_balance?: number
  remarks?: string
  plant_ids?: number[]
}): Promise<CashHolder> {
  const d = getDb()
  const name = properCase(p.name || '')
  if (!name) throw new Error('Cash holder name is required.')
  const plants = plantIdSet(p)
  const id = await d.transaction(async () => {
    const info = await d
      .prepare(`INSERT INTO cashbook_holders (name, employee_id, opening_balance, remarks) VALUES (?, ?, ?, ?)`)
      .run(name, p.employee_id ? Number(p.employee_id) : null, money(p.opening_balance), p.remarks ?? '')
    const hid = Number(info.lastInsertRowid)
    await writePartyPlants(d, 'cash_holder', hid, plants)
    return hid
  })
  const row = (await d.prepare(`SELECT * FROM cashbook_holders WHERE id = ?`).get(id)) as CashHolder
  await attachPartyPlants(d, 'cash_holder', [row])
  return row
}

export async function updateCashHolder(p: {
  id: number
  name: string
  employee_id?: number | null
  opening_balance?: number
  remarks?: string
  plant_ids?: number[]
}): Promise<CashHolder> {
  const d = getDb()
  if (!p.id) throw new Error('Missing cash holder id.')
  const name = properCase(p.name || '')
  if (!name) throw new Error('Cash holder name is required.')
  const plants = plantIdSet(p)
  await d.transaction(async () => {
    await d
      .prepare(`UPDATE cashbook_holders SET name=?, employee_id=?, opening_balance=?, remarks=? WHERE id=?`)
      .run(name, p.employee_id ? Number(p.employee_id) : null, money(p.opening_balance), p.remarks ?? '', p.id)
    await writePartyPlants(d, 'cash_holder', p.id, plants)
  })
  const row = (await d.prepare(`SELECT * FROM cashbook_holders WHERE id = ?`).get(p.id)) as CashHolder
  await attachPartyPlants(d, 'cash_holder', [row])
  return row
}

export async function deleteCashHolder(payload: { id: number }): Promise<{ ok: boolean; error?: string }> {
  const d = getDb()
  const used = (await d
    .prepare(`SELECT COUNT(*) AS c FROM cashbook_entries WHERE holder_id = ?`)
    .get(payload.id)) as { c: number }
  if (used.c > 0) return { ok: false, error: 'Cannot delete: this cash holder has entries. Remove them first.' }
  await d.transaction(async () => {
    await d.prepare(`DELETE FROM cashbook_holder_plants WHERE holder_id = ?`).run(payload.id)
    await d.prepare(`DELETE FROM cashbook_holders WHERE id = ?`).run(payload.id)
  })
  return { ok: true }
}

/* ---------------- Cashbook entries (transfers + expenses) ---------------- */

export async function listCashEntries(payload: {
  holder_id: number
  from?: string
  to?: string
}): Promise<CashEntry[]> {
  const d = getDb()
  const where = ['e.holder_id = @holder_id']
  if (payload.from) where.push('e.date >= @from')
  if (payload.to) where.push('e.date <= @to')
  return (await d
    .prepare(
      `SELECT e.*, p.name AS plant_name
       FROM cashbook_entries e LEFT JOIN plants p ON p.id = e.plant_id
       WHERE ${where.join(' AND ')} ORDER BY e.date DESC, e.id DESC`
    )
    .all(payload)) as CashEntry[]
}

/** Fund a custodian — cash given to them (increases their balance). */
export async function addCashTransfer(p: {
  holder_id: number
  amount: number
  date: string
  remarks?: string
}): Promise<CashEntry> {
  const d = getDb()
  if (!p.holder_id) throw new Error('Select a cash holder.')
  if (!(Number(p.amount) > 0)) throw new Error('Amount must be greater than 0.')
  const no = await nextNumber('CBK', 'cashbook_entry')
  const info = await d
    .prepare(
      `INSERT INTO cashbook_entries (entry_no, holder_id, kind, plant_id, category, amount, expense_id, date, remarks)
       VALUES (?, ?, 'transfer', NULL, '', ?, NULL, ?, ?)`
    )
    .run(no, p.holder_id, money(p.amount), p.date, p.remarks ?? '')
  return (await d.prepare(`SELECT * FROM cashbook_entries WHERE id = ?`).get(info.lastInsertRowid)) as CashEntry
}

/** A day-to-day expense paid from petty cash: reduces the holder's balance AND is
 *  mirrored into plant_expenses so it hits the plant's expense ledger / P&L. */
export async function addCashExpense(p: {
  holder_id: number
  plant_id: number
  category: string
  amount: number
  date: string
  remarks?: string
}): Promise<CashEntry> {
  const d = getDb()
  if (!p.holder_id) throw new Error('Select a cash holder.')
  if (!p.plant_id) throw new Error('Select the plant this expense belongs to.')
  if (!(Number(p.amount) > 0)) throw new Error('Amount must be greater than 0.')
  const category = properCase(p.category || '')
  // Mirror into plant expenses (paid from cash) so it flows to the plant P&L.
  const pe = await createPlantExpense({
    plant_id: Number(p.plant_id),
    category: 'other',
    title: category || 'Cashbook Expense',
    amount: money(p.amount),
    payment_status: 'paid',
    paid_amount: money(p.amount),
    date: p.date,
    remarks: p.remarks ?? ''
  })
  const no = await nextNumber('CBK', 'cashbook_entry')
  const info = await d
    .prepare(
      `INSERT INTO cashbook_entries (entry_no, holder_id, kind, plant_id, category, amount, expense_id, date, remarks)
       VALUES (?, ?, 'expense', ?, ?, ?, ?, ?, ?)`
    )
    .run(no, p.holder_id, Number(p.plant_id), category, money(p.amount), pe.id, p.date, p.remarks ?? '')
  return (await d.prepare(`SELECT * FROM cashbook_entries WHERE id = ?`).get(info.lastInsertRowid)) as CashEntry
}

export async function deleteCashEntry(payload: { id: number }): Promise<{ ok: boolean }> {
  const d = getDb()
  const e = (await d.prepare(`SELECT * FROM cashbook_entries WHERE id = ?`).get(payload.id)) as
    | CashEntry
    | undefined
  if (!e) return { ok: true }
  // Reverse the mirrored plant expense first, then remove the cashbook entry.
  if (e.kind === 'expense' && e.expense_id) await deletePlantExpense({ id: Number(e.expense_id) })
  await d.prepare(`DELETE FROM cashbook_entries WHERE id = ?`).run(payload.id)
  return { ok: true }
}
