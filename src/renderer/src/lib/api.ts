import type {
  Plant,
  StockLocation,
  Supplier,
  Customer,
  Purchase,
  ProductionSetting,
  Production,
  FinishedGood,
  Dispatch,
  StockMovement,
  DashboardData,
  PaymentStatus,
  DeliveryStatus,
  Transporter,
  Company,
  Rack,
  RackStatus,
  RackDetailData,
  RackLoading,
  RackUnloading,
  RackExpense,
  RackSale,
  PaymentEntry,
  LedgerStatement,
  PartyBalance,
  DueRow,
  LedgerType,
  Asset,
  PlantExpense,
  ExpenseCategoryTotal,
  DieselPurchase,
  DieselIssue,
  DieselStock,
  Employee,
  WageEntry,
  WorkdaySettings,
  Business,
  Outsource,
  AssetReport,
  User,
  ActivityEntry
} from '@shared/types'

// The app runs in two transports from the same renderer build:
//  - Electron desktop: the preload exposes window.api.call (IPC).
//  - Web browser: no preload, so we POST to the server's /api/call endpoint.
async function webCall<T>(method: string, payload?: unknown): Promise<T> {
  const res = await fetch('/api/call', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, payload })
  })
  if (res.status === 401) {
    // Session expired or missing — bounce back to the login screen.
    window.dispatchEvent(new Event('bl-unauthorized'))
    throw new Error('Your session has expired. Please log in again.')
  }
  let json: { result?: T; error?: string }
  try {
    json = await res.json()
  } catch {
    throw new Error(`Request failed (${res.status}).`)
  }
  if (!res.ok || json.error) throw new Error(json.error || `Request failed (${res.status}).`)
  return json.result as T
}

const call = <T = unknown>(method: string, payload?: unknown): Promise<T> =>
  window.api?.call ? window.api.call<T>(method, payload) : webCall<T>(method, payload)

