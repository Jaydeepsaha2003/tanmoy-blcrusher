import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, FileSpreadsheet, Wrench, Banknote, Users } from 'lucide-react'
import { api } from '@/lib/api'
import type { PlantExpense, WageEntry, PaymentStatus, ExpenseCategory } from '@shared/types'
import { PageHeader, Page } from '@/components/layout'
import {
  Button,
  Input,
  SearchSelect,
  Field,
  Badge,
  Modal,
  Card,
  CardContent,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
  EmptyState
} from '@/components/ui'
import { useToast } from '@/components/toast'
import { confirmDialog } from '@/components/confirm'
import { usePlant } from '@/lib/plant'
import { derivePaymentStatus } from '@shared/types'
import { fmtMoney, fmtQty, fmtDate, today, downloadExcel } from '@/lib/utils'

type Tab = 'maintenance' | 'fixed' | 'operator'
const TABS: { key: Tab; label: string; icon: typeof Wrench }[] = [
  { key: 'maintenance', label: 'Maintenance', icon: Wrench },
  { key: 'fixed', label: 'Fixed Costs', icon: Banknote },
  { key: 'operator', label: 'Operator Salary', icon: Users }
]
const payBadge: Record<PaymentStatus, 'success' | 'warning' | 'destructive'> = {
  paid: 'success',
  partial: 'warning',
  unpaid: 'destructive'
}
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

function clean(f: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(f)) if (v != null && v !== '') out[k] = v
  return out
}

