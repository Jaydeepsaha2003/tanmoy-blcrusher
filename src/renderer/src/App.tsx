import * as React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import type { ModuleKey, User } from '@shared/types'
import { api } from './lib/api'
import { UserProvider, usePerms } from './lib/user'
import { AppShell, useFirstAllowedPath } from './components/layout'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { Plants } from './pages/Plants'
import { StockLocations } from './pages/StockLocations'
import { Suppliers } from './pages/Suppliers'
import { Purchases } from './pages/Purchases'
import { ProductionSettings } from './pages/ProductionSettings'
import { ProductionEntry } from './pages/ProductionEntry'
import { FinishedGoods } from './pages/FinishedGoods'
import { Products } from './pages/Products'
import { RateChart } from './pages/RateChart'
import { Customers } from './pages/Customers'
import { Dispatch } from './pages/Dispatch'
import { DispatchQueue } from './pages/DispatchQueue'
import { Budget } from './pages/Budget'
import { Transporters } from './pages/Transporters'
import { Companies } from './pages/Companies'
import { Businesses } from './pages/Businesses'
import { OutsourceVendors } from './pages/OutsourceVendors'
import { Assets } from './pages/Assets'
import { PlantExpenses } from './pages/PlantExpenses'
import { Diesel } from './pages/Diesel'
import { Employees } from './pages/Employees'
import { Payroll } from './pages/Payroll'
import { Racks } from './pages/Racks'
import { RackDetail } from './pages/RackDetail'
import { Ledgers } from './pages/Ledgers'
import { Payments } from './pages/Payments'
import { Deliveries } from './pages/Deliveries'
import { Movements } from './pages/Movements'
import { Reports } from './pages/Reports'
import { SettingsPage } from './pages/Settings'
import { UsersPage } from './pages/Users'
import { ActivityLog } from './pages/ActivityLog'

/** Renders the page only if the user may view the module, else redirects home. */
function Guard({
  module,
  children
}: {
  module: ModuleKey
  children: React.JSX.Element
}): React.JSX.Element {
  const { canView } = usePerms()
  const home = useFirstAllowedPath()
  return canView(module) ? children : <Navigate to={home} replace />
}

function AppRoutes(): React.JSX.Element {
  const home = useFirstAllowedPath()
  return (
    <Routes>
      <Route path="/" element={<Navigate to={home} replace />} />
      <Route path="/dashboard" element={<Guard module="dashboard"><Dashboard /></Guard>} />
      <Route path="/plants" element={<Guard module="masters"><Plants /></Guard>} />
      <Route path="/locations" element={<Guard module="masters"><StockLocations /></Guard>} />
      <Route path="/suppliers" element={<Guard module="masters"><Suppliers /></Guard>} />
      <Route path="/purchases" element={<Guard module="purchases"><Purchases /></Guard>} />
      <Route path="/production-settings" element={<Guard module="production"><ProductionSettings /></Guard>} />
      <Route path="/production" element={<Guard module="production"><ProductionEntry /></Guard>} />
      <Route path="/finished-goods" element={<Guard module="production"><FinishedGoods /></Guard>} />
      <Route path="/products" element={<Guard module="masters"><Products /></Guard>} />
      <Route path="/rate-chart" element={<Guard module="masters"><RateChart /></Guard>} />
      <Route path="/customers" element={<Guard module="masters"><Customers /></Guard>} />
      <Route path="/transporters" element={<Guard module="masters"><Transporters /></Guard>} />
      <Route path="/companies" element={<Guard module="masters"><Companies /></Guard>} />
      <Route path="/businesses" element={<Guard module="masters"><Businesses /></Guard>} />
      <Route path="/outsource" element={<Guard module="masters"><OutsourceVendors /></Guard>} />
      <Route path="/assets" element={<Guard module="masters"><Assets /></Guard>} />
      <Route path="/plant-expenses" element={<Guard module="plantExpenses"><PlantExpenses /></Guard>} />
      <Route path="/diesel" element={<Guard module="diesel"><Diesel /></Guard>} />
      <Route path="/employees" element={<Guard module="payroll"><Employees /></Guard>} />
      <Route path="/payroll" element={<Guard module="payroll"><Payroll /></Guard>} />
      <Route path="/racks" element={<Guard module="racks"><Racks /></Guard>} />
      <Route path="/racks/:id" element={<Guard module="racks"><RackDetail /></Guard>} />
      <Route path="/ledgers" element={<Guard module="ledgers"><Ledgers /></Guard>} />
      <Route path="/dispatch" element={<Guard module="dispatch"><Dispatch /></Guard>} />
      <Route path="/dispatch-queue" element={<Guard module="dispatch"><DispatchQueue /></Guard>} />
      <Route path="/budget" element={<Guard module="plantExpenses"><Budget /></Guard>} />
      <Route path="/payments" element={<Guard module="payments"><Payments /></Guard>} />
      <Route path="/deliveries" element={<Guard module="dispatch"><Deliveries /></Guard>} />
      <Route path="/movements" element={<Guard module="movements"><Movements /></Guard>} />
      <Route path="/reports" element={<Guard module="reports"><Reports /></Guard>} />
      <Route path="/settings" element={<Guard module="settings"><SettingsPage /></Guard>} />
      <Route path="/users" element={<Guard module="users"><UsersPage /></Guard>} />
      <Route path="/activity" element={<Guard module="users"><ActivityLog /></Guard>} />
      <Route path="*" element={<Navigate to={home} replace />} />
    </Routes>
  )
}

export default function App(): React.JSX.Element {
  // undefined = still checking the existing session.
  const [user, setUser] = React.useState<User | null | undefined>(undefined)

  React.useEffect(() => {
    let active = true
    api.auth
      .me()
      .then((r) => active && setUser(r.user ?? null))
      .catch(() => active && setUser(null))
    const onUnauthorized = (): void => setUser(null)
    window.addEventListener('bl-unauthorized', onUnauthorized)
    return () => {
      active = false
      window.removeEventListener('bl-unauthorized', onUnauthorized)
    }
  }, [])

  async function logout(): Promise<void> {
    try {
      await api.auth.logout()
    } catch {
      /* ignore — clearing local state below is enough */
    }
    setUser(null)
  }

  if (user === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (!user) return <Login onSuccess={(u) => setUser(u)} />

  return (
    <UserProvider user={user} setUser={setUser}>
      <AppShell onLogout={logout}>
        <AppRoutes />
      </AppShell>
    </UserProvider>
  )
}
