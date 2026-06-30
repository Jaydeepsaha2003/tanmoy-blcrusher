import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Wallet, BookOpen, FileSpreadsheet, HandCoins, Search, ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { api } from '@/lib/api'
import type { LedgerType, DueRow, PaymentDirection } from '@shared/types'
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
import { usePlant } from '@/lib/plant'
import { fmtMoney, today, downloadExcel, cn } from '@/lib/utils'

const typeLabel: Partial<Record<LedgerType, string>> = {
  customer: 'Customer',
  supplier: 'Supplier',
  transporter: 'Transporter',
  outsource: 'Outsource',
  rack_vehicle: 'Vehicle',
  rack_jcb: 'JCB'
}
const labelOf = (t: LedgerType): string => typeLabel[t] ?? t
const typeBadge: Partial<Record<LedgerType, 'default' | 'warning' | 'muted'>> = {
  customer: 'default',
  supplier: 'warning',
  transporter: 'muted',
  outsource: 'muted',
  rack_vehicle: 'muted',
  rack_jcb: 'muted'
}
const PAY_TYPES: { value: LedgerType; label: string }[] = [
  { value: 'supplier', label: 'Supplier' },
  { value: 'customer', label: 'Customer' },
  { value: 'transporter', label: 'Transporter' },
  { value: 'outsource', label: 'Outsource' },
  { value: 'rack_vehicle', label: 'Vehicle' },
  { value: 'rack_jcb', label: 'JCB' }
]

const MODES = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank Transfer' },
  { value: 'upi', label: 'UPI' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'other', label: 'Other' }
]

interface PartyOpt { value: string; type: LedgerType; id: number; name: string }

