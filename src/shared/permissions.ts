import type { User, ModuleKey, AccessLevel } from './types'

// Single source of truth for access control, imported by BOTH the server
// (to enforce) and the renderer (to gate nav, routes and buttons).

export interface ModuleDef {
  key: ModuleKey
  label: string
  adminOnly?: boolean
}

export const MODULES: ModuleDef[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'purchases', label: 'Purchases / Inward' },
  { key: 'production', label: 'Production' },
  { key: 'racks', label: 'Railway Racks' },
  { key: 'dispatch', label: 'Direct Sale & Delivery' },
  { key: 'movements', label: 'Stock Movements' },
  { key: 'plantExpenses', label: 'Plant Expenses' },
  { key: 'diesel', label: 'Diesel' },
  { key: 'payroll', label: 'Payroll & Employees' },
  { key: 'ledgers', label: 'Ledgers' },
  { key: 'payments', label: 'Payment Status' },
  { key: 'reports', label: 'Reports' },
  { key: 'masters', label: 'Masters (Plants, Parties, Machinery…)' },
  { key: 'settings', label: 'Settings', adminOnly: true },
  { key: 'users', label: 'Users & Activity Log', adminOnly: true }
]

// Always allowed for any (or no) session.
export const PUBLIC_METHODS = new Set(['auth.login', 'auth.me', 'auth.logout'])
// Allowed for any logged-in user (acts on their own account).
export const SELF_METHODS = new Set(['auth.changePassword'])

// method prefix (before the dot) -> module
const PREFIX_MODULE: Record<string, ModuleKey> = {
  plants: 'masters',
  locations: 'masters',
  suppliers: 'masters',
  customers: 'masters',
  products: 'masters',
  rates: 'masters',
  rateChart: 'masters',
  transportCharges: 'masters',
  transporters: 'masters',
  companies: 'masters',
  businesses: 'masters',
  outsource: 'masters',
  assets: 'masters',
  machinery: 'masters',
  parts: 'masters',
  purchases: 'purchases',
  productionSettings: 'production',
  productions: 'production',
  finished: 'production',
  dispatches: 'dispatch',
  movements: 'movements',
  racks: 'racks',
  ledgers: 'ledgers',
  payments: 'payments',
  plantExpenses: 'plantExpenses',
  budget: 'plantExpenses',
  diesel: 'diesel',
  employees: 'payroll',
  wages: 'payroll',
  dashboard: 'dashboard',
  users: 'users',
  activity: 'users'
}

// Specific methods whose module differs from their prefix's default.
const METHOD_MODULE: Record<string, ModuleKey> = {
  'system.requestDelete': 'settings',
  'system.cancelDelete': 'settings',
  'system.deleteStatus': 'settings',
  'system.setWorkdays': 'settings',
  'rates.getBusinessName': 'settings',
  'rates.setBusinessName': 'settings',
  'system.getWorkdays': 'payroll', // read by the Payroll page
  'racks.createExpenseType': 'settings',
  'racks.deleteExpenseType': 'settings'
}

export function moduleForMethod(method: string): ModuleKey | null {
  if (METHOD_MODULE[method]) return METHOD_MODULE[method]
  const prefix = method.split('.')[0]
  return PREFIX_MODULE[prefix] ?? null
}

const WRITE_VERBS = [
  'create',
  'update',
  'delete',
  'save',
  'set',
  'add',
  'transfer',
  'stock',
  'wipe',
  'remove',
  'request',
  'cancel'
]

/** True if a method mutates data (used for view-vs-edit gating and auditing). */
export function isWriteMethod(method: string): boolean {
  const action = method.split('.')[1] ?? ''
  return WRITE_VERBS.some((v) => action === v || action.startsWith(v))
}

function moduleDef(key: ModuleKey): ModuleDef | undefined {
  return MODULES.find((m) => m.key === key)
}

export function canViewModule(user: User | null, key: ModuleKey): boolean {
  if (!user) return false
  if (user.role === 'admin') return true
  if (moduleDef(key)?.adminOnly) return false
  return user.modules.includes(key)
}

export function canEditModule(user: User | null, key: ModuleKey): boolean {
  if (!user) return false
  if (user.role === 'admin') return true
  if (moduleDef(key)?.adminOnly) return false
  return Array.isArray(user.edit_modules) && user.edit_modules.includes(key)
}

/** Authoritative check: may this user call this API method? */
export function can(user: User | null, method: string): boolean {
  if (!user) return false
  if (PUBLIC_METHODS.has(method) || SELF_METHODS.has(method)) return true
  if (user.role === 'admin') return true
  const mod = moduleForMethod(method)
  if (!mod) return false // unknown method → deny for non-admins
  return isWriteMethod(method) ? canEditModule(user, mod) : canViewModule(user, mod)
}

export const STAFF_MODULES = MODULES.filter((m) => !m.adminOnly)

// Convenience presets for the Users screen (admin can still fine-tune per module).
// modules = viewable; edit_modules = also editable (subset of modules).
const ALL_STAFF = STAFF_MODULES.map((m) => m.key)
const ACCOUNTANT_MODS: ModuleKey[] = [
  'dashboard',
  'plantExpenses',
  'diesel',
  'payroll',
  'ledgers',
  'payments',
  'reports'
]
const OPERATOR_MODS: ModuleKey[] = [
  'dashboard',
  'purchases',
  'production',
  'racks',
  'dispatch',
  'movements'
]
export const ROLE_PRESETS: Record<
  string,
  { label: string; access_level: AccessLevel; modules: ModuleKey[]; edit_modules: ModuleKey[] }
> = {
  manager: {
    label: 'Manager (edit all operations, no settings/users)',
    access_level: 'edit',
    modules: ALL_STAFF,
    edit_modules: ALL_STAFF
  },
  accountant: {
    label: 'Accountant (edit accounts & reports)',
    access_level: 'edit',
    modules: ACCOUNTANT_MODS,
    edit_modules: ACCOUNTANT_MODS
  },
  operator: {
    label: 'Operator (edit stock, production, racks, sales)',
    access_level: 'edit',
    modules: OPERATOR_MODS,
    edit_modules: OPERATOR_MODS
  },
  viewer: {
    label: 'Viewer (read-only, all modules)',
    access_level: 'view',
    modules: ALL_STAFF,
    edit_modules: []
  }
}
