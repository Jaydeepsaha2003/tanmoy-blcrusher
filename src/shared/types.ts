// Shared domain types used by both main (DB) and renderer (UI).

export type Status = 'active' | 'inactive'
export type PaymentStatus = 'paid' | 'unpaid' | 'partial'
export type DeliveryStatus = 'pending' | 'delivered'
export type VehicleType = 'party' | 'own' | 'rented'
export type MaterialType = 'raw' | 'finished'
export type MovementType =
  | 'opening'
  | 'purchase'
  | 'production_consume'
  | 'production_output'
  | 'dispatch'
  | 'rack_load'
  | 'transfer'
export type RackStatus = 'loading' | 'in_transit' | 'reached' | 'closed'
export type PartyType = 'customer' | 'supplier' | 'transporter' | 'outsource'
/** Ledgers exist for parties, per rack (job account), per company (roles), per plant & business (P&L). */
export type LedgerType = PartyType | 'rack' | 'company' | 'plant' | 'business'
export type AssetType = 'machine' | 'vehicle'
export type ExpenseCategory =
  | 'electricity'
  | 'maintenance'
  | 'tipper_rent'
  | 'equipment_rent'
  | 'other'
export type PaymentDirection = 'in' | 'out'

/* ---- Users & access control ---- */
export type Role = 'admin' | 'staff'
export type AccessLevel = 'view' | 'edit'
export type ModuleKey =
  | 'dashboard'
  | 'purchases'
  | 'production'
  | 'racks'
  | 'dispatch'
  | 'movements'
  | 'plantExpenses'
  | 'diesel'
  | 'payroll'
  | 'ledgers'
  | 'payments'
  | 'reports'
  | 'masters'
  | 'settings'
  | 'users'

export interface User {
  id: number
  username: string
  name: string
  role: Role
  /** Legacy/overall level kept for display; per-module edit is driven by edit_modules. */
  access_level: AccessLevel
  /** Modules the user can view (a module in edit_modules is implicitly here too). */
  modules: ModuleKey[]
  /** Modules the user can also edit (create/update/delete). Subset of modules. */
  edit_modules: ModuleKey[]
  active: number | boolean
  created_at?: string
}

export interface ActivityEntry {
  id: number
  ts: string
  user_id: number | null
  username: string
  action: string
  module: string
  method: string
  detail: string
  ip: string
}

/* ---- Units of measure ----
 * All stock is stored in cubic meters (CM). Sales can be made in any UOM.
 * 1 CM = 1.6 TON, 1 CM = 35.31 CFT.
 */
export type Uom = 'CM' | 'TON' | 'CFT'
export const UOMS: Uom[] = ['CM', 'TON', 'CFT']
export const TON_PER_CM = 1.6
export const CFT_PER_CM = 35.31

export function toCm(qty: number, uom: Uom): number {
  if (uom === 'TON') return qty / TON_PER_CM
  if (uom === 'CFT') return qty / CFT_PER_CM
  return qty
}

export function fromCm(qtyCm: number, uom: Uom): number {
  if (uom === 'TON') return qtyCm * TON_PER_CM
  if (uom === 'CFT') return qtyCm * CFT_PER_CM
  return qtyCm
}

/**
 * Title-case a name/label for consistent storage and display.
 * "brijesh ltd" -> "Brijesh Ltd", "abc traders" -> "Abc Traders".
 * Capitalizes the first letter after a space, hyphen, slash, dot, ampersand or paren;
 * collapses repeated whitespace; leaves digits untouched. Returns '' for empty input.
 */
export function properCase(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/(^|[\s\-/().&])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase())
}

/** Decide payment status from the amount paid against a total. */
export function derivePaymentStatus(total: number, paid: number): PaymentStatus {
  const t = Math.round((Number(total) + Number.EPSILON) * 100) / 100
  const p = Math.round((Number(paid) + Number.EPSILON) * 100) / 100
  if (p <= 0) return 'unpaid'
  if (p >= t - 0.01) return 'paid'
  return 'partial'
}

export interface Plant {
  id: number
  name: string
  code: string
  location: string
  status: Status
  created_at: string
}

export interface StockLocation {
  id: number
  plant_id: number
  plant_name?: string
  name: string
  opening_qty: number
  remarks: string
  created_at: string
  // computed
  purchased_qty?: number
  consumed_qty?: number
  balance_qty?: number
}

export interface Company {
  id: number
  name: string
  contact: string
  address: string
  remarks: string
  created_at: string
  // computed
  roles?: string[]
  receivable?: number
  payable?: number
  net_balance?: number
}

export interface Supplier {
  id: number
  name: string
  contact: string
  address: string
  remarks: string
  company_id: number | null
  company_name?: string
  plant_id: number | null
  plant_name?: string
  created_at: string
  // computed
  total_purchased?: number
  total_amount?: number
  paid_amount?: number
  unpaid_amount?: number
}

