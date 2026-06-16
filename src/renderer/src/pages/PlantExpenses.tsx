import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, FileSpreadsheet, Zap, Wrench, Truck, Boxes, Receipt } from 'lucide-react'
import { api } from '@/lib/api'
import type { PlantExpense, ExpenseCategory, PaymentStatus } from '@shared/types'
import { PageHeader, Page } from '@/components/layout'
import {
  Button,
  Input,
  Select,
  Textarea,
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

const CATS: { value: ExpenseCategory; label: string; icon: typeof Zap }[] = [
  { value: 'electricity', label: 'Electricity', icon: Zap },
  { value: 'maintenance', label: 'Maintenance', icon: Wrench },
  { value: 'tipper_rent', label: 'Tipper / Own Vehicle Rent', icon: Truck },
  { value: 'equipment_rent', label: 'Rented Equipment', icon: Boxes },
  { value: 'other', label: 'Other', icon: Receipt }
]
const catLabel = (c: ExpenseCategory): string => CATS.find((x) => x.value === c)?.label ?? c
const payBadge: Record<PaymentStatus, 'success' | 'warning' | 'destructive'> = {
  paid: 'success',
  partial: 'warning',
  unpaid: 'destructive'
}
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

export function PlantExpenses(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { plantId } = usePlant()
  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })
  const { data: assets = [] } = useQuery({ queryKey: ['assets', plantId], queryFn: () => api.assets.list(plantId) })
  const { data: outsourceVendors = [] } = useQuery({ queryKey: ['outsource'], queryFn: api.outsource.list })
  const [catFilter, setCatFilter] = React.useState<ExpenseCategory | ''>('')
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')

  const filter = clean({ plant_id: plantId, category: catFilter || undefined, from: from || undefined, to: to || undefined })
  const { data = [] } = useQuery({ queryKey: ['plantExpenses', filter], queryFn: () => api.plantExpenses.list(filter) })
  const { data: totals = [] } = useQuery({
    queryKey: ['plantExpenseTotals', plantId, from, to],
    queryFn: () => api.plantExpenses.totals(clean({ plant_id: plantId, from: from || undefined, to: to || undefined }))
  })
  const grand = totals.reduce((s, t) => s + t.amount, 0)

  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState<any>(null)

  const save = useMutation({
    mutationFn: (p: any) => (p.id ? api.plantExpenses.update(p) : api.plantExpenses.create(p)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plantExpenses'] })
      qc.invalidateQueries({ queryKey: ['plantExpenseTotals'] })
      qc.invalidateQueries({ queryKey: ['ledger'] })
      qc.invalidateQueries({ queryKey: ['ledger-balances'] })
      setOpen(false)
      toast.success('Expense saved.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  function openNew(): void {
    setForm({
      plant_id: plantId ?? plants[0]?.id,
      category: 'electricity',
      title: '',
      asset_id: null,
      outsource_id: null,
      meter_open: '',
      meter_close: '',
      rate: '',
      hours: '',
      basis: 'lumpsum',
      parts: '',
      amount: '',
      payment_status: 'unpaid',
      paid_amount: '',
      date: today(),
      remarks: ''
    })
    setOpen(true)
  }

  function openEdit(x: PlantExpense): void {
    setForm({
      ...x,
      meter_open: x.meter_open ?? '',
      meter_close: x.meter_close ?? '',
      rate: x.rate ?? '',
      hours: x.hours ?? '',
      basis: x.hours != null ? 'hourly' : 'lumpsum',
      paid_amount: x.paid_amount || '',
      amount: x.amount || ''
    })
    setOpen(true)
  }

  async function remove(x: PlantExpense): Promise<void> {
    const ok = await confirmDialog({ title: 'Delete expense', message: `Delete ${x.expense_no}?` })
    if (!ok) return
    await api.plantExpenses.delete(x.id)
    qc.invalidateQueries({ queryKey: ['plantExpenses'] })
    qc.invalidateQueries({ queryKey: ['plantExpenseTotals'] })
    qc.invalidateQueries({ queryKey: ['ledger'] })
    toast.success('Expense deleted.')
  }

  function exportExcel(): void {
    downloadExcel(
      'plant-expenses',
      'Plant Expenses',
      ['Expense No', 'Date', 'Plant', 'Category', 'Details', 'Units', 'Rate', 'Amount', 'Paid', 'Status'],
      data.map((x) => [
        x.expense_no, fmtDate(x.date), x.plant_name, catLabel(x.category),
        detailText(x), x.units ?? '', x.rate ?? '', x.amount, x.paid_amount, x.payment_status
      ])
    )
  }

  const units = form ? (Number(form.meter_close) || 0) - (Number(form.meter_open) || 0) : 0
  const isRent = form && (form.category === 'tipper_rent' || form.category === 'equipment_rent')
  const rentHourly = isRent && form.basis === 'hourly'
  const computedAmount = form
    ? rentHourly
      ? round2((Number(form.hours) || 0) * (Number(form.rate) || 0))
      : Number(form.amount) || 0
    : 0

  function submit(): void {
    const p = {
      ...form,
      amount: computedAmount,
      meter_open: form.category === 'electricity' && form.meter_open !== '' ? Number(form.meter_open) : null,
      meter_close: form.category === 'electricity' && form.meter_close !== '' ? Number(form.meter_close) : null,
      rate: form.rate === '' ? null : Number(form.rate),
      hours: rentHourly && form.hours !== '' ? Number(form.hours) : null,
      paid_amount: Number(form.paid_amount) || 0,
      asset_id: form.asset_id || null
    }
    save.mutate(p)
  }

  return (
    <>
      <PageHeader
        title="Plant Expenses"
        description="Electricity, maintenance, rentals and other running costs of the plant"
        actions={
          <>
            <Button variant="outline" onClick={exportExcel} disabled={!data.length}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button onClick={openNew} disabled={!plants.length}>
              <Plus size={16} /> New Expense
            </Button>
          </>
        }
      />
      <Page>
        {/* Category totals */}
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Card>
            <CardContent className="p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total Expenses</div>
              <div className="tnum mt-1 text-lg font-bold text-destructive">{fmtMoney(grand)}</div>
            </CardContent>
          </Card>
          {CATS.map((c) => {
            const t = totals.find((x) => x.category === c.value)?.amount ?? 0
            return (
              <Card key={c.value}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <c.icon size={13} /> {c.label.split(' / ')[0]}
                  </div>
                  <div className="tnum mt-1 text-lg font-bold">{fmtMoney(t)}</div>
                </CardContent>
              </Card>
            )
          })}
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Select className="w-52" value={catFilter} onChange={(e) => setCatFilter(e.target.value as ExpenseCategory | '')}>
            <option value="">All categories</option>
            {CATS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
          <Input type="date" className="w-36" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-muted-foreground">to</span>
          <Input type="date" className="w-36" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>

        {data.length === 0 ? (
          <EmptyState message="No expenses recorded yet." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>No</TH>
                <TH>Date</TH>
                <TH>Category</TH>
                <TH>Details</TH>
                <TH className="text-right">Amount</TH>
                <TH>Payment</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {data.map((x) => (
                <TR key={x.id}>
                  <TD className="font-mono text-xs">{x.expense_no}</TD>
                  <TD>{fmtDate(x.date)}</TD>
                  <TD className="font-medium">{catLabel(x.category)}</TD>
                  <TD className="text-muted-foreground">{detailText(x)}</TD>
                  <TD className="tnum text-right font-semibold">{fmtMoney(x.amount)}</TD>
                  <TD><Badge variant={payBadge[x.payment_status]}>{x.payment_status}</Badge></TD>
                  <TD className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(x)}><Pencil size={15} /></Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(x)}><Trash2 size={15} className="text-destructive" /></Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Page>

      {form && (
        <Modal open={open} onClose={() => setOpen(false)} title={form.id ? `Edit ${form.expense_no}` : 'New Plant Expense'} width="max-w-2xl">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Plant" required hint={plantId ? 'Locked to active plant' : undefined}>
              <Select value={form.plant_id || ''} disabled={!!plantId} onChange={(e) => setForm({ ...form, plant_id: Number(e.target.value) })}>
                {plants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label="Category" required>
              <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </Select>
            </Field>

            {/* Electricity */}
            {form.category === 'electricity' && (
              <>
                <Field label="Opening Reading">
                  <Input type="number" step="0.01" value={form.meter_open} onChange={(e) => setForm({ ...form, meter_open: e.target.value })} />
                </Field>
                <Field label="Closing Reading">
                  <Input type="number" step="0.01" value={form.meter_close} onChange={(e) => setForm({ ...form, meter_close: e.target.value })} />
                </Field>
                <Field label="Units (kWh)" hint="= closing − opening">
                  <Input value={fmtQty(units)} disabled />
                </Field>
                <Field label="Rate / Unit" hint="edit rate or amount — the other auto-fills">
                  <Input
                    type="number"
                    step="0.01"
                    value={form.rate}
                    onChange={(e) => {
                      const rate = e.target.value
                      const amount = units > 0 && rate !== '' ? String(round2(units * Number(rate))) : form.amount
                      setForm({ ...form, rate, amount })
                    }}
                  />
                </Field>
                <Field label="Amount" required>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) => {
                      const amount = e.target.value
                      const rate = units > 0 && amount !== '' ? String(round2(Number(amount) / units)) : form.rate
                      setForm({ ...form, amount, rate })
                    }}
                  />
                </Field>
              </>
            )}

            {/* Maintenance */}
            {form.category === 'maintenance' && (
              <>
                <Field label="Machine / Vehicle">
                  <Select value={form.asset_id ?? ''} onChange={(e) => setForm({ ...form, asset_id: e.target.value ? Number(e.target.value) : null })}>
                    <option value="">— Select —</option>
                    {assets.map((a) => <option key={a.id} value={a.id}>{a.name}{a.identifier ? ` (${a.identifier})` : ''}</option>)}
                  </Select>
                </Field>
                <Field label="Amount" required>
                  <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                </Field>
                <div className="col-span-2">
                  <Field label="Parts / Work done (optional)">
                    <Textarea value={form.parts || ''} onChange={(e) => setForm({ ...form, parts: e.target.value })} placeholder="e.g. Jaw plate, bearings, hydraulic hose…" />
                  </Field>
                </div>
              </>
            )}

            {/* Rent (tipper / equipment) */}
            {isRent && (
              <>
                {form.category === 'equipment_rent' ? (
                  <Field label="Equipment">
                    <Input value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Excavator, JCB" />
                  </Field>
                ) : (
                  <Field label="Vehicle">
                    <Select value={form.asset_id ?? ''} onChange={(e) => setForm({ ...form, asset_id: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">— Select —</option>
                      {assets.map((a) => <option key={a.id} value={a.id}>{a.name}{a.identifier ? ` (${a.identifier})` : ''}</option>)}
                    </Select>
                  </Field>
                )}
                <Field label="Basis">
                  <Select value={form.basis} onChange={(e) => setForm({ ...form, basis: e.target.value })}>
                    <option value="lumpsum">Lump sum</option>
                    <option value="hourly">Per hour</option>
                  </Select>
                </Field>
                {rentHourly ? (
                  <>
                    <Field label="Hours">
                      <Input type="number" step="0.01" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} />
                    </Field>
                    <Field label="Rate / Hour">
                      <Input type="number" step="0.01" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
                    </Field>
                    <Field label="Amount" hint="= hours × rate">
                      <Input value={fmtMoney(computedAmount)} disabled />
                    </Field>
                  </>
                ) : (
                  <Field label="Amount" required>
                    <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                  </Field>
                )}
              </>
            )}

            {/* Other */}
            {form.category === 'other' && (
              <>
                <Field label="Expense Title" required>
                  <Input value={form.title || ''} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Office, water tanker…" />
                </Field>
                <Field label="Amount" required>
                  <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                </Field>
              </>
            )}

            <Field label="Date" required>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label="Amount Paid" hint="Sets payment status automatically">
              <Input type="number" step="0.01" value={form.paid_amount} onChange={(e) => setForm({ ...form, paid_amount: e.target.value })} />
            </Field>
            <Field label="Payment Status">
              <div className="flex h-9 items-center">
                <Badge variant={payBadge[derivePaymentStatus(computedAmount, Number(form.paid_amount) || 0)]}>
                  {derivePaymentStatus(computedAmount, Number(form.paid_amount) || 0)}
                </Badge>
              </div>
            </Field>
            <Field label="Outsourced From (optional)" hint="Posts to the vendor's ledger as payable">
              <Select value={form.outsource_id ?? ''} onChange={(e) => setForm({ ...form, outsource_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">— None —</option>
                {outsourceVendors.map((o) => <option key={o.id} value={o.id}>{o.name}{o.head ? ` (${o.head})` : ''}</option>)}
              </Select>
            </Field>
            <Field label="Remarks">
              <Input value={form.remarks || ''} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
            </Field>
          </div>

          <div className="mt-4 rounded-lg bg-muted/60 px-4 py-2.5 text-sm">
            Expense amount: <b>{fmtMoney(computedAmount)}</b>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={!form.plant_id || !(computedAmount > 0)}>Save Expense</Button>
          </div>
        </Modal>
      )}
    </>
  )
}

function detailText(x: PlantExpense): string {
  if (x.category === 'electricity') return `${fmtQty(x.units ?? 0)} units @ ${x.rate ?? 0}`
  if (x.category === 'maintenance') return [x.asset_name, x.parts].filter(Boolean).join(' — ') || '-'
  if (x.category === 'tipper_rent') return x.asset_name || x.title || 'Tipper rent'
  if (x.category === 'equipment_rent')
    return [x.title, x.hours ? `${fmtQty(x.hours)} hr` : ''].filter(Boolean).join(' · ') || 'Equipment'
  return x.title || '-'
}

function clean(f: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(f)) if (v != null && v !== '') out[k] = v
  return out
}
