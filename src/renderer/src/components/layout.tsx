import * as React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import type { ModuleKey } from '@shared/types'
import { api } from '@/lib/api'
import { usePlant } from '@/lib/plant'
import { usePerms } from '@/lib/user'
import { Modal, Input, Button, Field } from '@/components/ui'
import { useToast } from '@/components/toast'
import {
  LayoutDashboard,
  Factory,
  Warehouse,
  Users,
  PackagePlus,
  Settings2,
  Cog,
  Boxes,
  UserSquare2,
  Truck,
  TrainFront,
  BookOpen,
  Building2,
  Send,
  Wallet,
  ClipboardCheck,
  History,
  FileBarChart,
  LogOut,
  Mountain,
  KeyRound,
  Wrench,
  Receipt,
  Fuel,
  HardHat,
  Users2,
  Briefcase,
  Handshake,
  ShieldCheck,
  ScrollText,
  Package,
  Menu
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  module: ModuleKey
}
interface NavGroup {
  heading: string
  items: NavItem[]
}

export const NAV: NavGroup[] = [
  {
    heading: 'Overview',
    items: [{ to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, module: 'dashboard' }]
  },
  {
    heading: 'Raw Material',
    items: [
      { to: '/locations', label: 'Stock Locations', icon: Warehouse, module: 'masters' },
      { to: '/purchases', label: 'Purchases / Inward', icon: PackagePlus, module: 'purchases' }
    ]
  },
  {
    heading: 'Production',
    items: [
      { to: '/products', label: 'Products', icon: Package, module: 'masters' },
      { to: '/production-settings', label: 'Production Settings', icon: Settings2, module: 'production' },
      { to: '/production', label: 'Production Entry', icon: Cog, module: 'production' },
      { to: '/finished-goods', label: 'Finished Goods', icon: Boxes, module: 'production' }
    ]
  },
  {
    heading: 'Rail Dispatch',
    items: [{ to: '/racks', label: 'Railway Racks', icon: TrainFront, module: 'racks' }]
  },
  {
    heading: 'Direct Sales',
    items: [
      { to: '/dispatch', label: 'Direct Sale', icon: Send, module: 'dispatch' },
      { to: '/deliveries', label: 'Delivery Status', icon: ClipboardCheck, module: 'dispatch' }
    ]
  },
  {
    heading: 'Accounts',
    items: [
      { to: '/plant-expenses', label: 'Plant Expenses', icon: Receipt, module: 'plantExpenses' },
      { to: '/diesel', label: 'Diesel', icon: Fuel, module: 'diesel' },
      { to: '/payroll', label: 'Payroll', icon: HardHat, module: 'payroll' },
      { to: '/ledgers', label: 'Ledgers', icon: BookOpen, module: 'ledgers' },
      { to: '/payments', label: 'Payment Status', icon: Wallet, module: 'payments' }
    ]
  },
  {
    heading: 'Reports',
    items: [
      { to: '/movements', label: 'Stock Movements', icon: History, module: 'movements' },
      { to: '/reports', label: 'Reports', icon: FileBarChart, module: 'reports' }
    ]
  },
  {
    heading: 'System',
    items: [
      { to: '/plants', label: 'Plants', icon: Factory, module: 'masters' },
      { to: '/businesses', label: 'Businesses', icon: Briefcase, module: 'masters' },
      { to: '/assets', label: 'Machinery & Vehicles', icon: Wrench, module: 'masters' },
      { to: '/employees', label: 'Employees', icon: Users2, module: 'payroll' },
      { to: '/suppliers', label: 'Suppliers', icon: Users, module: 'masters' },
      { to: '/customers', label: 'Customers', icon: UserSquare2, module: 'masters' },
      { to: '/transporters', label: 'Transporters', icon: Truck, module: 'masters' },
      { to: '/companies', label: 'Companies', icon: Building2, module: 'masters' },
      { to: '/outsource', label: 'Outsource', icon: Handshake, module: 'masters' },
      { to: '/users', label: 'Users', icon: ShieldCheck, module: 'users' },
      { to: '/activity', label: 'Activity Log', icon: ScrollText, module: 'users' },
      { to: '/settings', label: 'Settings', icon: KeyRound, module: 'settings' }
    ]
  }
]

/** Nav groups filtered to the modules the current user may view. */
export function useVisibleNav(): NavGroup[] {
  const { canView } = usePerms()
  return NAV.map((g) => ({ ...g, items: g.items.filter((it) => canView(it.module)) })).filter(
    (g) => g.items.length > 0
  )
}