export interface Customer {
  id: number
  name: string
  contact: string
  address: string
  remarks: string
  company_id: number | null
  company_name?: string
  plant_id: number | null
  plant_name?: string
  created_at: string
  // computed
  total_dispatched?: number
}

export interface Purchase {
  id: number
  purchase_no: string
  supplier_id: number
  supplier_name?: string
  plant_id: number
  plant_name?: string
  stock_location_id: number
  stock_location_name?: string
  quantity: number
  rate: number | null
  amount: number | null
  paid_amount: number
  payment_status: PaymentStatus
  date: string
  remarks: string
  created_at: string
}

export interface ProductionSetting {
  id: number
  plant_id: number
  product_name: string
  output_percentage: number
}

export interface ProductionOutput {
  id: number
  production_id: number
  product_name: string
  percentage: number
  quantity: number
}

export interface Production {
  id: number
  production_no: string
  plant_id: number
  plant_name?: string
  stock_location_id: number
  stock_location_name?: string
  raw_qty: number
  date: string
  remarks: string
  created_at: string
  outputs?: ProductionOutput[]
}

export interface FinishedGood {
  plant_id: number
  plant_name: string
  product_name: string
  opening_qty: number
  produced_qty: number
  dispatched_qty: number
  loaded_qty: number
  balance_qty: number
}

export interface Transporter {
  id: number
  name: string
  contact: string
  address: string
  remarks: string
  company_id: number | null
  company_name?: string
  plant_id: number | null
  plant_name?: string
  created_at: string
  // computed
  total_trips?: number
  total_cm?: number
  total_amount?: number
  diesel_amount?: number
  paid_amount?: number
  balance_amount?: number
}

export interface Rack {
  id: number
  rack_no: string
  destination: string
  date: string
  status: RackStatus
  remarks: string
  created_at: string
  // computed
  loaded_cm?: number
  unloaded_cm?: number
  sold_cm?: number
  balance_cm?: number
  transit_shortage_cm?: number
  shortage_cm?: number
  transport_cost?: number
  expense_total?: number
  sales_amount?: number
  profit?: number
}

export interface RackLoading {
  id: number
  loading_no: string
  rack_id: number
  rack_no?: string
  plant_id: number
  plant_name?: string
  product_name: string
  transporter_id: number
  transporter_name?: string
  vehicle_no: string
  trips: number
  per_trip_cm: number
  total_cm: number
  rate: number | null
  amount: number | null
  diesel_litres: number | null
  diesel_amount: number | null
  outsourced: number
  date: string
  remarks: string
  created_at: string
}

export interface RackUnloading {
  id: number
  unloading_no: string
  rack_id: number
  rack_no?: string
  product_name: string
  transporter_id: number | null
  transporter_name?: string
  vehicle_no: string
  trips: number
  per_trip_cm: number
  total_cm: number
  qty_cm: number
  rate: number | null
  amount: number | null
  diesel_litres: number | null
  diesel_amount: number | null
  date: string
  remarks: string
  created_at: string
}

export interface RackExpense {
  id: number
  rack_id: number
  rack_no?: string
  expense_type: string
  amount: number
  date: string
  remarks: string
  created_at: string
}

export interface RackSale {
  id: number
  sale_no: string
  rack_id: number
  rack_no?: string
  customer_id: number
  customer_name?: string
  product_name: string
  uom: Uom
  quantity: number
  qty_cm: number
  rate: number | null
  amount: number | null
  truck_no: string
  date: string
  remarks: string
  created_at: string
}

export interface RackProductBalance {
  product_name: string
  loaded_cm: number
  unloaded_cm: number
  sold_cm: number
  /** loaded - unloaded: still on the rake or lost in transit */
  transit_shortage_cm: number
  /** unloaded - sold: available to sell at destination */
  balance_cm: number
}

export interface RackDetailData {
  rack: Rack
  loadings: RackLoading[]
  unloadings: RackUnloading[]
  expenses: RackExpense[]
  sales: RackSale[]
  products: RackProductBalance[]
}

export interface PaymentEntry {
  id: number
  party_type: PartyType
  party_id: number
  party_name?: string
  direction: PaymentDirection
  amount: number
  mode: string
  ref: string
  date: string
  remarks: string
  created_at: string
}

export interface LedgerEntry {
  date: string
  particulars: string
  ref: string
  debit: number
  credit: number
  balance: number
  payment_id?: number
}

export interface LedgerStatement {
  party_type: LedgerType
  party_id: number
  party_name: string
  entries: LedgerEntry[]
  total_debit: number
  total_credit: number
  closing: number
}

export interface PartyBalance {
  party_id: number
  name: string
  total_debit: number
  total_credit: number
  balance: number
}

/** A single party's outstanding position for the consolidated Payment Status screen. */
export interface DueRow {
  party_type: PartyType
  party_id: number
  name: string
  total_debit: number
  total_credit: number
  balance: number
  kind: 'payable' | 'receivable'
}

