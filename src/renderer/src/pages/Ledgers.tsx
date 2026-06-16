import * as React from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, FileSpreadsheet, ArrowLeft, Printer } from 'lucide-react'
import { api } from '@/lib/api'
import type { LedgerType } from '@shared/types'
import { PageHeader, Page } from '@/components/layout'
import {
  Button,
  Input,
  Select,
  Field,
  Badge,
  Modal,
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
import { fmtMoney, fmtDate, today, downloadExcel } from '@/lib/utils'

const partyLabel: Record<LedgerType, string> = {
  customer: 'Customer',
  supplier: 'Supplier',
  transporter: 'Transporter',
  outsource: 'Outsource',
  rack: 'Rack',
  company: 'Company',
  plant: 'Plant',
  business: 'Business'
}
const balanceLabel: Record<LedgerType, string> = {
  customer: 'Receivable',
  supplier: 'Payable',
  transporter: 'Payable',
  outsource: 'Payable',
  rack: 'Profit / (Loss)',
  company: 'Net Balance',
  plant: 'Net (Profit / Loss)',
  business: 'Net (Profit / Loss)'
}

/** Red/green semantics differ per ledger: dues are red, rack/plant/business profit / net receivable green-ish. */
function balanceClass(t: LedgerType, v: number): string {
  if (t === 'rack' || t === 'plant' || t === 'business') return v >= 0 ? 'text-success' : 'text-destructive'
  if (t === 'company') return v >= 0 ? 'text-primary' : 'text-destructive'
  return v > 0 ? 'text-destructive' : 'text-success'
}

/** Tally-style Dr/Cr tag. Customer/company balances are debit-positive; supplier/transporter/outsource credit-positive. */
function drcr(t: LedgerType, v: number): string {
  if (t === 'rack' || t === 'plant' || t === 'business' || Math.abs(v) < 0.005) return ''
  const debitPositive = t === 'customer' || t === 'company'
  return (debitPositive ? v > 0 : v < 0) ? 'Dr' : 'Cr'
}

export function Ledgers(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const initial = (useLocation().state ?? {}) as { type?: LedgerType; id?: number }
  const [partyType, setPartyType] = React.useState<LedgerType>(initial.type ?? 'customer')
  const [partyId, setPartyId] = React.useState<number | undefined>(initial.id)
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  const [payForm, setPayForm] = React.useState<any>(null)

  const { data: balances = [] } = useQuery({
    queryKey: ['ledger-balances', partyType],
    queryFn: () => api.ledgers.balances(partyType)
  })
  const { data: ledger } = useQuery({
    queryKey: ['ledger', partyType, partyId, from, to],
    queryFn: () => api.ledgers.get(partyType, partyId!, from || undefined, to || undefined),
    enabled: !!partyId
  })

  function refresh(): void {
    qc.invalidateQueries({ queryKey: ['ledger'] })
    qc.invalidateQueries({ queryKey: ['ledger-balances'] })
    qc.invalidateQueries({ queryKey: ['transporters'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const savePayment = useMutation({
    mutationFn: (p: any) => api.payments.add(p),
    onSuccess: () => {
      refresh()
      setPayForm(null)
      toast.success('Payment recorded.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  async function removePayment(paymentId: number): Promise<void> {
    const ok = await confirmDialog({
      title: 'Delete payment',
      message: 'Delete this payment entry? The ledger balance will change.'
    })
    if (!ok) return
    await api.payments.delete(paymentId)
    refresh()
    toast.success('Payment deleted.')
  }

  function switchType(t: LedgerType): void {
    setPartyType(t)
    setPartyId(undefined)
  }

  function openPayment(): void {
    setPayForm({
      party_type: partyType,
      party_id: partyId,
      direction: partyType === 'customer' ? 'in' : 'out',
      amount: '',
      mode: 'cash',
      ref: '',
      date: today(),
      remarks: ''
    })
  }

  function exportExcel(): void {
    if (!ledger) return
    const period = `${from ? fmtDate(from) : 'Beginning'} to ${to ? fmtDate(to) : 'Date'}`
    const title: (string | number)[][] = [
      [`${ledger.party_name} — ${partyLabel[partyType]} Ledger`],
      [`Period: ${period}`],
      [`Closing ${balanceLabel[partyType]}: ${fmtMoney(Math.abs(ledger.closing))} ${drcr(partyType, ledger.closing)}`]
    ]
    const rows: (string | number)[][] = ledger.entries.map((e) => [
      fmtDate(e.date),
      e.particulars,
      e.ref,
      e.debit || '',
      e.credit || '',
      `${fmtMoney(Math.abs(e.balance))} ${drcr(partyType, e.balance)}`.trim()
    ])
    rows.push([
      '',
      'TOTAL',
      '',
      ledger.total_debit,
      ledger.total_credit,
      `${fmtMoney(Math.abs(ledger.closing))} ${drcr(partyType, ledger.closing)}`.trim()
    ])
    downloadExcel(
      `ledger-${partyType}-${ledger.party_name}`,
      `${partyLabel[partyType]} Ledger`,
      ['Date', 'Particulars', 'Vch No.', 'Debit', 'Credit', 'Balance'],
      rows,
      title
    )
  }

  const selected = balances.find((b) => b.party_id === partyId)

  return (
    <>
      <PageHeader
        title="Ledgers"
        description="Account statements — customers, suppliers, transporters, racks and companies"
        actions={
          partyId ? (
            <>
              <Button variant="outline" className="no-print" onClick={() => window.print()} disabled={!ledger?.entries.length}>
                <Printer size={16} /> Print
              </Button>
              <Button variant="outline" className="no-print" onClick={exportExcel} disabled={!ledger?.entries.length}>
                <FileSpreadsheet size={16} /> Excel
              </Button>
              {partyType !== 'rack' && partyType !== 'company' && partyType !== 'plant' && partyType !== 'business' && (
                <Button className="no-print" onClick={openPayment}>
                  <Plus size={16} /> Record Payment
                </Button>
              )}
            </>
          ) : undefined
        }
      />
      <Page>
        <div className="no-print mb-4 flex flex-wrap items-center gap-2">
          <Select className="w-full sm:w-44" value={partyType} onChange={(e) => switchType(e.target.value as LedgerType)}>
            <option value="customer">Customers</option>
            <option value="supplier">Suppliers</option>
            <option value="transporter">Transporters</option>
            <option value="outsource">Outsource Vendors</option>
            <option value="company">Companies</option>
            <option value="business">Businesses (P&amp;L)</option>
            <option value="plant">Plants (P&amp;L)</option>
            <option value="rack">Racks</option>
          </Select>
          <Select
            className="w-full sm:w-56"
            value={partyId ?? ''}
            onChange={(e) => setPartyId(e.target.value ? Number(e.target.value) : undefined)}
          >
            <option value="">— Select {partyLabel[partyType].toLowerCase()} —</option>
            {balances.map((b) => (
              <option key={b.party_id} value={b.party_id}>{b.name}</option>
            ))}
          </Select>
          {partyId && (
            <>
              <Input type="date" className="w-full sm:w-36" value={from} onChange={(e) => setFrom(e.target.value)} />
              <span className="text-muted-foreground">to</span>
              <Input type="date" className="w-full sm:w-36" value={to} onChange={(e) => setTo(e.target.value)} />
              <Button variant="ghost" size="sm" onClick={() => setPartyId(undefined)}>
                <ArrowLeft size={15} /> All {partyLabel[partyType].toLowerCase()}s
              </Button>
            </>
          )}
        </div>

        {!partyId ? (
          balances.length === 0 ? (
            <EmptyState message={`No ${partyLabel[partyType].toLowerCase()}s yet.`} />
          ) : (
            <>
              <div className="mb-3 text-sm text-muted-foreground">
                {balances.length} {partyLabel[partyType].toLowerCase()}
                {balances.length === 1 ? '' : 's'} · Total {balanceLabel[partyType]}:{' '}
                <span className="font-semibold text-foreground">{fmtMoney(balances.reduce((s, b) => s + b.balance, 0))}</span>
              </div>
            <Table>
              <THead>
                <TR>
                  <TH>{partyLabel[partyType]}</TH>
                  <TH className="text-right">Total Debit</TH>
                  <TH className="text-right">Total Credit</TH>
                  <TH className="text-right">{balanceLabel[partyType]}</TH>
                </TR>
              </THead>
              <TBody>
                {balances.map((b) => (
                  <TR key={b.party_id} className="cursor-pointer" onClick={() => setPartyId(b.party_id)}>
                    <TD className="font-medium">{b.name}</TD>
                    <TD className="text-right">{fmtMoney(b.total_debit)}</TD>
                    <TD className="text-right">{fmtMoney(b.total_credit)}</TD>
                    <TD className={`tnum text-right font-semibold ${balanceClass(partyType, b.balance)}`}>
                      {fmtMoney(Math.abs(b.balance))}
                      <span className="ml-1 text-[11px] font-normal text-muted-foreground">{drcr(partyType, b.balance)}</span>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            </>
          )
        ) : (
          <>
            {/* Tally-style ledger header band */}
            <div className="print-area mb-4 flex flex-col gap-3 rounded-xl border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold">{selected?.name ?? ledger?.party_name}</h2>
                  <Badge variant="muted">{partyLabel[partyType]}</Badge>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Ledger Account
                  {from || to ? ` · ${from ? fmtDate(from) : 'start'} to ${to ? fmtDate(to) : 'date'}` : ' · All transactions'}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Closing — {balanceLabel[partyType]}
                </div>
                <div className={`tnum text-2xl font-bold ${balanceClass(partyType, ledger?.closing ?? 0)}`}>
                  {fmtMoney(Math.abs(ledger?.closing ?? 0))}
                  <span className="ml-1.5 text-sm font-medium">{drcr(partyType, ledger?.closing ?? 0)}</span>
                </div>
              </div>
            </div>

            {!ledger || ledger.entries.length === 0 ? (
              <EmptyState message="No transactions for this party in the selected period." />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Date</TH>
                    <TH>Particulars</TH>
                    <TH>Vch No.</TH>
                    <TH className="text-right">Debit</TH>
                    <TH className="text-right">Credit</TH>
                    <TH className="text-right">Balance</TH>
                    <TH className="text-right"></TH>
                  </TR>
                </THead>
                <TBody>
                  {ledger.entries.map((e, i) => {
                    const opening = e.particulars === 'Opening balance'
                    return (
                      <TR key={i} className={opening ? 'bg-muted/30' : ''}>
                        <TD className="whitespace-nowrap">{fmtDate(e.date)}</TD>
                        <TD className={opening ? 'italic text-muted-foreground' : 'font-medium'}>{e.particulars}</TD>
                        <TD className="font-mono text-xs text-muted-foreground">{e.ref || '-'}</TD>
                        <TD className="tnum text-right">{e.debit ? fmtMoney(e.debit) : '-'}</TD>
                        <TD className="tnum text-right">{e.credit ? fmtMoney(e.credit) : '-'}</TD>
                        <TD className="tnum text-right font-semibold">
                          {fmtMoney(Math.abs(e.balance))}
                          <span className="ml-1 text-[11px] font-normal text-muted-foreground">{drcr(partyType, e.balance)}</span>
                        </TD>
                        <TD className="text-right">
                          {e.payment_id && (
                            <Button variant="ghost" size="icon" onClick={() => removePayment(e.payment_id!)}>
                              <Trash2 size={15} className="text-destructive" />
                            </Button>
                          )}
                        </TD>
                      </TR>
                    )
                  })}
                  <TR className="border-t-2 bg-muted/40 font-bold">
                    <TD colSpan={3}>Total</TD>
                    <TD className="tnum text-right">{fmtMoney(ledger.total_debit)}</TD>
                    <TD className="tnum text-right">{fmtMoney(ledger.total_credit)}</TD>
                    <TD className="tnum text-right">
                      {fmtMoney(Math.abs(ledger.closing))}
                      <span className="ml-1 text-[11px] font-medium">{drcr(partyType, ledger.closing)}</span>
                    </TD>
                    <TD />
                  </TR>
                </TBody>
              </Table>
            )}
          </>
        )}
      </Page>

      {payForm && (
        <Modal open onClose={() => setPayForm(null)} title={`Record Payment — ${selected?.name ?? ''}`}>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Direction">
                <Select value={payForm.direction} onChange={(e) => setPayForm({ ...payForm, direction: e.target.value })}>
                  <option value="in">Received from party</option>
                  <option value="out">Paid to party</option>
                </Select>
              </Field>
              <Field label="Amount">
                <Input type="number" step="0.01" value={payForm.amount} onChange={(e) =>
                  setPayForm({ ...payForm, amount: e.target.value })} />
              </Field>
              <Field label="Mode">
                <Select value={payForm.mode} onChange={(e) => setPayForm({ ...payForm, mode: e.target.value })}>
                  <option value="cash">Cash</option>
                  <option value="bank">Bank Transfer</option>
                  <option value="upi">UPI</option>
                  <option value="cheque">Cheque</option>
                  <option value="other">Other</option>
                </Select>
              </Field>
              <Field label="Date">
                <Input type="date" value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} />
              </Field>
            </div>
            <Field label="Reference" hint="Optional — bill no, rack no, cheque no…">
              <Input value={payForm.ref} onChange={(e) => setPayForm({ ...payForm, ref: e.target.value })} />
            </Field>
            <Field label="Remarks">
              <Input value={payForm.remarks} onChange={(e) => setPayForm({ ...payForm, remarks: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setPayForm(null)}>Cancel</Button>
              <Button
                onClick={() => savePayment.mutate({ ...payForm, amount: Number(payForm.amount) })}
                disabled={!(Number(payForm.amount) > 0)}
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