export const api = {
  auth: {
    login: (username: string, password: string) =>
      call<{ ok: boolean; user?: User }>('auth.login', { username, password }),
    me: () => call<{ ok: boolean; user?: User | null }>('auth.me'),
    logout: () => call<{ ok: boolean }>('auth.logout'),
    changePassword: (current: string, next: string) =>
      call<{ ok: boolean; error?: string }>('auth.changePassword', { current, next })
  },
  users: {
    list: () => call<User[]>('users.list'),
    create: (p: Partial<User> & { password?: string }) => call<User>('users.create', p),
    update: (p: Partial<User> & { password?: string }) => call<User>('users.update', p),
    delete: (id: number) => call<{ ok: boolean; error?: string }>('users.delete', { id })
  },
  activity: {
    list: (filter?: { user_id?: number; from?: string; to?: string; limit?: number }) =>
      call<ActivityEntry[]>('activity.list', filter ?? {})
  },
  plants: {
    list: () => call<Plant[]>('plants.list'),
    create: (p: Partial<Plant>) => call<Plant>('plants.create', p),
    update: (p: Partial<Plant>) => call<Plant>('plants.update', p),
    delete: (id: number) => call<{ ok: boolean; error?: string }>('plants.delete', { id })
  },
  locations: {
    list: (plant_id?: number) => call<StockLocation[]>('locations.list', { plant_id }),
    create: (p: Partial<StockLocation>) => call<StockLocation>('locations.create', p),
    update: (p: Partial<StockLocation>) => call<StockLocation>('locations.update', p),
    delete: (id: number) => call<{ ok: boolean; error?: string }>('locations.delete', { id })
  },
  suppliers: {
    list: (plant_id?: number) => call<Supplier[]>('suppliers.list', { plant_id }),
    create: (p: Partial<Supplier>) => call<Supplier>('suppliers.create', p),
    update: (p: Partial<Supplier>) => call<Supplier>('suppliers.update', p),
    delete: (id: number) => call<{ ok: boolean; error?: string }>('suppliers.delete', { id })
  },
  customers: {
    list: (plant_id?: number) => call<Customer[]>('customers.list', { plant_id }),
    create: (p: Partial<Customer>) => call<Customer>('customers.create', p),
    update: (p: Partial<Customer>) => call<Customer>('customers.update', p),
    delete: (id: number) => call<{ ok: boolean; error?: string }>('customers.delete', { id })
  },
  purchases: {
    list: (filter?: Record<string, unknown>) => call<Purchase[]>('purchases.list', filter),
    create: (p: unknown) => call<Purchase>('purchases.create', p),
    update: (p: unknown) => call<Purchase>('purchases.update', p),
    delete: (id: number) => call<{ ok: boolean; error?: string }>('purchases.delete', { id }),
    setPayment: (id: number, paid_amount: number, payment_status: PaymentStatus) =>
      call<Purchase>('purchases.setPayment', { id, paid_amount, payment_status })
  },
  productionSettings: {
    list: (plant_id: number) => call<ProductionSetting[]>('productionSettings.list', { plant_id }),
    save: (plant_id: number, items: { product_name: string; output_percentage: number }[]) =>
      call<{ ok: boolean; error?: string }>('productionSettings.save', { plant_id, items })
  },
  productions: {
    list: (filter?: Record<string, unknown>) => call<Production[]>('productions.list', filter),
    preview: (plant_id: number, raw_qty: number) =>
      call<{ product_name: string; percentage: number; quantity: number }[]>(
        'productions.preview',
        { plant_id, raw_qty }
      ),
    create: (p: unknown) => call<Production>('productions.create', p),
    delete: (id: number) => call<{ ok: boolean; error?: string }>('productions.delete', { id })
  },
  finished: {
    list: (filter?: Record<string, unknown>) => call<FinishedGood[]>('finished.list', filter),
    available: (plant_id: number) =>
      call<{ product_name: string; balance_qty: number }[]>('finished.available', { plant_id }),
    setOpening: (plant_id: number, product_name: string, opening_qty: number) =>
      call<{ ok: boolean }>('finished.setOpening', { plant_id, product_name, opening_qty })
  },
  dispatches: {
    list: (filter?: Record<string, unknown>) => call<Dispatch[]>('dispatches.list', filter),
    create: (p: unknown) => call<Dispatch>('dispatches.create', p),
    update: (p: unknown) => call<Dispatch>('dispatches.update', p),
    setRate: (id: number, rate: number) => call<Dispatch>('dispatches.setRate', { id, rate }),
    setDelivery: (id: number, delivery_status: DeliveryStatus) =>
      call<Dispatch>('dispatches.setDelivery', { id, delivery_status }),
    setPayment: (id: number, paid_amount: number, payment_status: PaymentStatus) =>
      call<Dispatch>('dispatches.setPayment', { id, paid_amount, payment_status }),
    delete: (id: number) => call<{ ok: boolean; error?: string }>('dispatches.delete', { id })
  },
  movements: {
    list: (filter?: Record<string, unknown>) => call<StockMovement[]>('movements.list', filter),
    transfer: (p: {
      from_location_id: number
      to_location_id: number
      quantity: number
      date: string
      note?: string
    }) => call<{ ok: boolean }>('movements.transfer', p),
    deleteTransfer: (ref_no: string) =>
      call<{ ok: boolean }>('movements.deleteTransfer', { ref_no })
  },
  transporters: {
    list: (plant_id?: number) => call<Transporter[]>('transporters.list', { plant_id }),
    create: (p: Partial<Transporter>) => call<Transporter>('transporters.create', p),
    update: (p: Partial<Transporter>) => call<Transporter>('transporters.update', p),
    delete: (id: number) => call<{ ok: boolean; error?: string }>('transporters.delete', { id })
  },
  companies: {
    list: () => call<Company[]>('companies.list'),
    create: (p: Partial<Company>) => call<Company>('companies.create', p),
    update: (p: Partial<Company>) => call<Company>('companies.update', p),
    delete: (id: number) => call<{ ok: boolean; error?: string }>('companies.delete', { id })
  },
  racks: {
    list: (filter?: Record<string, unknown>) => call<Rack[]>('racks.list', filter),
    create: (p: Partial<Rack>) => call<Rack>('racks.create', p),
    update: (p: Partial<Rack>) => call<Rack>('racks.update', p),
    setStatus: (id: number, status: RackStatus) => call<Rack>('racks.setStatus', { id, status }),
    delete: (id: number) => call<{ ok: boolean; error?: string }>('racks.delete', { id }),
    detail: (id: number) => call<RackDetailData>('racks.detail', { id }),
    addLoading: (p: unknown) => call<RackLoading>('racks.addLoading', p),
    updateLoading: (p: unknown) => call<RackLoading>('racks.updateLoading', p),
    deleteLoading: (id: number) =>
      call<{ ok: boolean; error?: string }>('racks.deleteLoading', { id }),
    addUnloading: (p: unknown) => call<RackUnloading>('racks.addUnloading', p),
    updateUnloading: (p: unknown) => call<RackUnloading>('racks.updateUnloading', p),
    deleteUnloading: (id: number) =>
      call<{ ok: boolean; error?: string }>('racks.deleteUnloading', { id }),
    expenseTypes: () => call<string[]>('racks.expenseTypes'),
    createExpenseType: (name: string) =>
      call<{ ok: boolean; error?: string }>('racks.createExpenseType', { name }),
    deleteExpenseType: (name: string) =>
      call<{ ok: boolean }>('racks.deleteExpenseType', { name }),
    addExpense: (p: unknown) => call<RackExpense>('racks.addExpense', p),
    updateExpense: (p: unknown) => call<RackExpense>('racks.updateExpense', p),
    deleteExpense: (id: number) => call<{ ok: boolean }>('racks.deleteExpense', { id }),
    listExpenses: (filter?: Record<string, unknown>) =>
      call<RackExpense[]>('racks.listExpenses', filter),
    addSale: (p: unknown) => call<RackSale>('racks.addSale', p),
    updateSale: (p: unknown) => call<RackSale>('racks.updateSale', p),
    deleteSale: (id: number) => call<{ ok: boolean }>('racks.deleteSale', { id }),
    listSales: (filter?: Record<string, unknown>) => call<RackSale[]>('racks.listSales', filter)
  },
  ledgers: {
    get: (party_type: LedgerType, party_id: number, from?: string, to?: string) =>
      call<LedgerStatement>('ledgers.get', { party_type, party_id, from, to }),
    balances: (party_type: LedgerType, plant_id?: number) =>
      call<PartyBalance[]>('ledgers.balances', { party_type, plant_id }),
    allDues: (plant_id?: number) => call<DueRow[]>('ledgers.allDues', { plant_id })
  },
  payments: {
    add: (p: unknown) => call<PaymentEntry>('payments.add', p),
    list: (filter?: Record<string, unknown>) => call<PaymentEntry[]>('payments.list', filter),
    delete: (id: number) => call<{ ok: boolean }>('payments.delete', { id })
  },
  assets: {
    list: (plant_id?: number) => call<Asset[]>('assets.list', { plant_id }),
    create: (p: Partial<Asset>) => call<Asset>('assets.create', p),
    update: (p: Partial<Asset>) => call<Asset>('assets.update', p),
    delete: (id: number) => call<{ ok: boolean; error?: string }>('assets.delete', { id }),
    report: (id: number) => call<AssetReport>('assets.report', { id })
  },
  businesses: {
    list: () => call<Business[]>('businesses.list'),
    create: (p: Partial<Business>) => call<Business>('businesses.create', p),
    update: (p: Partial<Business>) => call<Business>('businesses.update', p),
    delete: (id: number) => call<{ ok: boolean; error?: string }>('businesses.delete', { id })
  },
  outsource: {
    list: () => call<Outsource[]>('outsource.list'),
    create: (p: Partial<Outsource>) => call<Outsource>('outsource.create', p),
    update: (p: Partial<Outsource>) => call<Outsource>('outsource.update', p),
    delete: (id: number) => call<{ ok: boolean; error?: string }>('outsource.delete', { id })
  },
  plantExpenses: {
    list: (filter?: Record<string, unknown>) => call<PlantExpense[]>('plantExpenses.list', filter),
    totals: (filter?: Record<string, unknown>) =>
      call<ExpenseCategoryTotal[]>('plantExpenses.totals', filter),
    create: (p: unknown) => call<PlantExpense>('plantExpenses.create', p),
    update: (p: unknown) => call<PlantExpense>('plantExpenses.update', p),
    delete: (id: number) => call<{ ok: boolean }>('plantExpenses.delete', { id })
  },
  diesel: {
    stock: (plant_id?: number) => call<DieselStock>('diesel.stock', { plant_id }),
    purchases: (filter?: Record<string, unknown>) =>
      call<DieselPurchase[]>('diesel.purchases', filter),
    createPurchase: (p: unknown) => call<DieselPurchase>('diesel.createPurchase', p),
    updatePurchase: (p: unknown) => call<DieselPurchase>('diesel.updatePurchase', p),
    deletePurchase: (id: number) =>
      call<{ ok: boolean; error?: string }>('diesel.deletePurchase', { id }),
    issues: (filter?: Record<string, unknown>) => call<DieselIssue[]>('diesel.issues', filter),
    createIssue: (p: unknown) => call<DieselIssue>('diesel.createIssue', p),
    updateIssue: (p: unknown) => call<DieselIssue>('diesel.updateIssue', p),
    deleteIssue: (id: number) => call<{ ok: boolean }>('diesel.deleteIssue', { id }),
    byAsset: (plant_id?: number) =>
      call<{ asset_id: number | null; asset_name: string; litres: number }[]>('diesel.byAsset', { plant_id })
  },
  employees: {
    list: (plant_id?: number) => call<Employee[]>('employees.list', { plant_id }),
    create: (p: Partial<Employee>) => call<Employee>('employees.create', p),
    update: (p: Partial<Employee>) => call<Employee>('employees.update', p),
    delete: (id: number) => call<{ ok: boolean; error?: string }>('employees.delete', { id })
  },
  wages: {
    list: (filter?: Record<string, unknown>) => call<WageEntry[]>('wages.list', filter),
    workingDays: (period: string) => call<{ working_days: number }>('wages.workingDays', { period }),
    create: (p: unknown) => call<WageEntry>('wages.create', p),
    update: (p: unknown) => call<WageEntry>('wages.update', p),
    delete: (id: number) => call<{ ok: boolean }>('wages.delete', { id })
  },
  system: {
    wipeData: (password: string) =>
      call<{ ok: boolean; error?: string }>('system.wipeData', { password }),
    getWorkdays: () => call<WorkdaySettings>('system.getWorkdays'),
    setWorkdays: (weekly_offs: number[]) =>
      call<{ ok: boolean }>('system.setWorkdays', { weekly_offs })
  },
  dashboard: {
    get: (plant_id?: number) => call<DashboardData>('dashboard.get', { plant_id })
  }
}
