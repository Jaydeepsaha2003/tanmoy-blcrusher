import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Wallet, BookOpen, FileSpreadsheet, HandCoins } from 'lucide-react'
import { api } from '@/lib/api'
import type { LedgerType, DueRow, PaymentDirection } from '@shared/types'
import { PageHeader, Page } from '@/components/layout'
import {
  Button,
  Input,
  Select,
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
import { fmtMoney, today, downloadExcel } from '@/lib/utils'

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

export function Payments(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const nav = useNavigate()
  const { plantId } = usePlant()
  const { data = [] } = useQuery({
    queryKey: ['allDues', plantId],
    queryFn: () => api.ledgers.allDues(plantId)
  })
  // All parties (no plant filter) for the advance/payment picker.
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers', 'all'], queryFn: () => api.suppliers.list() })
  const { data: customers = [] } = useQuery({ queryKey: ['customers', 'all'], queryFn: () => api.customers.list() })
  const { data: transporters = [] } = useQuery({ queryKey: ['transporters', 'all'], queryFn: () => api.transporters.list() })
  const { data: outsource = [] } = useQuery({ queryKey: ['outsource', 'all'], queryFn: () => api.outsource.list() })
  const { data: rackVehicles = [] } = useQuery({ queryKey: ['rackVehicles', 'all'], queryFn: () => api.rackVehicles.list() })
  const { data: rackJcbs = [] } = useQuery({ queryKey: ['rackJcbs', 'all'], queryFn: () => api.rackJcbs.list() })
  const partyList = (t: LedgerType): { id: number; name: string; head?: string }[] =>
    t === 'customer' ? customers
      : t === 'supplier' ? suppliers
        : t === 'transporter' ? transporters
          : t === 'outsource' ? outsource
            : t === 'rack_vehicle' ? rackVehicles.map((v) => ({ id: v.id, name: v.vehicle_no }))
              : t === 'rack_jcb' ? rackJcbs.map((j) => ({ id: j.id, name: j.name }))
                : []

  const [typeFilter, setTypeFilter] = React.useState<LedgerType | ''>('')
  const [statusFilter, setStatusFilter] = React.useState<'' | 'outstanding' | 'settled'>('')
  const [payForm, setPayForm] = React.useState<any>(null)

  const rows = data.filter((r) => {
    if (typeFilter && r.party_type !== typeFilter) return false
    if (statusFilter === 'outstanding' && Math.abs(r.balance) < 0.01) return false
    if (statusFilter === 'settled' && Math.abs(r.balance) >= 0.01) return false
    return true
  })

  const totalReceivable = data
    .filter((r) => r.kind === 'receivable' && r.balance > 0)
    .reduce((s, r) => s + r.balance, 0)
  const totalPayable = data
    .filter((r) => r.kind === 'payable' && r.balance > 0)
    .reduce((s, r) => s + r.balance, 0)

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

  function openPayment(r: DueRow): void {
    setPayForm({
      party_type: r.party_type,
      party_id: r.party_id,
      party_name: r.name,
      direction: (r.kind === 'receivable' ? 'in' : 'out') as PaymentDirection,
      amount: r.balance > 0 ? r.balance : '',
      mode: 'cash',
      ref: '',
      date: today(),
      remarks: ''
    })
  }

  // Record a payment or ADVANCE for any party — even one with no bills yet.
  function openAdvance(): void {
    setPayForm({
      pick: true,
      party_type: 'supplier' as LedgerType,
      party_id: 0,
      party_name: '',
      direction: 'out' as PaymentDirection,
      amount: '',
      mode: 'cash',
      ref: 'Advance',
      date: today(),
      remarks: ''
    })
  }

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
        description="All outstanding dues — customers, suppliers and transporters under one roof"
        actions={
          <>
            <Button onClick={openAdvance}>
              <HandCoins size={16} /> Record Payment / Advance
            </Button>
            <Button variant="outline" onClick={exportExcel} disabled={!rows.length}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
          </>
        }
      />
      <Page>
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="flex items-center gap-3.5 p-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><HandCoins size={21} /></div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Receivable (from customers)</div>
                <div className="tnum text-xl font-bold text-primary">{fmtMoney(totalReceivable)}</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3.5 p-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-destructive/10 text-destructive"><Wallet size={21} /></div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Payable (suppliers + transport)</div>
                <div className="tnum text-xl font-bold text-destructive">{fmtMoney(totalPayable)}</div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3.5 p-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-success/10 text-success"><Wallet size={21} /></div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Net Position</div>
                <div className={`tnum text-xl font-bold ${totalReceivable - totalPayable < 0 ? 'text-destructive' : 'text-success'}`}>{fmtMoney(totalReceivable - totalPayable)}</div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <SearchSelect
            className="w-44"
            value={typeFilter}
            onChange={(v) => setTypeFilter(v as LedgerType | '')}
            options={[{ value: '', label: 'All parties' }, ...PAY_TYPES.map((t) => ({ value: t.value, label: t.label }))]}
          />
          <SearchSelect
            className="w-44"
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as '' | 'outstanding' | 'settled')}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'outstanding', label: 'Outstanding' },
              { value: 'settled', label: 'Settled' }
            ]}
          />
        </div>

        {rows.length === 0 ? (
          <EmptyState message="No parties to show." />
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
              {rows.map((r) => (
                <TR key={`${r.party_type}-${r.party_id}`}>
                  <TD className="font-medium">{r.name}</TD>
                  <TD><Badge variant={typeBadge[r.party_type] ?? 'muted'}>{labelOf(r.party_type)}</Badge></TD>
                  <TD className="text-right">{fmtMoney(r.total_debit)}</TD>
                  <TD className="text-right">{fmtMoney(r.total_credit)}</TD>
                  <TD className={`text-right font-semibold ${r.kind === 'receivable' ? 'text-primary' : 'text-destructive'}`}>
                    {fmtMoney(Math.abs(r.balance))}
                    <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                      {r.balance > 0 ? (r.kind === 'receivable' ? 'Dr' : 'Cr') : r.balance < 0 ? 'Adv' : ''}
                    </span>
                  </TD>
                  <TD>{statusBadge(r)}</TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => openPayment(r)}>
                        <Wallet size={14} /> {r.kind === 'receivable' ? 'Receive' : 'Pay'}
                      </Button>
                      <Button variant="ghost" size="icon" title="Open ledger" onClick={() => nav('/ledgers', { state: { type: r.party_type, id: r.party_id } })}>
                        <BookOpen size={15} />
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Page>

      {payForm && (
        <Modal
          open
          onClose={() => setPayForm(null)}
          title={payForm.pick ? 'Record Payment / Advance' : `Record Payment — ${payForm.party_name}`}
        >
          <div className="space-y-4">
            {payForm.pick && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Party type">
                  <SearchSelect
                    value={payForm.party_type}
                    onChange={(v) =>
                      setPayForm({ ...payForm, party_type: v as LedgerType, party_id: 0, party_name: '' })
                    }
                    options={PAY_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                  />
                </Field>
                <Field label="Party">
                  <SearchSelect
                    value={payForm.party_id || ''}
                    onChange={(v) => {
                      const id = Number(v)
                      const p = partyList(payForm.party_type).find((x) => x.id === id)
                      setPayForm({ ...payForm, party_id: id, party_name: p?.name ?? '' })
                    }}
                    options={partyList(payForm.party_type).map((p) => ({
                      value: p.id,
                      label: `${p.name}${p.head ? ` — ${p.head}` : ''}`
                    }))}
                    placeholder={`Select ${labelOf(payForm.party_type)}…`}
                  />
                </Field>
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Direction">
                <SearchSelect
                  value={payForm.direction}
                  onChange={(v) => setPayForm({ ...payForm, direction: v })}
                  options={[
                    { value: 'in', label: 'Received from party' },
                    { value: 'out', label: 'Paid to party' }
                  ]}
                />
              </Field>
              <Field label="Amount">
                <Input type="number" step="0.01" autoFocus value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
              </Field>
              <Field label="Mode">
                <SearchSelect
                  value={payForm.mode}
                  onChange={(v) => setPayForm({ ...payForm, mode: v })}
                  options={[
                    { value: 'cash', label: 'Cash' },
                    { value: 'bank', label: 'Bank Transfer' },
                    { value: 'upi', label: 'UPI' },
                    { value: 'cheque', label: 'Cheque' },
                    { value: 'other', label: 'Other' }
                  ]}
                />
              </Field>
              <Field label="Date">
                <Input type="date" value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} />
              </Field>
            </div>
            <Field label="Reference" hint="Optional — bill no, cheque no…">
              <Input value={payForm.ref} onChange={(e) => setPayForm({ ...payForm, ref: e.target.value })} />
            </Field>
            <Field label="Remarks">
              <Input value={payForm.remarks} onChange={(e) => setPayForm({ ...payForm, remarks: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setPayForm(null)}>Cancel</Button>
              <Button
                onClick={() => savePayment.mutate({ ...payForm, amount: Number(payForm.amount) })}
                disabled={!(Number(payForm.amount) > 0) || (payForm.pick && !payForm.party_id)}
              >
                Save Payment
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