export interface Dispatch {
  id: number
  dispatch_no: string
  customer_id: number
  customer_name?: string
  plant_id: number
  plant_name?: string
  product_name: string
  uom: Uom
  quantity: number
  qty_cm: number
  rate: number | null
  amount: number | null
  transport_charge: number
  transport_billed: number
  other_charge: number
  other_billed: number
  vehicle_no: string
  vehicle_type: VehicleType
  driver: string
  challan_no: string
  outsourced: number
  delivery_status: DeliveryStatus
  payment_status: PaymentStatus
  paid_amount: number
  date: string
  remarks: string
  created_at: string
  // computed
  billed_total?: number
}

export interface StockMovement {
  id: number
  type: MovementType
  material_type: MaterialType
  ref_no: string
  plant_id: number
  plant_name?: string
  stock_location_id: number | null
  stock_location_name?: string
  product_name: string | null
  change_qty: number
  date: string
  note: string
  created_at: string
}

export interface Business {
  id: number
  name: string
  contact: string
  remarks: string
  created_at: string
}

export interface Outsource {
  id: number
  name: string
  head: string
  contact: string
  remarks: string
  created_at: string
}

export interface Asset {
  id: number
  name: string
  asset_type: AssetType
  category: string
  identifier: string
  plant_id: number | null
  plant_name?: string
  business_id: number | null
  business_name?: string
  status: Status
  remarks: string
  created_at: string
}

export interface AssetReport {
  asset_id: number
  asset_name: string
  business_name: string | null
  diesel_litres: number
  diesel_cost: number
  maintenance: number
  other_expense: number
  wages: number
  rent_income: number
  net: number
}

export interface PlantExpense {
  id: number
  expense_no: string
  plant_id: number
  plant_name?: string
  category: ExpenseCategory
  title: string
  asset_id: number | null
  asset_name?: string
  outsource_id: number | null
  outsource_name?: string
  meter_open: number | null
  meter_close: number | null
  units: number | null
  rate: number | null
  hours: number | null
  parts: string
  amount: number
  payment_status: PaymentStatus
  paid_amount: number
  date: string
  remarks: string
  created_at: string
}

export interface ExpenseCategoryTotal {
  category: ExpenseCategory
  amount: number
}

export interface DieselPurchase {
  id: number
  purchase_no: string
  supplier_id: number
  supplier_name?: string
  plant_id: number
  plant_name?: string
  litres: number
  rate: number | null
  amount: number | null
  payment_status: PaymentStatus
  paid_amount: number
  date: string
  remarks: string
  created_at: string
}

export interface DieselIssue {
  id: number
  issue_no: string
  plant_id: number
  plant_name?: string
  asset_id: number | null
  asset_name?: string
  litres: number
  date: string
  remarks: string
  created_at: string
}

export interface DieselStock {
  purchased: number
  issued: number
  balance: number
}

export type WageType = 'monthly' | 'daily'

export interface Employee {
  id: number
  name: string
  designation: string
  wage_type: WageType
  monthly_salary: number
  daily_wage: number
  ot_rate: number
  plant_id: number | null
  plant_name?: string
  contact: string
  status: Status
  remarks: string
  created_at: string
}

export interface WageEntry {
  id: number
  entry_no: string
  employee_id: number
  employee_name?: string
  designation?: string
  asset_id: number | null
  asset_name?: string
  plant_id: number
  plant_name?: string
  period: string
  wage_type: WageType
  working_days: number
  days_worked: number
  earned: number
  ot_hours: number
  ot_rate: number
  ot_amount: number
  deduction: number
  gross: number
  amount: number
  payment_status: PaymentStatus
  paid_amount: number
  date: string
  remarks: string
  created_at: string
}

export interface WorkdaySettings {
  /** Weekday indices that are weekly offs (0 = Sunday … 6 = Saturday). */
  weekly_offs: number[]
}

export interface DashboardData {
  rawTotal: number
  rawByPlant: { plant_id: number; plant_name: string; qty: number }[]
  rawByLocation: { id: number; name: string; plant_name: string; qty: number }[]
  finishedTotal: number
  finishedByPlant: { plant_id: number; plant_name: string; qty: number }[]
  finishedByProduct: { product_name: string; qty: number }[]
  totalPurchased: number
  totalConsumed: number
  totalProduced: number
  totalDispatched: number
  pendingSupplierPayment: number
  pendingDeliveries: number
  deliveredNoRate: number
  rackStockCm: number
  openRacks: number
  rackShortageCm: number
  rackSalesAmount: number
  totalRackExpenses: number
  rackTransportCost: number
  rackProfit: number
  customerReceivable: number
  transporterPayable: number
  topCustomers: { name: string; amount: number }[]
  monthlySales: { month: string; amount: number }[]
  counts: {
    plants: number
    suppliers: number
    customers: number
    transporters: number
    companies: number
    racks: number
  }
}
