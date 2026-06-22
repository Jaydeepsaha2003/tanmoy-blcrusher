import * as React from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, FileSpreadsheet, ArrowLeft, FileText } from 'lucide-react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { api } from '@/lib/api'
import type { LedgerType } from '@shared/types'
import { usePlant } from '@/lib/plant'
import { PageHeader, Page } from '@/components/layout'
import {
  Button,
  Input,
  Select,
  SearchSelect,
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
import { fmtMoney, fmtQty, fmtDate, today, downloadExcel } from '@/lib/utils'

/** "50 TON" style cell for the dealt quantity, or empty when the line has none. */
function qtyText(e: { qty?: number; uom?: string }): string {
  return e.qty != null ? `${fmtQty(e.qty)} ${e.uom ?? ''}`.trim() : ''
}

const partyLabel: Record<LedgerType, string> = {
  customer: 'Customer',
  supplier: 'Supplier',
  transporter: 'Transporter',
  outsource: 'Outsource',
  rack: 'Rack',
  company: 'Company',
  plant: 'Plant',
  business: 'Business',
  machine: 'Machine'
}
const balanceLabel: Record<LedgerType, string> = {
  customer: 'Receivable',
  supplier: 'Payable',
  transporter: 'Payable',
  outsource: 'Payable',
  rack: 'Profit / (Loss)',
  company: 'Net Balance',
  plant: 'Net (Profit / Loss)',
  business: 'Net (Profit / Loss)',
  machine: 'Net (Profit / Loss)'
}

/** Red/green semantics differ per ledger: dues are red, rack/plant/business profit / net receivable green-ish. */
function balanceClass(t: LedgerType, v: number): string {
  if (t === 'rack' || t === 'plant' || t === 'business' || t === 'machine') return v >= 0 ? 'text-success' : 'text-destructive'
  if (t === 'company') return v >= 0 ? 'text-primary' : 'text-destructive'
  return v > 0 ? 'text-destructive' : 'text-success'
}

/** Tally-style Dr/Cr tag. Customer/company balances are debit-positive; supplier/transporter/outsource credit-positive. */
function drcr(t: LedgerType, v: number): string {
  if (t === 'rack' || t === 'plant' || t === 'business' || t === 'machine' || Math.abs(v) < 0.005) return ''
  const debitPositive = t === 'customer' || t === 'company'
  return (debitPositive ? v > 0 : v < 0) ? 'Dr' : 'Cr'
}

/** Ledgers that support a manual opening balance. */
const OPENING_TYPES: LedgerType[] = ['customer', 'supplier', 'transporter', 'outsource']

/** Financial year (Apr–Mar) start-year for a date, and its label e.g. "2025-26". */
function fyStartYearOf(d: Date): number {
  return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
}
function fyLabel(y: number): string {
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`
}

export function Ledgers(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { plantId } = usePlant()
  const initial = (useLocation().state ?? {}) as { type?: LedgerType; id?: number }
  const [partyType, setPartyType] = React.useState<LedgerType>(initial.type ?? 'customer')
  const [partyId, setPartyId] = React.useState<number | undefined>(initial.id)
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')
  const [fy, setFy] = React.useState<number | ''>('')
  const [payForm, setPayForm] = React.useState<any>(null)
  const [openingForm, setOpeningForm] = React.useState<any>(null)

  const fyYears = React.useMemo(() => {
    const cur = fyStartYearOf(new Date())
    return Array.from({ length: 7 }, (_, i) => cur + 1 - i)
  }, [])

  function selectFy(value: string): void {
    if (value === '') {
      setFy('')
      setFrom('')
      setTo('')
      return
    }
    const y = Number(value)
    setFy(y)
    setFrom(`${y}-04-01`)
    setTo(`${y + 1}-03-31`)
  }

  // Scope party lists to the active plant (customers/suppliers/transporters/outsource
  // carry a plant; global types like company/plant/business/rack ignore it server-side).
  const { data: balances = [] } = useQuery({
    queryKey: ['ledger-balances', partyType, plantId],
    queryFn: () => api.ledgers.balances(partyType, plantId)
  })
  const { data: branding } = useQuery({ queryKey: ['branding'], queryFn: () => api.rates.getBranding() })
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

  const saveOpening = useMutation({
    mutationFn: (p: any) => api.ledgers.setOpening(p),
    onSuccess: (res) => {
      if (res.ok) {
        refresh()
        setOpeningForm(null)
        toast.success('Opening balance saved.')
      } else toast.error(res.error || 'Could not save opening balance.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  async function openOpening(): Promise<void> {
    if (!partyId) return
    const existing = await api.ledgers.getOpening(partyType, partyId).catch(() => null)
    setOpeningForm({
      party_type: partyType,
      party_id: partyId,
      amount: existing?.amount ?? '',
      direction: existing?.direction ?? (partyType === 'customer' ? 'debit' : 'credit'),
      as_of_date: existing?.as_of_date || (fy ? `${fy}-04-01` : today()),
      remarks: existing?.remarks ?? ''
    })
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
      qtyText(e),
      e.ref,
      e.debit || '',
      e.credit || '',
      `${fmtMoney(Math.abs(e.balance))} ${drcr(partyType, e.balance)}`.trim()
    ])
    rows.push([
      '',
      'TOTAL',
      '',
      '',
      ledger.total_debit,
      ledger.total_credit,
      `${fmtMoney(Math.abs(ledger.closing))} ${drcr(partyType, ledger.closing)}`.trim()
    ])
    downloadExcel(
      `ledger-${partyType}-${ledger.party_name}`,
      `${partyLabel[partyType]} Ledger`,
      ['Date', 'Particulars', 'Qty', 'Vch No.', 'Debit', 'Credit', 'Balance'],
      rows,
      title
    )
  }

  // Generate a styled PDF and download it directly (no print dialog).
  async function downloadPdf(): Promise<void> {
    if (!ledger) return
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageW = doc.internal.pageSize.getWidth()
    const pageH = doc.internal.pageSize.getHeight()
    const margin = 14
    const topY = 14
    let textX = margin

    // Optional logo (data URL) — sized to its aspect ratio, never fatal.
    const logo = branding?.logo
    if (logo && /^data:image\/(png|jpe?g|webp);/i.test(logo)) {
      try {
        const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
          img.onerror = reject
          img.src = logo
        })
        const h = 15
        const w = dims.h ? Math.min((dims.w / dims.h) * h, 45) : 15
        const raw = logo.substring(11, logo.indexOf(';')).toUpperCase()
        const fmt = raw === 'JPG' ? 'JPEG' : raw
        doc.addImage(logo, fmt, margin, topY, w, h)
        textX = margin + w + 4
      } catch {
        /* skip logo on any decode error */
      }
    }

    const business = branding?.business_name || 'BL Crushing'
    doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(17, 24, 39)
    doc.text(business, textX, topY + 6)
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(120, 120, 120)
    doc.text('Ledger Account', textX, topY + 11.5)

    const closingStr = `${fmtMoney(Math.abs(ledger.closing))} ${drcr(partyType, ledger.closing)}`.trim()
    const goodTypes = ['rack', 'plant', 'business', 'machine', 'company']
    const good = goodTypes.includes(partyType) ? ledger.closing >= 0 : ledger.closing <= 0
    doc.setFontSize(8).setTextColor(120, 120, 120)
    doc.text(`Closing — ${balanceLabel[partyType]}`, pageW - margin, topY + 4, { align: 'right' })
    doc.setFont('helvetica', 'bold').setFontSize(13)
    doc.setTextColor(...(good ? ([22, 163, 74] as [number, number, number]) : ([185, 28, 28] as [number, number, number])))
    doc.text(closingStr, pageW - margin, topY + 11, { align: 'right' })

    let y = topY + 18
    doc.setDrawColor(225, 228, 232).line(margin, y, pageW - margin, y)
    y += 6
    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(17, 24, 39)
    doc.text(`${ledger.party_name}  ·  ${partyLabel[partyType]}`, margin, y)
    const period = `${from ? fmtDate(from) : 'Beginning'} to ${to ? fmtDate(to) : fmtDate(today())}`
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(110, 110, 110)
    doc.text(`Period: ${period}`, margin, y + 5)
    y += 9

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Date', 'Particulars', 'Qty', 'Vch No.', 'Debit', 'Credit', 'Balance']],
      body: ledger.entries.map((e) => [
        fmtDate(e.date),
        e.particulars,
        qtyText(e),
        e.ref || '',
        e.debit ? fmtMoney(e.debit) : '',
        e.credit ? fmtMoney(e.credit) : '',
        `${fmtMoney(Math.abs(e.balance))} ${drcr(partyType, e.balance)}`.trim()
      ]),
      foot: [['', 'Total', '', '', fmtMoney(ledger.total_debit), fmtMoney(ledger.total_credit), closingStr]],
      styles: { fontSize: 8, cellPadding: 1.6, lineColor: [230, 232, 236], lineWidth: 0.1, textColor: [31, 41, 55] },
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [243, 244, 246], textColor: [17, 24, 39], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [249, 250, 251] },
      columnStyles: {
        0: { cellWidth: 20 },
        2: { halign: 'right', cellWidth: 22 },
        3: { cellWidth: 24 },
        4: { halign: 'right', cellWidth: 24 },
        5: { halign: 'right', cellWidth: 24 },
        6: { halign: 'right', cellWidth: 28 }
      }
    })

    const pages = doc.getNumberOfPages()
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i)
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(150, 150, 150)
      doc.text(`Generated ${fmtDate(today())}`, margin, pageH - 8)
      doc.text(`Page ${i} of ${pages}`, pageW - margin, pageH - 8, { align: 'right' })
    }

    const safe = (s: string): string => s.replace(/[^\w.-]+/g, '_')
    doc.save(`Ledger-${safe(partyLabel[partyType])}-${safe(ledger.party_name)}.pdf`)
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
              <Button variant="outline" className="no-print" onClick={() => downloadPdf()} disabled={!ledger?.entries.length}>
                <FileText size={16} /> PDF
              </Button>
              <Button variant="outline" className="no-print" onClick={exportExcel} disabled={!ledger?.entries.length}>
                <FileSpreadsheet size={16} /> Excel
              </Button>
              {OPENING_TYPES.includes(partyType) && (
                <Button variant="outline" className="no-print" onClick={openOpening}>
                  Opening Balance
                </Button>
              )}
              {partyType !== 'rack' && partyType !== 'company' && partyType !== 'plant' && partyType !== 'business' && partyType !== 'machine' && (
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
          <SearchSelect
            className="w-full sm:w-44"
            alwaysSearch
            value={partyType}
            onChange={(v) => switchType(v as LedgerType)}
            options={[
              { value: 'customer', label: 'Customers' },
              { value: 'supplier', label: 'Suppliers' },
              { value: 'transporter', label: 'Transporters' },
              { value: 'outsource', label: 'Outsource Vendors' },
              { value: 'company', label: 'Companies' },
              { value: 'business', label: 'Businesses (P&L)' },
              { value: 'plant', label: 'Plants (P&L)' },
              { value: 'machine', label: 'Machines (P&L)' },
              { value: 'rack', label: 'Racks' }
            ]}
          />
          <SearchSelect
            className="w-full sm:w-56"
            alwaysSearch
            value={partyId ?? ''}
            onChange={(v) => setPartyId(v ? Number(v) : undefined)}
            options={[
              { value: '', label: `— Select ${partyLabel[partyType].toLowerCase()} —` },
              ...balances.map((b) => ({ value: b.party_id, label: b.name }))
            ]}
            placeholder={`— Select ${partyLabel[partyType].toLowerCase()} —`}
          />
          {partyId && (
            <>
              <SearchSelect
                className="w-full sm:w-36"
                alwaysSearch
                value={fy === '' ? '' : String(fy)}
                onChange={(v) => selectFy(v)}
                options={[
                  { value: '', label: 'All time' },
                  ...fyYears.map((y) => ({ value: y, label: `FY ${fyLabel(y)}` }))
                ]}
              />
              <Input type="date" className="w-full sm:w-36" value={from} onChange={(e) => { setFrom(e.target.value); setFy('') }} />
              <span className="text-muted-foreground">to</span>
              <Input type="date" className="w-full sm:w-36" value={to} onChange={(e) => { setTo(e.target.value); setFy('') }} />
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
                    <TH className="text-right">Qty</TH>
                    <TH>Vch No.</TH>
                    <TH className="text-right">Debit</TH>
                    <TH className="text-right">Credit</TH>
                    <TH className="text-right">Balance</TH>
                    <TH className="text-right"></TH>
                  </TR>
                </THead>
                <TBody>
                  {ledger.entries.map((e, i) => {
                    const opening = e.particulars.toLowerCase().startsWith('opening balance')
                    return (
                      <TR key={i} className={opening ? 'bg-muted/30' : ''}>
                        <TD className="whitespace-nowrap">{fmtDate(e.date)}</TD>
                        <TD className={opening ? 'italic text-muted-foreground' : 'font-medium'}>{e.particulars}</TD>
                        <TD className="tnum whitespace-nowrap text-right text-muted-foreground">{qtyText(e) || '-'}</TD>
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
                    <TD colSpan={4}>Total</TD>
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
                <Input type="number" step="0.01" value={payForm.amount} onChange={(e) =>
                  setPayForm({ ...payForm, amount: e.target.value })} />
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

      {openingForm && (
        <Modal open onClose={() => setOpeningForm(null)} title={`Opening Balance — ${selected?.name ?? ''}`}>
          <div className="space-y-4">
            <div className="rounded-lg border border-primary/30 bg-accent/40 px-3.5 py-2.5 text-xs text-accent-foreground">
              The opening balance is the account's starting figure. Each financial year's opening is the
              previous year's closing automatically — you only set this once.
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="As-of date" hint="Usually the start of your first financial year">
                <Input type="date" value={openingForm.as_of_date} onChange={(e) => setOpeningForm({ ...openingForm, as_of_date: e.target.value })} />
              </Field>
              <Field label="Amount" hint="Set 0 to clear the opening balance">
                <Input type="number" step="0.01" value={openingForm.amount} onChange={(e) => setOpeningForm({ ...openingForm, amount: e.target.value })} />
              </Field>
              <Field
                label="Type"
                hint={partyType === 'customer' ? 'Dr = they owe you · Cr = advance from them' : 'Cr = you owe them · Dr = advance you paid'}
              >
                <SearchSelect
                  value={openingForm.direction}
                  onChange={(v) => setOpeningForm({ ...openingForm, direction: v })}
                  options={[
                    { value: 'debit', label: 'Debit (Dr)' },
                    { value: 'credit', label: 'Credit (Cr)' }
                  ]}
                />
              </Field>
              <Field label="Remarks">
                <Input value={openingForm.remarks} onChange={(e) => setOpeningForm({ ...openingForm, remarks: e.target.value })} />
              </Field>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setOpeningForm(null)}>Cancel</Button>
              <Button onClick={() => saveOpening.mutate({ ...openingForm, amount: Number(openingForm.amount) || 0 })}>
                Save Opening Balance
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
