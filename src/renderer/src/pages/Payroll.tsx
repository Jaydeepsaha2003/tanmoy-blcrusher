import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, FileSpreadsheet } from 'lucide-react'
import { api } from '@/lib/api'
import type { WageEntry, PaymentStatus } from '@shared/types'
import { PageHeader, Page } from '@/components/layout'
import {
  Button,
  Input,
  Select,
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

const payBadge: Record<PaymentStatus, 'success' | 'warning' | 'destructive'> = {
  paid: 'success',
  partial: 'warning',
  unpaid: 'destructive'
}
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

export function Payroll(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { plantId } = usePlant()
  const [period, setPeriod] = React.useState(today().slice(0, 7))

  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })
  const { data: employees = [] } = useQuery({ queryKey: ['employees', plantId], queryFn: () => api.employees.list(plantId) })
  const { data: assets = [] } = useQuery({ queryKey: ['assets', plantId], queryFn: () => api.assets.list(plantId) })
  const filter = clean({ plant_id: plantId, period: period || undefined })
  const { data = [] } = useQuery({ queryKey: ['wages', filter], queryFn: () => api.wages.list(filter) })

  const [form, setForm] = React.useState<any>(null)
  const { data: wd } = useQuery({
    queryKey: ['workingDays', form?.period],
    queryFn: () => api.wages.workingDays(form.period),
    enabled: !!form?.period
  })
  const workingDays = wd?.working_days ?? 0

  const totals = data.reduce(
    (a, w) => {
      a.gross += w.amount
      a.paid += w.paid_amount
      return a
    },
    { gross: 0, paid: 0 }
  )

  const save = useMutation({
    mutationFn: (p: any) => (p.id ? api.wages.update(p) : api.wages.create(p)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wages'] })
      qc.invalidateQueries({ queryKey: ['ledger'] })
      qc.invalidateQueries({ queryKey: ['ledger-balances'] })
      setForm(null)
      toast.success('Wage entry saved.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  async function remove(x: WageEntry): Promise<void> {
    const ok = await confirmDialog({ title: 'Delete wage entry', message: `Delete ${x.entry_no}?` })
    if (!ok) return
    await api.wages.delete(x.id)
    qc.invalidateQueries({ queryKey: ['wages'] })
    qc.invalidateQueries({ queryKey: ['ledger'] })
    toast.success('Deleted.')
  }

  function openNew(): void {
    setForm({
      employee_id: employees[0]?.id,
      plant_id: plantId ?? plants[0]?.id,
      asset_id: null,
      period: period || today().slice(0, 7),
      days_worked: '',
      ot_hours: '',
      ot_rate: '',
      deduction: '',
      payment_status: 'unpaid',
      paid_amount: '',
      date: today(),
      remarks: ''
    })
  }

  function exportExcel(): void {
    downloadExcel(
      'payroll',
      'Payroll',
      ['Entry', 'Period', 'Employee', 'Type', 'Working Days', 'Days Worked', 'Earned', 'OT Hrs', 'OT Amt', 'Deduction', 'Net', 'Paid', 'Status'],
      data.map((w) => [
        w.entry_no, w.period, w.employee_name, w.wage_type, w.working_days, w.days_worked,
        w.earned, w.ot_hours, w.ot_amount, w.deduction, w.amount, w.paid_amount, w.payment_status
      ])
    )
  }

  const emp = form ? employees.find((e) => e.id === Number(form.employee_id)) : undefined
  const daysWorked = Number(form?.days_worked) || 0
  const earned = emp
    ? emp.wage_type === 'monthly'
      ? workingDays > 0
        ? round2((emp.monthly_salary / workingDays) * daysWorked)
        : 0
      : round2(emp.daily_wage * daysWorked)
    : 0
  const otRate = form ? (form.ot_rate === '' ? emp?.ot_rate ?? 0 : Number(form.ot_rate)) : 0
  const otAmount = round2((Number(form?.ot_hours) || 0) * otRate)
  const deduction = Number(form?.deduction) || 0
  const gross = round2(earned + otAmount)
  const net = round2(gross - deduction)

  return (
    <>
      <PageHeader
        title="Payroll"
        description="Crusher-team wages — monthly & daily, with overtime; paid wages post to the plant P&L"
        actions={
          <>
            <Button variant="outline" onClick={exportExcel} disabled={!data.length}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button onClick={openNew} disabled={!employees.length || !plants.length}>
              <Plus size={16} /> Add Wages
            </Button>
          </>
        }
      />
      <Page>
        <div className="mb-5 grid grid-cols-3 gap-3">
          <Card><CardContent className="p-4"><div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Net Wages</div><div className="tnum mt-1 text-lg font-bold">{fmtMoney(totals.gross)}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Paid</div><div className="tnum mt-1 text-lg font-bold text-success">{fmtMoney(totals.paid)}</div></CardContent></Card>
          <Card><CardContent className="p-4"><div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Outstanding</div><div className="tnum mt-1 text-lg font-bold text-destructive">{fmtMoney(totals.gross - totals.paid)}</div></CardContent></Card>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Period</span>
          <Input type="month" className="w-44" value={period} onChange={(e) => setPeriod(e.target.value)} />
          {period && <Button variant="ghost" size="sm" onClick={() => setPeriod('')}>Show all</Button>}
        </div>

        {data.length === 0 ? (
          <EmptyState message="No wage entries for this period." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Entry</TH>
                <TH>Period</TH>
                <TH>Employee</TH>
                <TH className="text-right">Days</TH>
                <TH className="text-right">Earned</TH>
                <TH className="text-right">OT</TH>
                <TH className="text-right">Net</TH>
                <TH>Payment</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {data.map((w) => (
                <TR key={w.id}>
                  <TD className="font-mono text-xs">{w.entry_no}</TD>
                  <TD>{w.period}</TD>
                  <TD className="font-medium">{w.employee_name}<span className="block text-[11px] text-muted-foreground">{w.designation}</span></TD>
                  <TD className="tnum text-right">{fmtQty(w.days_worked)}<span className="text-muted-foreground">/{fmtQty(w.working_days)}</span></TD>
                  <TD className="tnum text-right">{fmtMoney(w.earned)}</TD>
                  <TD className="tnum text-right text-muted-foreground">{w.ot_amount ? fmtMoney(w.ot_amount) : '-'}</TD>
                  <TD className="tnum text-right font-semibold">{fmtMoney(w.amount)}</TD>
                  <TD><Badge variant={payBadge[w.payment_status]}>{w.payment_status}</Badge></TD>
                  <TD className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => setForm({ ...w, ot_rate: w.ot_rate || '', deduction: w.deduction || '', paid_amount: w.paid_amount || '', days_worked: w.days_worked })}><Pencil size={15} /></Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(w)}><Trash2 size={15} className="text-destructive" /></Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Page>

      {form && (
        <Modal open onClose={() => setForm(null)} title={form.id ? `Edit ${form.entry_no}` : 'Add Wages'} width="max-w-2xl">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Employee" required>
              <Select value={form.employee_id || ''} onChange={(e) => setForm({ ...form, employee_id: Number(e.target.value) })}>
                {employees.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.wage_type === 'monthly' ? `${fmtMoney(x.monthly_salary)}/mo` : `${fmtMoney(x.daily_wage)}/day`})</option>)}
              </Select>
            </Field>
            <Field label="Pay Period" required>
              <Input type="month" value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} />
            </Field>
            <Field label="Operate Machine (optional)" hint="Rolls this wage to the machine's business">
              <Select value={form.asset_id ?? ''} onChange={(e) => setForm({ ...form, asset_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">— None —</option>
                {assets.map((a) => <option key={a.id} value={a.id}>{a.name}{a.identifier ? ` (${a.identifier})` : ''}</option>)}
              </Select>
            </Field>
            <Field label="Working Days" hint={`In ${form.period || 'month'} (excl. weekly offs)`}>
              <Input value={fmtQty(workingDays)} disabled />
            </Field>
            <Field label="Days Worked" required hint={emp?.wage_type === 'monthly' ? 'Pro-rates the monthly salary' : 'Days × daily wage'}>
              <Input type="number" step="0.5" value={form.days_worked} onChange={(e) => setForm({ ...form, days_worked: e.target.value })} />
            </Field>
            <Field label="Overtime Hours">
              <Input type="number" step="0.5" value={form.ot_hours} onChange={(e) => setForm({ ...form, ot_hours: e.target.value })} />
            </Field>
            <Field label="OT Rate / hr" hint={emp?.ot_rate ? `Default ${fmtMoney(emp.ot_rate)}` : undefined}>
              <Input type="number" step="0.01" value={form.ot_rate} onChange={(e) => setForm({ ...form, ot_rate: e.target.value })} placeholder={emp?.ot_rate ? String(emp.ot_rate) : '0'} />
            </Field>
            <Field label="Deduction / Advance">
              <Input type="number" step="0.01" value={form.deduction} onChange={(e) => setForm({ ...form, deduction: e.target.value })} />
            </Field>
            <Field label="Payment Date" required>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label="Amount Paid" hint="Sets payment status automatically">
              <Input type="number" step="0.01" value={form.paid_amount} onChange={(e) => setForm({ ...form, paid_amount: e.target.value })} />
            </Field>
            <Field label="Payment Status">
              <div className="flex h-9 items-center">
                <Badge variant={payBadge[derivePaymentStatus(net, Number(form.paid_amount) || 0)]}>
                  {derivePaymentStatus(net, Number(form.paid_amount) || 0)}
                </Badge>
              </div>
            </Field>
            <div className="col-span-2">
              <Field label="Remarks">
                <Input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
              </Field>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/60 px-4 py-2.5 text-sm">
            <span>Earned <b>{fmtMoney(earned)}</b> + OT <b>{fmtMoney(otAmount)}</b>{deduction > 0 && <> − Deduction <b>{fmtMoney(deduction)}</b></>}</span>
            <span>Net payable: <b>{fmtMoney(net)}</b></span>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
            <Button
              onClick={() => save.mutate({
                ...form,
                days_worked: daysWorked,
                ot_hours: Number(form.ot_hours) || 0,
                ot_rate: form.ot_rate === '' ? null : Number(form.ot_rate),
                deduction: deduction,
                paid_amount: Number(form.paid_amount) || 0
              })}
              disabled={!form.employee_id || !form.period || !(net > 0)}
            >
              Save
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}

function clean(f: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(f)) if (v != null && v !== '') out[k] = v
  return out
}
