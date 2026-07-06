import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Coins, ArrowDownLeft, ArrowUpRight, NotebookText } from 'lucide-react'
import { api } from '@/lib/api'
import type { CashHolder, CashEntry, Plant } from '@shared/types'
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
  EmptyState,
  PlantCheckboxes
} from '@/components/ui'
import { useToast } from '@/components/toast'
import { confirmDialog } from '@/components/confirm'
import { usePlant } from '@/lib/plant'
import { fmtMoney, fmtDate, today } from '@/lib/utils'

export function Cashbook(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { plantId } = usePlant()
  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })
  const { data: employees = [] } = useQuery({ queryKey: ['employees', 'all'], queryFn: () => api.employees.list() })
  const { data: holders = [] } = useQuery({ queryKey: ['cashHolders', plantId], queryFn: () => api.cashbook.holders(plantId) })

  const [hForm, setHForm] = React.useState<any>(null)
  const [entriesFor, setEntriesFor] = React.useState<CashHolder | null>(null)

  const totalInHand = holders.reduce((s, h) => s + (h.balance ?? 0), 0)

  const saveHolder = useMutation({
    mutationFn: (p: any) => (p.id ? api.cashbook.updateHolder(p) : api.cashbook.createHolder(p)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cashHolders'] }); setHForm(null); toast.success('Cash holder saved.') },
    onError: (e: Error) => toast.error(e.message)
  })

  async function removeHolder(h: CashHolder): Promise<void> {
    if (!(await confirmDialog({ title: 'Delete cash holder', message: `Delete "${h.name}"?` }))) return
    const res = await api.cashbook.deleteHolder(h.id)
    if (res.ok) { qc.invalidateQueries({ queryKey: ['cashHolders'] }); toast.success('Deleted.') }
    else toast.error(res.error || 'Could not delete.')
  }

  const plantNames = (ids?: number[]): string =>
    (ids ?? []).length ? (ids ?? []).map((id) => plants.find((p) => p.id === id)?.name ?? '').filter(Boolean).join(', ') : 'All plants'

  function newHolder(): void {
    setHForm({ name: '', employee_id: null, opening_balance: '', remarks: '', plant_ids: plantId ? [plantId] : [] })
  }
  function togglePlant(id: number): void {
    const cur: number[] = hForm.plant_ids ?? []
    setHForm({ ...hForm, plant_ids: cur.includes(id) ? cur.filter((x: number) => x !== id) : [...cur, id] })
  }

  return (
    <>
      <PageHeader
        title="Cashbook"
        description="Site petty-cash custodians — fund them, log day-to-day expenses (posted to the plant's expense ledger) and track each person's cash in hand"
        actions={
          <Button onClick={newHolder} disabled={!plants.length}>
            <Plus size={16} /> New Cash Holder
          </Button>
        }
      />
      <Page>
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="flex items-center gap-3.5 p-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><Coins size={21} /></div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total Cash in Hand</div>
                <div className="tnum text-xl font-bold text-primary">{fmtMoney(totalInHand)}</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3.5 p-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-success/10 text-success"><ArrowDownLeft size={21} /></div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total Transferred In</div>
                <div className="tnum text-xl font-bold text-success">{fmtMoney(holders.reduce((s, h) => s + (h.total_in ?? 0), 0))}</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3.5 p-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-destructive/10 text-destructive"><ArrowUpRight size={21} /></div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total Expenses</div>
                <div className="tnum text-xl font-bold text-destructive">{fmtMoney(holders.reduce((s, h) => s + (h.total_expense ?? 0), 0))}</div>
              </div>
            </CardContent>
          </Card>
        </div>

        {holders.length === 0 ? (
          <EmptyState message="No cash holders yet. Add a manager or employee who handles site petty cash." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Cash Holder</TH>
                <TH>Plants</TH>
                <TH className="text-right">Opening</TH>
                <TH className="text-right">Transferred In</TH>
                <TH className="text-right">Expenses</TH>
                <TH className="text-right">Cash in Hand</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {holders.map((h) => (
                <TR key={h.id}>
                  <TD className="font-medium">{h.name}</TD>
                  <TD className="text-muted-foreground">{plantNames(h.plant_ids)}</TD>
                  <TD className="tnum text-right">{fmtMoney(h.opening_balance)}</TD>
                  <TD className="tnum text-right text-success">{fmtMoney(h.total_in)}</TD>
                  <TD className="tnum text-right text-destructive">{fmtMoney(h.total_expense)}</TD>
                  <TD className={`tnum text-right font-semibold ${(h.balance ?? 0) < 0 ? 'text-destructive' : ''}`}>{fmtMoney(h.balance)}</TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => setEntriesFor(h)}><NotebookText size={14} /> Cashbook</Button>
                      <Button variant="ghost" size="icon" onClick={() => setHForm({ ...h, opening_balance: h.opening_balance ?? '', plant_ids: h.plant_ids ?? [] })}><Pencil size={15} /></Button>
                      <Button variant="ghost" size="icon" onClick={() => removeHolder(h)}><Trash2 size={15} className="text-destructive" /></Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Page>

      {/* Holder modal */}
      {hForm && (
        <Modal open onClose={() => setHForm(null)} title={hForm.id ? `Edit ${hForm.name}` : 'New Cash Holder'} width="max-w-lg">
          <div className="space-y-4">
            <Field label="Link an employee" hint="Optional — pick an employee, or just type a name below for a manager">
              <SearchSelect
                value={hForm.employee_id ?? ''}
                onChange={(v) => {
                  const id = v ? Number(v) : null
                  const emp = employees.find((e) => e.id === id)
                  setHForm({ ...hForm, employee_id: id, name: emp ? emp.name : hForm.name })
                }}
                options={[{ value: '', label: '— None (type a name) —' }, ...employees.map((e) => ({ value: e.id, label: `${e.name}${e.designation ? ` · ${e.designation}` : ''}` }))]}
                placeholder="Select employee…"
              />
            </Field>
            <Field label="Name" required>
              <Input value={hForm.name} onChange={(e) => setHForm({ ...hForm, name: e.target.value })} placeholder="e.g. Site Manager / person's name" />
            </Field>
            <Field label="Opening Balance (₹)" hint="Cash already in hand when you start tracking">
              <Input type="number" step="0.01" value={hForm.opening_balance} onChange={(e) => setHForm({ ...hForm, opening_balance: e.target.value })} placeholder="0.00" />
            </Field>
            <Field label="Plants" hint="Plants this person handles cash for — leave all unticked for every plant">
              <PlantCheckboxes plants={plants} selected={hForm.plant_ids ?? []} onToggle={togglePlant} />
            </Field>
            <Field label="Remarks">
              <Input value={hForm.remarks || ''} onChange={(e) => setHForm({ ...hForm, remarks: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setHForm(null)}>Cancel</Button>
              <Button onClick={() => saveHolder.mutate({ ...hForm, opening_balance: Number(hForm.opening_balance) || 0 })} disabled={!hForm.name?.trim()}>Save</Button>
            </div>
          </div>
        </Modal>
      )}

      {entriesFor && (
        <EntriesModal holder={entriesFor} plants={plants} onClose={() => setEntriesFor(null)} onChanged={() => qc.invalidateQueries({ queryKey: ['cashHolders'] })} />
      )}
    </>
  )
}

/** Per-holder cashbook: running balance, funding transfers and day-to-day expenses. */
function EntriesModal({
  holder,
  plants,
  onClose,
  onChanged
}: {
  holder: CashHolder
  plants: Plant[]
  onClose: () => void
  onChanged: () => void
}): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const [form, setForm] = React.useState<any>(null)
  const { data: entries = [] } = useQuery({ queryKey: ['cashEntries', holder.id], queryFn: () => api.cashbook.entries(holder.id) })

  // Plants this holder handles (fall back to all when common).
  const holderPlants = (holder.plant_ids ?? []).length ? plants.filter((p) => (holder.plant_ids ?? []).includes(p.id)) : plants

  const totalIn = entries.filter((e) => e.kind === 'transfer').reduce((s, e) => s + e.amount, 0)
  const totalOut = entries.filter((e) => e.kind === 'expense').reduce((s, e) => s + e.amount, 0)
  const balance = (holder.opening_balance || 0) + totalIn - totalOut

  const refresh = (): void => {
    qc.invalidateQueries({ queryKey: ['cashEntries', holder.id] })
    onChanged()
  }
  const save = useMutation({
    mutationFn: (p: any) =>
      p.kind === 'transfer'
        ? api.cashbook.addTransfer({ holder_id: holder.id, amount: Number(p.amount), date: p.date, remarks: p.remarks })
        : api.cashbook.addExpense({ holder_id: holder.id, plant_id: Number(p.plant_id), category: p.category, amount: Number(p.amount), date: p.date, remarks: p.remarks }),
    onSuccess: () => { refresh(); setForm(null); toast.success('Entry recorded.') },
    onError: (e: Error) => toast.error(e.message)
  })
  async function remove(e: CashEntry): Promise<void> {
    if (!(await confirmDialog({ title: 'Delete entry', message: `Delete this ${e.kind}?${e.kind === 'expense' ? ' The linked plant expense will be removed too.' : ''}` }))) return
    await api.cashbook.deleteEntry(e.id)
    refresh()
    toast.success('Deleted.')
  }

  function startTransfer(): void { setForm({ kind: 'transfer', amount: '', date: today(), remarks: '' }) }
  function startExpense(): void { setForm({ kind: 'expense', plant_id: holderPlants[0]?.id, category: '', amount: '', date: today(), remarks: '' }) }

  return (
    <Modal open onClose={onClose} title={`Cashbook — ${holder.name}`} width="max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-muted/60 px-4 py-3">
        <div className="text-sm">Cash in hand: <b className={balance < 0 ? 'text-destructive' : 'text-primary'}>{fmtMoney(balance)}</b></div>
        <div className="text-xs text-muted-foreground">Opening {fmtMoney(holder.opening_balance)} + In {fmtMoney(totalIn)} − Expenses {fmtMoney(totalOut)}</div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" className="text-success" onClick={startTransfer}><ArrowDownLeft size={14} /> Add Transfer</Button>
          <Button size="sm" variant="outline" className="text-destructive" onClick={startExpense}><ArrowUpRight size={14} /> Add Expense</Button>
        </div>
      </div>

      {form && (
        <div className="mb-4 rounded-lg border p-4">
          <div className="mb-3 text-sm font-semibold">{form.kind === 'transfer' ? 'Transfer cash to this person' : 'Record a day-to-day expense'}</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {form.kind === 'expense' && (
              <>
                <Field label="Plant" hint="Which plant's expense ledger this hits">
                  <SearchSelect value={form.plant_id || ''} onChange={(v) => setForm({ ...form, plant_id: Number(v) })} options={holderPlants.map((p) => ({ value: p.id, label: p.name }))} placeholder="Select plant…" />
                </Field>
                <Field label="Category" hint="e.g. Tea, Labour, Repair, Transport">
                  <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Category" />
                </Field>
              </>
            )}
            <Field label="Amount (₹)" required>
              <Input type="number" step="0.01" autoFocus value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
            </Field>
            <Field label="Date" required>
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field label="Remarks" className={form.kind === 'expense' ? 'sm:col-span-2' : undefined}>
              <Input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
            </Field>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setForm(null)}>Cancel</Button>
            <Button
              size="sm"
              onClick={() => save.mutate(form)}
              disabled={!(Number(form.amount) > 0) || (form.kind === 'expense' && (!form.plant_id || !form.category.trim()))}
            >
              {form.kind === 'transfer' ? 'Save Transfer' : 'Save Expense'}
            </Button>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <EmptyState message="No entries yet. Transfer cash in, then log expenses as they happen." />
      ) : (
        <div className="max-h-[50vh] overflow-y-auto">
          <Table>
            <THead>
              <TR>
                <TH>Date</TH>
                <TH>Type</TH>
                <TH>Plant · Category</TH>
                <TH>Remarks</TH>
                <TH className="text-right">Amount</TH>
                <TH className="text-right"></TH>
              </TR>
            </THead>
            <TBody>
              {entries.map((e) => (
                <TR key={e.id}>
                  <TD className="whitespace-nowrap">{fmtDate(e.date)}</TD>
                  <TD>{e.kind === 'transfer' ? <Badge variant="success">Transfer In</Badge> : <Badge variant="destructive">Expense</Badge>}</TD>
                  <TD className="text-muted-foreground">{e.kind === 'expense' ? [e.plant_name, e.category].filter(Boolean).join(' · ') : '—'}</TD>
                  <TD className="text-muted-foreground">{e.remarks || '-'}</TD>
                  <TD className={`tnum text-right font-semibold ${e.kind === 'transfer' ? 'text-success' : 'text-destructive'}`}>
                    {e.kind === 'transfer' ? '+' : '−'}{fmtMoney(e.amount)}
                  </TD>
                  <TD className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => remove(e)}><Trash2 size={14} className="text-destructive" /></Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </Modal>
  )
}