export function Maintenance(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { plantId } = usePlant()
  const [params] = useSearchParams()
  const machineParam = params.get('machine')

  const [tab, setTab] = React.useState<Tab>('maintenance')
  const [machineFilter, setMachineFilter] = React.useState<string>(machineParam ?? '')
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  const [period, setPeriod] = React.useState('')

  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })
  const { data: assets = [] } = useQuery({ queryKey: ['assets', plantId], queryFn: () => api.assets.list(plantId) })
  const { data: employees = [] } = useQuery({ queryKey: ['employees', plantId], queryFn: () => api.employees.list(plantId) })

  const machineId = machineFilter ? Number(machineFilter) : undefined
  const machineOptions = [
    { value: '', label: 'All machines & vehicles' },
    ...assets.map((a) => ({ value: String(a.id), label: `${a.name}${a.identifier ? ` (${a.identifier})` : ''}` }))
  ]

  /* ---------------- Expenses (maintenance / fixed) ---------------- */
  const category: ExpenseCategory = tab === 'fixed' ? 'fixed' : 'maintenance'
  const expFilter = clean({ category, asset_id: machineId, plant_id: plantId, from: from || undefined, to: to || undefined })
  const { data: expenses = [] } = useQuery({
    queryKey: ['machine-expenses', expFilter],
    queryFn: () => api.plantExpenses.list(expFilter),
    enabled: tab !== 'operator'
  })

  const [expForm, setExpForm] = React.useState<any>(null)
  const saveExp = useMutation({
    mutationFn: (p: any) => (p.id ? api.plantExpenses.update(p) : api.plantExpenses.create(p)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['machine-expenses'] })
      qc.invalidateQueries({ queryKey: ['expenses'] })
      qc.invalidateQueries({ queryKey: ['ledger'] })
      qc.invalidateQueries({ queryKey: ['machineSheet'] })
      qc.invalidateQueries({ queryKey: ['machineLedger'] })
      setExpForm(null)
      toast.success('Saved.')
    },
    onError: (e: Error) => toast.error(e.message)
  })
  async function removeExp(x: PlantExpense): Promise<void> {
    if (!(await confirmDialog({ title: 'Delete entry', message: `Delete ${x.expense_no}?` }))) return
    await api.plantExpenses.delete(x.id)
    qc.invalidateQueries({ queryKey: ['machine-expenses'] })
    qc.invalidateQueries({ queryKey: ['ledger'] })
    qc.invalidateQueries({ queryKey: ['machineSheet'] })
    toast.success('Deleted.')
  }
  function openNewExp(): void {
    const presetAsset = machineId ?? assets[0]?.id
    const asset = assets.find((a) => a.id === presetAsset)
    const defPlant = asset?.plant_ids?.[0] ?? plantId ?? plants[0]?.id
    setExpForm({
      category,
      asset_id: presetAsset ?? '',
      plant_id: defPlant ?? '',
      title: '',
      amount: '',
      parts: '',
      paid_amount: '',
      date: today(),
      remarks: ''
    })
  }

  /* ---------------- Operator salary (wages tagged to a machine) ---------------- */
  const wageFilter = clean({ asset_id: machineId, plant_id: plantId, period: period || undefined })
  const { data: wages = [] } = useQuery({
    queryKey: ['machine-wages', wageFilter],
    queryFn: () => api.wages.list(wageFilter),
    enabled: tab === 'operator'
  })

  const [wageForm, setWageForm] = React.useState<any>(null)
  const { data: wd } = useQuery({
    queryKey: ['workingDays', wageForm?.period],
    queryFn: () => api.wages.workingDays(wageForm.period),
    enabled: !!wageForm?.period
  })
  const workingDays = wd?.working_days ?? 0
  const saveWage = useMutation({
    mutationFn: (p: any) => (p.id ? api.wages.update(p) : api.wages.create(p)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['machine-wages'] })
      qc.invalidateQueries({ queryKey: ['wages'] })
      qc.invalidateQueries({ queryKey: ['ledger'] })
      qc.invalidateQueries({ queryKey: ['machineSheet'] })
      qc.invalidateQueries({ queryKey: ['machineLedger'] })
      setWageForm(null)
      toast.success('Operator salary saved.')
    },
    onError: (e: Error) => toast.error(e.message)
  })
  async function removeWage(x: WageEntry): Promise<void> {
    if (!(await confirmDialog({ title: 'Delete operator salary', message: `Delete ${x.entry_no}?` }))) return
    await api.wages.delete(x.id)
    qc.invalidateQueries({ queryKey: ['machine-wages'] })
    qc.invalidateQueries({ queryKey: ['ledger'] })
    qc.invalidateQueries({ queryKey: ['machineSheet'] })
    toast.success('Deleted.')
  }
  function openNewWage(): void {
    const presetAsset = machineId ?? assets[0]?.id
    const asset = assets.find((a) => a.id === presetAsset)
    const defPlant = asset?.plant_ids?.[0] ?? plantId ?? plants[0]?.id
    setWageForm({
      employee_id: employees[0]?.id ?? '',
      plant_id: defPlant ?? '',
      asset_id: presetAsset ?? '',
      period: period || today().slice(0, 7),
      days_worked: '',
      ot_hours: '',
      ot_rate: '',
      deduction: '',
      paid_amount: '',
      date: today(),
      remarks: ''
    })
  }

  // Wage preview
  const emp = wageForm ? employees.find((e) => e.id === Number(wageForm.employee_id)) : undefined
  const daysWorked = Number(wageForm?.days_worked) || 0
  const earned = emp
    ? emp.wage_type === 'monthly'
      ? workingDays > 0
        ? round2((emp.monthly_salary / workingDays) * daysWorked)
        : 0
      : round2(emp.daily_wage * daysWorked)
    : 0
  const otRate = wageForm ? (wageForm.ot_rate === '' ? emp?.ot_rate ?? 0 : Number(wageForm.ot_rate)) : 0
  const otAmount = round2((Number(wageForm?.ot_hours) || 0) * otRate)
  const wageDeduction = Number(wageForm?.deduction) || 0
  const gross = round2(earned + otAmount)
  const net = round2(gross - wageDeduction)

  // Totals for the active tab
  const expTotals = expenses.reduce((a, x) => ({ amt: a.amt + x.amount, paid: a.paid + x.paid_amount }), { amt: 0, paid: 0 })
  const wageTotals = wages.reduce((a, w) => ({ amt: a.amt + w.amount, paid: a.paid + w.paid_amount }), { amt: 0, paid: 0 })
  const totals = tab === 'operator' ? wageTotals : expTotals

  function exportExcel(): void {
    if (tab === 'operator') {
      downloadExcel(
        'operator-salary',
        'Operator Salary',
        ['Entry', 'Period', 'Employee', 'Machine', 'Days', 'Net', 'Paid', 'Status'],
        wages.map((w) => [w.entry_no, w.period, w.employee_name, w.asset_name ?? '', w.days_worked, w.amount, w.paid_amount, w.payment_status])
      )
    } else {
      downloadExcel(
        tab === 'fixed' ? 'fixed-costs' : 'maintenance',
        TABS.find((t) => t.key === tab)!.label,
        ['Ref', 'Date', 'Machine', 'Plant', 'Title', 'Amount', 'Paid', 'Status'],
        expenses.map((x) => [x.expense_no, x.date, x.asset_name ?? '', x.plant_name ?? '', x.title, x.amount, x.paid_amount, x.payment_status])
      )
    }
  }

  const newLabel = tab === 'operator' ? 'Add Salary' : tab === 'fixed' ? 'Add Fixed Cost' : 'Add Maintenance'
  const titleHint =
    tab === 'fixed' ? 'EMI, insurance premium, permit / tax, etc.' : 'What was repaired or serviced'

  return (
    <>
      <PageHeader
        title="Maintenance & Costs"
        description="Machine-wise maintenance, fixed costs and operator salary — every entry posts to the plant P&L and the machine's ledger"
        actions={
          <>
            <Button variant="outline" onClick={exportExcel} disabled={tab === 'operator' ? !wages.length : !expenses.length}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button
              onClick={tab === 'operator' ? openNewWage : openNewExp}
              disabled={!assets.length || !plants.length || (tab === 'operator' && !employees.length)}
            >
              <Plus size={16} /> {newLabel}
            </Button>
          </>
        }
      />
      <Page>
        {/* Tabs */}
        <div className="mb-4 flex flex-wrap gap-2">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={
                'inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors ' +
                (tab === key ? 'border-primary bg-primary/5 text-foreground' : 'border-input text-muted-foreground hover:bg-accent')
              }
            >
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>

        {/* Summary */}
        <div className="mb-5 grid grid-cols-3 gap-3">
          <Card><CardContent className="p-4"><div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total</div><div className="tnum mt-1 text-lg font-bold">{fmtMoney(totals.amt)}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Paid</div><div className="tnum mt-1 text-lg font-bold text-success">{fmtMoney(totals.paid)}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Outstanding</div><div className="tnum mt-1 text-lg font-bold text-destructive">{fmtMoney(totals.amt - totals.paid)}</div></CardContent></Card>
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <SearchSelect className="w-full sm:w-72" value={machineFilter} onChange={setMachineFilter} options={machineOptions} />
          {tab === 'operator' ? (
            <>
              <Input type="month" className="w-full sm:w-44" value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="Period" />
              {period && <Button variant="ghost" size="sm" onClick={() => setPeriod('')}>All periods</Button>}
            </>
          ) : (
            <>
              <Input type="date" className="w-full sm:w-36" value={from} onChange={(e) => setFrom(e.target.value)} />
              <span className="text-muted-foreground">to</span>
              <Input type="date" className="w-full sm:w-36" value={to} onChange={(e) => setTo(e.target.value)} />
              {(from || to) && <Button variant="ghost" size="sm" onClick={() => { setFrom(''); setTo('') }}>Clear</Button>}
            </>
          )}
        </div>

        {/* ---- Maintenance / Fixed table ---- */}
        {tab !== 'operator' && (
          expenses.length === 0 ? (
            <EmptyState message={`No ${tab === 'fixed' ? 'fixed-cost' : 'maintenance'} entries yet.`} />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Ref</TH>
                  <TH>Date</TH>
                  <TH>Machine / Vehicle</TH>
                  <TH>Details</TH>
                  <TH className="text-right">Amount</TH>
                  <TH>Payment</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {expenses.map((x) => (
                  <TR key={x.id}>
                    <TD className="font-mono text-xs">{x.expense_no}</TD>
                    <TD className="whitespace-nowrap">{fmtDate(x.date)}</TD>
                    <TD className="font-medium">{x.asset_name || <span className="text-muted-foreground">—</span>}<span className="block text-[11px] text-muted-foreground">{x.plant_name}</span></TD>
                    <TD>{x.title}{x.remarks && <span className="block text-[11px] text-muted-foreground">{x.remarks}</span>}</TD>
                    <TD className="tnum text-right font-semibold">{fmtMoney(x.amount)}</TD>
                    <TD><Badge variant={payBadge[x.payment_status]}>{x.payment_status}</Badge></TD>
                    <TD className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => setExpForm({ ...x, amount: x.amount, paid_amount: x.paid_amount || '', parts: x.parts || '' })}><Pencil size={15} /></Button>
                      <Button variant="ghost" size="icon" onClick={() => removeExp(x)}><Trash2 size={15} className="text-destructive" /></Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )
        )}

        {/* ---- Operator salary table ---- */}
        {tab === 'operator' && (
          wages.length === 0 ? (
            <EmptyState message="No operator salary entries yet." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Entry</TH>
                  <TH>Period</TH>
                  <TH>Operator</TH>
                  <TH>Machine / Vehicle</TH>
                  <TH className="text-right">Days</TH>
                  <TH className="text-right">Net</TH>
                  <TH>Payment</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {wages.map((w) => (
                  <TR key={w.id}>
                    <TD className="font-mono text-xs">{w.entry_no}</TD>
                    <TD>{w.period}</TD>
                    <TD className="font-medium">{w.employee_name}<span className="block text-[11px] text-muted-foreground">{w.designation}</span></TD>
                    <TD>{w.asset_name || <span className="text-muted-foreground">—</span>}</TD>
                    <TD className="tnum text-right">{fmtQty(w.days_worked)}<span className="text-muted-foreground">/{fmtQty(w.working_days)}</span></TD>
                    <TD className="tnum text-right font-semibold">{fmtMoney(w.amount)}</TD>
                    <TD><Badge variant={payBadge[w.payment_status]}>{w.payment_status}</Badge></TD>
                    <TD className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => setWageForm({ ...w, ot_rate: w.ot_rate || '', deduction: w.deduction || '', paid_amount: w.paid_amount || '', days_worked: w.days_worked })}><Pencil size={15} /></Button>
                      <Button variant="ghost" size="icon" onClick={() => removeWage(w)}><Trash2 size={15} className="text-destructive" /></Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )
        )}
      </Page>

      {/* Expense modal */}
      {expForm && (
        <Modal open onClose={() => setExpForm(null)} title={expForm.id ? `Edit ${expForm.expense_no}` : newLabel} width="max-w-2xl">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Machine / Vehicle" required>
              <SearchSelect
                value={expForm.asset_id ? String(expForm.asset_id) : ''}
                onChange={(v) => {
                  const a = assets.find((x) => x.id === Number(v))
                  setExpForm({ ...expForm, asset_id: v ? Number(v) : '', plant_id: a?.plant_ids?.[0] ?? expForm.plant_id })
                }}
                options={assets.map((a) => ({ value: String(a.id), label: `${a.name}${a.identifier ? ` (${a.identifier})` : ''}` }))}
              />
            </Field>
            <Field label="Plant" required hint="Posts to this plant's expenses">
              <SearchSelect
                value={expForm.plant_id ? String(expForm.plant_id) : ''}
                onChange={(v) => setExpForm({ ...expForm, plant_id: v ? Number(v) : '' })}
                options={plants.map((p) => ({ value: String(p.id), label: p.name }))}
              />
            </Field>
            <Field label="Date" required>
              <Input type="date" value={expForm.date} onChange={(e) => setExpForm({ ...expForm, date: e.target.value })} />
            </Field>
            <Field label="Amount" required>
              <Input type="number" step="0.01" value={expForm.amount} onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })} />
            </Field>
            <div className="sm:col-span-2">
              <Field label={tab === 'fixed' ? 'Description' : 'Work / Title'} required hint={titleHint}>
                <Input value={expForm.title} onChange={(e) => setExpForm({ ...expForm, title: e.target.value })} placeholder={tab === 'fixed' ? 'Insurance premium, EMI, road tax…' : 'Engine service, tyre change…'} />
              </Field>
            </div>
            {tab === 'maintenance' && (
              <div className="sm:col-span-2">
                <Field label="Parts used (optional)">
                  <Input value={expForm.parts} onChange={(e) => setExpForm({ ...expForm, parts: e.target.value })} placeholder="Filters, belts, oil…" />
                </Field>
              </div>
            )}
            <Field label="Amount Paid" hint="Sets payment status automatically">
              <Input type="number" step="0.01" value={expForm.paid_amount} onChange={(e) => setExpForm({ ...expForm, paid_amount: e.target.value })} />
            </Field>
            <Field label="Payment Status">
              <div className="flex h-9 items-center">
                <Badge variant={payBadge[derivePaymentStatus(Number(expForm.amount) || 0, Number(expForm.paid_amount) || 0)]}>
                  {derivePaymentStatus(Number(expForm.amount) || 0, Number(expForm.paid_amount) || 0)}
                </Badge>
              </div>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Remarks">
                <Input value={expForm.remarks} onChange={(e) => setExpForm({ ...expForm, remarks: e.target.value })} />
              </Field>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setExpForm(null)}>Cancel</Button>
            <Button
              onClick={() => saveExp.mutate({
                ...expForm,
                asset_id: Number(expForm.asset_id),
                plant_id: Number(expForm.plant_id),
                amount: Number(expForm.amount) || 0,
                paid_amount: Number(expForm.paid_amount) || 0,
                payment_status: derivePaymentStatus(Number(expForm.amount) || 0, Number(expForm.paid_amount) || 0)
              })}
              disabled={!expForm.asset_id || !expForm.plant_id || !expForm.title.trim() || !(Number(expForm.amount) > 0)}
            >
              Save
            </Button>
          </div>
        </Modal>
      )}

      {/* Operator salary modal */}
      {wageForm && (
        <Modal open onClose={() => setWageForm(null)} title={wageForm.id ? `Edit ${wageForm.entry_no}` : 'Add Operator Salary'} width="max-w-2xl">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Machine / Vehicle" required hint="Salary is charged to this machine">
              <SearchSelect
                value={wageForm.asset_id ? String(wageForm.asset_id) : ''}
                onChange={(v) => {
                  const a = assets.find((x) => x.id === Number(v))
                  setWageForm({ ...wageForm, asset_id: v ? Number(v) : '', plant_id: a?.plant_ids?.[0] ?? wageForm.plant_id })
                }}
                options={assets.map((a) => ({ value: String(a.id), label: `${a.name}${a.identifier ? ` (${a.identifier})` : ''}` }))}
              />
            </Field>
            <Field label="Operator / Driver" required>
              <SearchSelect
                value={wageForm.employee_id ? String(wageForm.employee_id) : ''}
                onChange={(v) => setWageForm({ ...wageForm, employee_id: Number(v) })}
                options={employees.map((x) => ({ value: String(x.id), label: `${x.name} (${x.wage_type === 'monthly' ? `${fmtMoney(x.monthly_salary)}/mo` : `${fmtMoney(x.daily_wage)}/day`})` }))}
              />
            </Field>
            <Field label="Plant" required>
              <SearchSelect
                value={wageForm.plant_id ? String(wageForm.plant_id) : ''}
                onChange={(v) => setWageForm({ ...wageForm, plant_id: v ? Number(v) : '' })}
                options={plants.map((p) => ({ value: String(p.id), label: p.name }))}
              />
            </Field>
            <Field label="Pay Period" required>
              <Input type="month" value={wageForm.period} onChange={(e) => setWageForm({ ...wageForm, period: e.target.value })} />
            </Field>
            <Field label="Working Days" hint={`In ${wageForm.period || 'month'} (excl. weekly offs)`}>
              <Input value={fmtQty(workingDays)} disabled />
            </Field>
            <Field label="Days Worked" required hint={emp?.wage_type === 'monthly' ? 'Pro-rates the monthly salary' : 'Days × daily wage'}>
              <Input type="number" step="0.5" value={wageForm.days_worked} onChange={(e) => setWageForm({ ...wageForm, days_worked: e.target.value })} />
            </Field>
            <Field label="Overtime Hours">
              <Input type="number" step="0.5" value={wageForm.ot_hours} onChange={(e) => setWageForm({ ...wageForm, ot_hours: e.target.value })} />
            </Field>
            <Field label="OT Rate / hr" hint={emp?.ot_rate ? `Default ${fmtMoney(emp.ot_rate)}` : undefined}>
              <Input type="number" step="0.01" value={wageForm.ot_rate} onChange={(e) => setWageForm({ ...wageForm, ot_rate: e.target.value })} placeholder={emp?.ot_rate ? String(emp.ot_rate) : '0'} />
            </Field>
            <Field label="Deduction / Advance">
              <Input type="number" step="0.01" value={wageForm.deduction} onChange={(e) => setWageForm({ ...wageForm, deduction: e.target.value })} />
            </Field>
            <Field label="Payment Date" required>
              <Input type="date" value={wageForm.date} onChange={(e) => setWageForm({ ...wageForm, date: e.target.value })} />
            </Field>
            <Field label="Amount Paid" hint="Sets payment status automatically">
              <Input type="number" step="0.01" value={wageForm.paid_amount} onChange={(e) => setWageForm({ ...wageForm, paid_amount: e.target.value })} />
            </Field>
            <Field label="Payment Status">
              <div className="flex h-9 items-center">
                <Badge variant={payBadge[derivePaymentStatus(net, Number(wageForm.paid_amount) || 0)]}>
                  {derivePaymentStatus(net, Number(wageForm.paid_amount) || 0)}
                </Badge>
              </div>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Remarks">
                <Input value={wageForm.remarks} onChange={(e) => setWageForm({ ...wageForm, remarks: e.target.value })} />
              </Field>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/60 px-4 py-2.5 text-sm">
            <span>Earned <b>{fmtMoney(earned)}</b> + OT <b>{fmtMoney(otAmount)}</b>{wageDeduction > 0 && <> − Deduction <b>{fmtMoney(wageDeduction)}</b></>}</span>
            <span>Net payable: <b>{fmtMoney(net)}</b></span>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setWageForm(null)}>Cancel</Button>
            <Button
              onClick={() => saveWage.mutate({
                ...wageForm,
                asset_id: Number(wageForm.asset_id),
                plant_id: Number(wageForm.plant_id),
                employee_id: Number(wageForm.employee_id),
                days_worked: daysWorked,
                ot_hours: Number(wageForm.ot_hours) || 0,
                ot_rate: wageForm.ot_rate === '' ? null : Number(wageForm.ot_rate),
                deduction: wageDeduction,
                paid_amount: Number(wageForm.paid_amount) || 0
              })}
              disabled={!wageForm.asset_id || !wageForm.employee_id || !wageForm.plant_id || !wageForm.period || !(net > 0)}
            >
              Save
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}
