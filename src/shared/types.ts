// Shared domain types used by both main (DB) and renderer (UI).

export type Status = 'active' | 'inactive'
export type PaymentStatus = 'paid' | 'unpaid' | 'partial'
export type DeliveryStatus = 'pending' | 'delivered'
export type DispatchStatus = 'pending' | 'dispatched'
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
 * Defaults: 1 CM = 1.6 TON, 1 CM = 35.31 CFT. Each plant can override these
 * factors (e.g. a denser aggregate weighs more per m³) — see UomFactors.
 */
export type Uom = 'CM' | 'TON' | 'CFT'
export const UOMS: Uom[] = ['CM', 'TON', 'CFT']
export const TON_PER_CM = 1.6
export const CFT_PER_CM = 35.31

/** Per-plant conversion factors. Falls back to the defaults above when unset. */
export interface UomFactors {
  ton_per_cm?: number | null
  cft_per_cm?: number | null
}

function tonFactor(f?: UomFactors): number {
  const v = Number(f?.ton_per_cm)
  return v > 0 ? v : TON_PER_CM
}
function cftFactor(f?: UomFactors): number {
  const v = Number(f?.cft_per_cm)
  return v > 0 ? v : CFT_PER_CM
}

export function toCm(qty: number, uom: Uom, f?: UomFactors): number {
  if (uom === 'TON') return qty / tonFactor(f)
  if (uom === 'CFT') return qty / cftFactor(f)
  return qty
}

export function fromCm(qtyCm: number, uom: Uom, f?: UomFactors): number {
  if (uom === 'TON') return qtyCm * tonFactor(f)
  if (uom === 'CFT') return qtyCm * cftFactor(f)
  return qtyCm
}

/**
 * Normalize a name/identifier for consistent storage and display. Per business
 * preference all names are stored in UPPERCASE; whitespace is collapsed.
 * "brijesh ltd" -> "BRIJESH LTD". Returns '' for empty input.
 * (Kept named properCase as it's the single name-normalizer used app-wide.)
 */
export function properCase(s: string | null | undefined): string {
  if (!s) return ''
  return s.trim().replace(/\s+/g, ' ').toUpperCase()
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
  /** Bulk density: tonnes per m³ (used to convert TON↔m³). Default 1.6. */
  ton_per_cm: number
  /** Cubic feet per m³ (geometric; default 35.31). Editable per plant. */
  cft_per_cm: number
  created_at: string
}

/** Products are a global master list (shared across all plants). */
export interface Product {
  id: number
  name: string
  description: string
  status: Status
  created_at: string
}

export interface CustomerRate {
  id: number
  customer_id: number
  product_name: string
  uom: Uom
  rate: number
  updated_at?: string
}

export type RateTier = 'wholesale' | 'retail' | 'customer'
export type TransportBasis = 'trip' | 'cm' | 'ton'

/** A row in the advanced rate chart: a product at a location, priced per tier. */
export interface RateChartRow {
  id?: number
  product_name: string
  stock_location_id: number
  stock_location_name?: string
  plant_name?: string
  uom: Uom
  rate_wholesale: number
  rate_retail: number
  rate_customer: number
  updated_at?: string
}

/** A transport charge for a vehicle/lorry type at a location. */
export interface TransportCharge {
  id?: number
  vehicle_type: string
  stock_location_id: number
  stock_location_name?: string
  plant_name?: string
  basis: TransportBasis
  charge: number
  updated_at?: string
}

/** Data backing the public, no-login rate page shared with a customer. */
export interface PublicRateList {
  customer_name: string
  business_name: string
  updated_at: string | null
  rates: { product_name: string; uom: Uom; rate: number }[]
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
  /** Random token for the public, no-login rate-list URL (/rates/:token). */
  share_token?: string | null
  created_at: string
  // computed
  total_dispatched?: number
}

export type PurchaseMode = 'purchase' | 'mining'
export type MachineBasis = 'hour' | 'cm'

/** A transporter line on a purchase (transport for bringing the material in). */
export interface PurchaseTransporter {
  id?: number
  purchase_id?: number
  transporter_id: number
  transporter_name?: string
  vehicle_no: string
  charge: number
}

/** A machine-usage line on a purchase/mining; cost posts as a plant equipment-rent cost. */
export interface PurchaseMachine {
  id?: number
  purchase_id?: number
  asset_id: number
  asset_name?: string
  basis: MachineBasis
  qty: number
  rate: number
  amount: number
  outsource_id: number | null
  outsource_name?: string
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
  /** 'raw' = raw material into a location; 'finished' = a product into finished-goods stock. */
  material_type: MaterialType
  /** 'purchase' = buy from supplier; 'mining' = extract from supplier's land (royalty). */
  purchase_mode: PurchaseMode
  /** Product name when material_type = 'finished' (else ''). */
  product_name: string
  /** Loaded on detail: transporter and machine lines. */
  transporters?: PurchaseTransporter[]
  machines?: PurchaseMachine[]
  transport_total?: number
  machine_total?: number
  /** Optional outsource vendor this purchase came through. */
  outsource_id: number | null
  outsource_name?: string
  outsource_head?: string
  uom: Uom
  quantity: number
  qty_cm: number
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
  purchased_qty: number
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

/** A one-time opening balance for a party ledger; FY carry-forward is computed. */
export interface OpeningBalance {
  id?: number
  party_type: LedgerType
  party_id: number
  amount: number
  direction: 'debit' | 'credit'
  as_of_date: string
  remarks: string
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
  /** Actual quantity dispatched from the plant (drives stock). Always entered. */
  quantity: number
  qty_cm: number
  /** Quantity actually sold/received at destination (added later). null = not set yet. */
  sale_quantity: number | null
  rate: number | null
  amount: number | null
  transport_charge: number
  transport_billed: number
  other_charge: number
  other_billed: number
  vehicle_no: string
  vehicle_type: VehicleType
  /** Optional transporter who carried the goods; links the transporter ledger. */
  transporter_id: number | null
  transporter_name?: string
  driver: string
  challan_no: string
  outsourced: number
  /** When outsourced, the outsource vendor the material came from. */
  outsource_id: number | null
  outsource_name?: string
  outsource_head?: string
  delivery_status: DeliveryStatus
  /** Dispatch workflow stage, independent of delivery. */
  dispatch_status: DispatchStatus
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

/** One head's planned-vs-actual line in a plant budget. */
export interface BudgetItem {
  head: string
  label: string
  budget: number
  actual: number
  variance: number
}

export interface BudgetReport {
  plant_id: number
  from: string
  to: string
  items: BudgetItem[]
  total_budget: number
  total_actual: number
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