/** First route the current user is allowed to see (for landing redirects). */
export function useFirstAllowedPath(): string {
  const groups = useVisibleNav()
  return groups[0]?.items[0]?.to ?? '/dashboard'
}

const ROLE_BADGE: Record<string, string> = {
  admin: 'Administrator',
  staff: 'Staff'
}

export function AppShell({
  children,
  onLogout
}: {
  children: React.ReactNode
  onLogout: () => void
}): React.JSX.Element {
  const { user } = usePerms()
  const groups = useVisibleNav()
  const [navOpen, setNavOpen] = React.useState(false)
  const loc = useLocation()

  // Close the mobile drawer whenever the route changes.
  React.useEffect(() => setNavOpen(false), [loc.pathname])

  return (
    <div className="flex h-full">
      {/* Mobile drawer backdrop */}
      {navOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[260px] shrink-0 flex-col border-r bg-card transition-transform duration-200 lg:static lg:z-auto lg:w-[244px] lg:translate-x-0',
          navOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex items-center gap-3 border-b px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-sm">
            <Mountain size={21} />
          </div>
          <div>
            <div className="text-sm font-bold leading-tight">BL Crushing</div>
            <div className="text-[11px] text-muted-foreground">Stone Crusher Manager</div>
          </div>
        </div>
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {groups.map((g) => (
            <div key={g.heading}>
              <div className="px-2.5 pb-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground/80">
                {g.heading}
              </div>
              <div className="space-y-0.5">
                {g.items.map((it) => (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-all',
                        isActive
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'text-foreground/70 hover:bg-accent hover:text-accent-foreground'
                      )
                    }
                  >
                    <it.icon size={17} className="shrink-0" />
                    {it.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t p-3">
          {user && (
            <div className="mb-2 flex items-center gap-2.5 rounded-lg px-2.5 py-1.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold uppercase text-primary">
                {(user.name || user.username).slice(0, 2)}
              </div>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold leading-tight">
                  {user.name || user.username}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {ROLE_BADGE[user.role] ?? user.role}
                  {user.role !== 'admin' && ` · ${user.access_level === 'edit' ? 'Edit' : 'View only'}`}
                </div>
              </div>
            </div>
          )}
          <ChangePassword />
          <button
            onClick={onLogout}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut size={17} />
            Lock / Logout
          </button>
        </div>
      </aside>

      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="no-print flex h-12 shrink-0 items-center gap-2.5 border-b bg-card px-3 sm:px-6">
          <button
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent lg:hidden"
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <div className="flex flex-1 items-center justify-end gap-2.5">
            <span className="hidden text-xs font-medium text-muted-foreground sm:inline">Active plant</span>
            <PlantSwitcher />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </main>
    </div>
  )
}

function PlantSwitcher(): React.JSX.Element {
  const { plantId, setPlantId } = usePlant()
  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })
  return (
    <div className="relative">
      <Factory
        size={15}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <select
        value={plantId ?? ''}
        onChange={(e) => setPlantId(e.target.value ? Number(e.target.value) : undefined)}
        className="h-8 rounded-md border border-input bg-background pl-8 pr-3 text-sm font-medium shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="">All Plants</option>
        {plants.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  )
}

export function PageHeader({
  title,
  description,
  actions
}: {
  title: string
  description?: string
  actions?: React.ReactNode
}): React.JSX.Element {
  const loc = useLocation()
  return (
    <div
      key={loc.pathname}
      className="sticky top-0 z-10 flex flex-col gap-3 border-b bg-background/80 px-4 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-7"
    >
      <div>
        <h1 className="text-lg font-bold tracking-tight sm:text-xl">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Page({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="px-4 py-5 sm:px-7 sm:py-6">{children}</div>
}

/** Self-service password change, available to every signed-in user. */
function ChangePassword(): React.JSX.Element {
  const toast = useToast()
  const [open, setOpen] = React.useState(false)
  const [current, setCurrent] = React.useState('')
  const [next, setNext] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  async function submit(): Promise<void> {
    setBusy(true)
    try {
      const r = await api.auth.changePassword(current, next)
      if (r.ok) {
        toast.success('Password changed.')
        setOpen(false)
        setCurrent('')
        setNext('')
      } else toast.error(r.error || 'Could not change password.')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-foreground/70 transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <KeyRound size={17} />
        Change password
      </button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title="Change Password" width="max-w-sm">
          <div className="space-y-4">
            <Field label="Current password">
              <Input
                type="password"
                autoFocus
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </Field>
            <Field label="New password" hint="At least 4 characters">
              <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={busy || !current || next.length < 4}>
                {busy ? 'Saving…' : 'Change Password'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