export function Payments(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const nav = useNavigate()
  const { plantId } = usePlant()
  const { data = [] } = useQuery({
    queryKey: ['allDues', plantId],
    queryFn: () => api.ledgers.allDues(plantId)
  })
  // All parties (no plant filter) so any debtor/creditor — on any plant — can be paid.
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers', 'all'], queryFn: () => api.suppliers.list() })
  const { data: customers = [] } = useQuery({ queryKey: ['customers', 'all'], queryFn: () => api.customers.list() })
  const { data: transporters = [] } = useQuery({ queryKey: ['transporters', 'all'], queryFn: () => api.transporters.list() })
  const { data: outsource = [] } = useQuery({ queryKey: ['outsource', 'all'], queryFn: () => api.outsource.list() })
  const { data: rackVehicles = [] } = useQuery({ queryKey: ['rackVehicles', 'all'], queryFn: () => api.rackVehicles.list() })
  const { data: rackJcbs = [] } = useQuery({ queryKey: ['rackJcbs', 'all'], queryFn: () => api.rackJcbs.list() })

  // One combined directory of every party, for the "search any debtor or creditor" picker.
  const allParties = React.useMemo<PartyOpt[]>(() => {
    const mk = (type: LedgerType, arr: { id: number; name: string }[]): PartyOpt[] =>
      arr.map((x) => ({ value: `${type}:${x.id}`, type, id: x.id, name: x.name }))
    return [
      ...mk('customer', customers),
      ...mk('supplier', suppliers),
      ...mk('transporter', transporters),
      ...mk('outsource', outsource),
      ...rackVehicles.map((v) => ({ value: `rack_vehicle:${v.id}`, type: 'rack_vehicle' as LedgerType, id: v.id, name: v.vehicle_no })),
      ...rackJcbs.map((j) => ({ value: `rack_jcb:${j.id}`, type: 'rack_jcb' as LedgerType, id: j.id, name: j.name }))
    ]
  }, [customers, suppliers, transporters, outsource, rackVehicles, rackJcbs])

  const [q, setQ] = React.useState('')
  const [typeFilter, setTypeFilter] = React.useState<LedgerType | ''>('')
  const [statusFilter, setStatusFilter] = React.useState<'pending' | 'settled' | 'all'>('pending')
  const [payForm, setPayForm] = React.useState<any>(null)

  const rows = React.useMemo(() => {
    const term = q.trim().toLowerCase()
    return data.filter((r) => {
      if (typeFilter && r.party_type !== typeFilter) return false
      if (statusFilter === 'pending' && Math.abs(r.balance) < 0.01) return false
      if (statusFilter === 'settled' && Math.abs(r.balance) >= 0.01) return false
      if (term && !r.name.toLowerCase().includes(term)) return false
      return true
    })
  }, [data, q, typeFilter, statusFilter])

  const totalReceivable = data.filter((r) => r.kind === 'receivable' && r.balance > 0).reduce((s, r) => s + r.balance, 0)
  const totalPayable = data.filter((r) => r.kind === 'payable' && r.balance > 0).reduce((s, r) => s + r.balance, 0)
  const pendingCount = data.filter((r) => Math.abs(r.balance) >= 0.01).length

  const savePayment = useMutation({
    mutationFn: (p: any) => api.payments.add(p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['allDues'] })
      qc.invalidateQueries({ queryKey: ['ledger'] })
      qc.invalidateQueries({ queryKey: ['ledger-balances'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['transporters'] })
      setPayForm(null)
      toast.success('Payment recorded.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  /** Open the modal for a known party row, defaulting the direction to its natural side. */
  function openForRow(r: DueRow, direction: PaymentDirection): void {
    setPayForm({
      party_type: r.party_type,
      party_id: r.party_id,
      party_name: r.name,
      direction,
      amount: r.balance > 0 ? r.balance : '',
      mode: 'cash',
      ref: '',
      date: today(),
      remarks: ''
    })
  }

  /** Open the modal with the unified party search (record a payment/advance for anyone). */
  function openPicker(): void {
    setPayForm({ pick: true, party_type: '', party_id: 0, party_name: '', direction: 'out' as PaymentDirection, amount: '', mode: 'cash', ref: '', date: today(), remarks: '' })
  }

  // The balance of the party currently in the form (if it has dues on this plant).
  const formDue = payForm
    ? data.find((d) => d.party_type === payForm.party_type && d.party_id === payForm.party_id)
    : undefined

  function exportExcel(): void {
    downloadExcel(
      'payment-status',
      'Payment Status',
      ['Party', 'Type', 'Debit', 'Credit', 'Balance', 'Direction', 'Status'],
      rows.map((r) => [
        r.name, labelOf(r.party_type), r.total_debit, r.total_credit, Math.abs(r.balance),
        r.balance > 0 ? (r.kind === 'receivable' ? 'Receivable' : 'Payable') : r.balance < 0 ? 'Advance' : '—',
        Math.abs(r.balance) < 0.01 ? 'Settled' : 'Outstanding'
      ])
    )
  }

  function statusBadge(r: DueRow): React.JSX.Element {
    if (Math.abs(r.balance) < 0.01) return <Badge variant="success">Settled</Badge>
    if (r.balance < 0) return <Badge variant="muted">Advance</Badge>
    return <Badge variant={r.kind === 'receivable' ? 'default' : 'destructive'}>Outstanding</Badge>
  }

  return (
    <>
      <PageHeader
        title="Payment Status"
        description="Outstanding dues for every party — receive from customers, pay suppliers & transport, all in one place"
        actions={
          <>
            <Button onClick={openPicker}>
              <HandCoins size={16} /> Record Payment / Receipt
            </Button>
            <Button variant="outline" onClick={exportExcel} disabled={!rows.length}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
          </>
        }
      />
      <Page>
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SummaryCard tone="primary" icon={<ArrowDownLeft size={21} />} label="Receivable (from customers)" value={fmtMoney(totalReceivable)} />
          <SummaryCard tone="destructive" icon={<ArrowUpRight size={21} />} label="Payable (suppliers + transport)" value={fmtMoney(totalPayable)} />
          <SummaryCard
            tone={totalReceivable - totalPayable < 0 ? 'destructive' : 'success'}
            icon={<Wallet size={21} />}
            label="Net Position"
            value={fmtMoney(totalReceivable - totalPayable)}
          />
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-72">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search any debtor or creditor…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <SearchSelect
            className="w-40"
            value={typeFilter}
            onChange={(v) => setTypeFilter(v as LedgerType | '')}
            options={[{ value: '', label: 'All parties' }, ...PAY_TYPES.map((t) => ({ value: t.value, label: t.label }))]}
          />
          <div className="inline-flex rounded-lg border p-0.5">
            {([['pending', 'Pending'], ['settled', 'Settled'], ['all', 'All']] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  statusFilter === key ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent'
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="ml-auto text-sm text-muted-foreground">{rows.length} shown · {pendingCount} pending</span>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            message={
              statusFilter === 'pending'
                ? 'No pending dues — everyone is settled. Use “Record Payment / Receipt” to pay or receive from any party.'
                : 'No parties match your search.'
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Party</TH>
                <TH>Type</TH>
                <TH className="text-right">Debit</TH>
                <TH className="text-right">Credit</TH>
                <TH className="text-right">Balance</TH>
                <TH>Status</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => {
                const settled = Math.abs(r.balance) < 0.01
                const isReceivable = r.kind === 'receivable'
                return (
                  <TR key={`${r.party_type}-${r.party_id}`}>
                    <TD className="font-medium">{r.name}</TD>
                    <TD><Badge variant={typeBadge[r.party_type] ?? 'muted'}>{labelOf(r.party_type)}</Badge></TD>
                    <TD className="tnum text-right">{fmtMoney(r.total_debit)}</TD>
                    <TD className="tnum text-right">{fmtMoney(r.total_credit)}</TD>
                    <TD className={`tnum text-right font-semibold ${isReceivable ? 'text-primary' : 'text-destructive'}`}>
                      {fmtMoney(Math.abs(r.balance))}
                      <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                        {r.balance > 0 ? (isReceivable ? 'Dr' : 'Cr') : r.balance < 0 ? 'Adv' : ''}
                      </span>
                    </TD>
                    <TD>{statusBadge(r)}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        {isReceivable ? (
                          <Button variant="outline" size="sm" className="text-success" onClick={() => openForRow(r, 'in')}>
                            <ArrowDownLeft size={14} /> Receive
                          </Button>
                        ) : (
                          <Button variant="outline" size="sm" className="text-destructive" onClick={() => openForRow(r, 'out')}>
                            <ArrowUpRight size={14} /> Pay
                          </Button>
                        )}
                        {!settled && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title={isReceivable ? 'Record a payment instead' : 'Record a receipt instead'}
                            onClick={() => openForRow(r, isReceivable ? 'out' : 'in')}
                          >
                            {isReceivable ? 'Pay' : 'Receive'}
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" title="Open ledger" onClick={() => nav('/ledgers', { state: { type: r.party_type, id: r.party_id } })}>
                          <BookOpen size={15} />
                        </Button>
                      </div>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </Page>

      {payForm && (
        <Modal
          open
          onClose={() => setPayForm(null)}
          title={payForm.party_name ? `${payForm.direction === 'in' ? 'Receive from' : 'Pay'} ${payForm.party_name}` : 'Record Payment / Receipt'}
        >
          <div className="space-y-4">
            {/* Direction — Pay (money out) vs Receive (money in). */}
            <Field label="Type" hint="Pay = money out · Receive = money in">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPayForm({ ...payForm, direction: 'out' })}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors',
                    payForm.direction === 'out' ? 'border-destructive bg-destructive/10 text-destructive' : 'border-input text-muted-foreground hover:bg-accent'
                  )}
                >
                  <ArrowUpRight size={16} /> Pay
                </button>
                <button
                  type="button"
                  onClick={() => setPayForm({ ...payForm, direction: 'in' })}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors',
                    payForm.direction === 'in' ? 'border-success bg-success/10 text-success' : 'border-input text-muted-foreground hover:bg-accent'
                  )}
                >
                  <ArrowDownLeft size={16} /> Receive
                </button>
              </div>
            </Field>

            {payForm.pick && (
              <Field label="Party" hint="Search across customers, suppliers, transporters, vehicles & JCBs — any plant">
                <SearchSelect
                  value={payForm.party_id ? `${payForm.party_type}:${payForm.party_id}` : ''}
                  onChange={(v) => {
                    const p = allParties.find((x) => x.value === v)
                    if (p) setPayForm((f: any) => ({ ...f, party_type: p.type, party_id: p.id, party_name: p.name, direction: p.type === 'customer' ? 'in' : 'out' }))
                  }}
                  options={allParties.map((p) => ({ value: p.value, label: `${p.name} · ${labelOf(p.type)}` }))}
                  placeholder="Search a debtor or creditor…"
                />
              </Field>
            )}

            {payForm.party_id > 0 && (
              <div className="rounded-lg bg-muted/60 px-4 py-2.5 text-sm">
                {formDue && Math.abs(formDue.balance) >= 0.01 ? (
                  <>
                    Current balance: <b className={formDue.kind === 'receivable' ? 'text-primary' : 'text-destructive'}>{fmtMoney(Math.abs(formDue.balance))}</b>{' '}
                    {formDue.balance > 0 ? (formDue.kind === 'receivable' ? 'receivable' : 'payable') : 'advance'}
                    {' · '}
                    <button className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => setPayForm({ ...payForm, amount: Math.abs(formDue.balance) })}>
                      Use full amount
                    </button>
                  </>
                ) : (
                  <span className="text-muted-foreground">No dues on this plant — this will be recorded as an advance / on-account entry.</span>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Amount" required>
                <Input type="number" step="0.01" autoFocus value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} placeholder="0.00" />
              </Field>
              <Field label="Date" required>
                <Input type="date" value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} />
              </Field>
              <Field label="Mode">
                <SearchSelect value={payForm.mode} onChange={(v) => setPayForm({ ...payForm, mode: v })} options={MODES} />
              </Field>
              <Field label="Reference" hint="Bill no, cheque no…">
                <Input value={payForm.ref} onChange={(e) => setPayForm({ ...payForm, ref: e.target.value })} />
              </Field>
            </div>
            <Field label="Remarks">
              <Input value={payForm.remarks} onChange={(e) => setPayForm({ ...payForm, remarks: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setPayForm(null)}>Cancel</Button>
              <Button
                onClick={() => savePayment.mutate({ ...payForm, amount: Number(payForm.amount) })}
                disabled={!(Number(payForm.amount) > 0) || !payForm.party_id}
              >
                {payForm.direction === 'in' ? 'Save Receipt' : 'Save Payment'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

function SummaryCard({
  icon,
  label,
  value,
  tone
}: {
  icon: React.ReactNode
  label: string
  value: string
  tone: 'primary' | 'destructive' | 'success'
}): React.JSX.Element {
  const bg = tone === 'destructive' ? 'bg-destructive/10 text-destructive' : tone === 'success' ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary'
  const txt = tone === 'destructive' ? 'text-destructive' : tone === 'success' ? 'text-success' : 'text-primary'
  return (
    <Card>
      <CardContent className="flex items-center gap-3.5 p-4">
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${bg}`}>{icon}</div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className={`tnum text-xl font-bold ${txt}`}>{value}</div>
        </div>
      </CardContent>
    </Card>
  )
}
