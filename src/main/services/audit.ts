import { getDb } from '../db'
import { getCurrentUser } from '../context'
import type { ActivityEntry, User } from '@shared/types'
import { moduleForMethod } from '@shared/permissions'

const VERB_LABEL: Record<string, string> = {
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
  save: 'Saved',
  set: 'Updated',
  add: 'Added',
  transfer: 'Transferred',
  wipe: 'Wiped',
  remove: 'Removed'
}

const ENTITY_LABEL: Record<string, string> = {
  plants: 'plant',
  locations: 'stock location',
  suppliers: 'supplier',
  customers: 'customer',
  transporters: 'transporter',
  companies: 'company',
  businesses: 'business',
  outsource: 'outsource vendor',
  assets: 'machine/vehicle',
  purchases: 'purchase',
  productionSettings: 'production setting',
  productions: 'production',
  finished: 'finished goods',
  dispatches: 'direct sale',
  movements: 'stock',
  racks: 'rack',
  ledgers: 'ledger',
  payments: 'payment',
  plantExpenses: 'plant expense',
  diesel: 'diesel',
  employees: 'employee',
  wages: 'wage entry',
  system: 'system',
  users: 'user'
}

const SPECIFIC: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.loginFailed': 'Failed sign-in attempt',
  'auth.logout': 'Signed out',
  'auth.changePassword': 'Changed own password',
  'racks.addLoading': 'Added rack loading',
  'racks.updateLoading': 'Updated rack loading',
  'racks.deleteLoading': 'Deleted rack loading',
  'racks.addUnloading': 'Added rack unloading',
  'racks.updateUnloading': 'Updated rack unloading',
  'racks.deleteUnloading': 'Deleted rack unloading',
  'racks.addExpense': 'Added rack expense',
  'racks.addSale': 'Added rack sale',
  'racks.setStatus': 'Changed rack status',
  'movements.transfer': 'Transferred stock',
  'system.requestDelete': 'Requested data deletion (3-day)',
  'system.cancelDelete': 'Cancelled data deletion',
  'system.setWorkdays': 'Updated working-days setting',
  'dispatches.setPayment': 'Recorded sale payment',
  'dispatches.setDelivery': 'Updated delivery status',
  'dispatches.setRate': 'Set sale rate',
  'payments.add': 'Recorded payment',
  'payments.delete': 'Deleted payment',
  'finished.setOpening': 'Set opening stock'
}

function actionLabel(method: string): string {
  if (SPECIFIC[method]) return SPECIFIC[method]
  const [prefix, action = ''] = method.split('.')
  const entity = ENTITY_LABEL[prefix] ?? prefix
  for (const [verb, label] of Object.entries(VERB_LABEL)) {
    if (action === verb || action.startsWith(verb)) return `${label} ${entity}`
  }
  return method
}

// Notable, non-sensitive payload fields to summarise (never includes passwords).
const DETAIL_KEYS = [
  'id',
  'name',
  'username',
  'code',
  'dispatch_no',
  'purchase_no',
  'rack_no',
  'issue_no',
  'no',
  'product_name',
  'party_name',
  'role',
  'amount',
  'paid_amount',
  'quantity',
  'litres',
  'status',
  'delivery_status',
  'date'
]

function detailFrom(payload: unknown): string {
  if (payload == null) return ''
  if (typeof payload !== 'object') return String(payload)
  const obj = payload as Record<string, unknown>
  const parts: string[] = []
  for (const k of DETAIL_KEYS) {
    const v = obj[k]
    if (v !== undefined && v !== null && v !== '') parts.push(`${k}=${v}`)
  }
  return parts.slice(0, 6).join(', ')
}

export async function logActivity(entry: {
  method: string
  payload?: unknown
  user?: User | null
  ip?: string
}): Promise<void> {
  try {
    const me = entry.user ?? getCurrentUser()
    await getDb()
      .prepare(
        `INSERT INTO activity_log (user_id, username, action, module, method, detail, ip)
         VALUES (?,?,?,?,?,?,?)`
      )
      .run(
        me?.id ?? null,
        me?.username ?? '',
        actionLabel(entry.method),
        moduleForMethod(entry.method) ?? '',
        entry.method,
        detailFrom(entry.payload),
        entry.ip ?? ''
      )
  } catch {
    // Never let audit logging break the actual operation.
  }
}

export interface ActivityFilter {
  user_id?: number
  from?: string
  to?: string
  limit?: number
}

export async function listActivity(filter: ActivityFilter = {}): Promise<ActivityEntry[]> {
  const d = getDb()
  const where: string[] = []
  const params: Record<string, unknown> = {}
  if (filter.user_id) {
    where.push('user_id = @user_id')
    params.user_id = filter.user_id
  }
  if (filter.from) {
    where.push('date(ts) >= @from')
    params.from = filter.from
  }
  if (filter.to) {
    where.push('date(ts) <= @to')
    params.to = filter.to
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const limit = Math.min(Math.max(Number(filter.limit) || 1000, 1), 5000)
  return await d
    .prepare(`SELECT * FROM activity_log ${clause} ORDER BY id DESC LIMIT ${limit}`)
    .all(params) as ActivityEntry[]
}
