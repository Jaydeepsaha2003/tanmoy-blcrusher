import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, FileSpreadsheet, Fuel, FlaskConical, Gauge } from 'lucide-react'
import { api } from '@/lib/api'
import type { DieselPurchase, DieselIssue, DieselIssueLine, PaymentStatus } from '@shared/types'
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
import { confirmDialog } from '@/components/confirm'
import { usePlant } from '@/lib/plant'
import { derivePaymentStatus } from '@shared/types'
import { fmtQty, fmtMoney, fmtDate, today, downloadExcel, cn } from '@/lib/utils'

const payBadge: Record<PaymentStatus, 'success' | 'warning' | 'destructive'> = {
  paid: 'success',
  partial: 'warning',
  unpaid: 'destructive'
}

export function Diesel(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { plantId } = usePlant()
  const [tab, setTab] = React.useState<'purchases' | 'issues' | 'by_machine'>('purchases')

  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers', plantId], queryFn: () => api.suppliers.list(plantId) })
  const { data: transporters = [] } = useQuery({ queryKey: ['transporters', plantId], queryFn: () => api.transporters.list(plantId) })
  const { data: assets = [] } = useQuery({ queryKey: ['assets', plantId], queryFn: () => api.assets.list(plantId) })
  const { data: stock } = useQuery({ queryKey: ['dieselStock', plantId], queryFn: () => api.diesel.stock(plantId) })
  const { data: purchases = [] } = useQuery({ queryKey: ['dieselPurchases', plantId], queryFn: () => api.diesel.purchases(clean({ plant_id: plantId })) })
  const { data: issues = [] } = useQuery({ queryKey: ['dieselIssues', plantId], queryFn: () => api.diesel.issues(clean({ plant_id: plantId })) })
  // Every diesel issuance, unified across direct issues + rack loading/unloading/sale transport.
  const { data: issuesAll = [] } = useQuery({ queryKey: ['dieselIssuesAll', plantId], queryFn: () => api.diesel.issuesAll(clean({ plant_id: plantId })) })
  const { data: byAsset = [] } = useQuery({ queryKey: ['dieselByAsset', plantId], queryFn: () => api.diesel.byAsset(plantId) })

  const [pForm, setPForm] = React.useState<any>(null)
  const [iForm, setIForm] = React.useState<any>(null)

  function refresh(): void {
    qc.invalidateQueries({ queryKey: ['dieselStock'] })
    qc.invalidateQueries({ queryKey: ['dieselPurchases'] })
    qc.invalidateQueries({ queryKey: ['dieselIssues'] })
    qc.invalidateQueries({ queryKey: ['dieselIssuesAll'] })
    qc.invalidateQueries({ queryKey: ['dieselByAsset'] })
    qc.invalidateQueries({ queryKey: ['plantExpenseBook'] })
    qc.invalidateQueries({ queryKey: ['ledger'] })
    qc.invalidateQueries({ queryKey: ['ledger-balances'] })
    qc.invalidateQueries({ queryKey: ['allDues'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const savePurchase = useMutation({
    mutationFn: (p: any) => (p.id ? api.diesel.updatePurchase(p) : api.diesel.createPurchase(p)),
    onSuccess: () => { refresh(); setPForm(null); toast.success('Diesel purchase saved.') },
    onError: (e: Error) => toast.error(e.message)
  })
  const saveIssue = useMutation({
    mutationFn: (p: any) => (p.id ? api.diesel.updateIssue(p) : api.diesel.createIssue(p)),
    onSuccess: () => { refresh(); setIForm(null); toast.success('Diesel issued.') },
    onError: (e: Error) => toast.error(e.message)
  })

  async function removePurchase(x: DieselPurchase): Promise<void> {
    const ok = await confirmDialog({ title: 'Delete purchase', message: `Delete ${x.purchase_no}?` })
    if (!ok) return
    const res = await api.diesel.deletePurchase(x.id)
    if (res.ok) { refresh(); toast.success('Deleted.') } else toast.error(res.error || 'Could not delete.')
  }
  async function removeIssue(x: DieselIssue): Promise<void> {
    const ok = await confirmDialog({ title: 'Delete issue', message: `Delete ${x.issue_no}? Stock will be restored.` })
    if (!ok) return
    await api.diesel.deleteIssue(x.id)
    refresh()
    toast.success('Deleted.')
  }

  function openPurchase(): void {
    setPForm({ supplier_id: suppliers[0]?.id, plant_id: plantId ?? plants[0]?.id, litres: '', rate: '', payment_status: 'unpaid', paid_amount: '', date: today(), remarks: '' })
  }
  function openIssue(): void {
    setIForm({ recipient: 'asset', plant_id: plantId ?? plants[0]?.id, asset_id: null, transporter_id: null, charged: false, litres: '', date: today(), remarks: '' })
  }

  const pAmount = pForm ? (Number(pForm.litres) || 0) * (Number(pForm.rate) || 0) : 0
  // Live FIFO quote for the diesel being issued (cost of the oldest stock first).
  const issueQuote = useQuery({
    queryKey: ['dieselQuote', iForm?.plant_id, iForm?.litres, iForm?.id],
    queryFn: () => api.diesel.fifoQuote({
      plant_id: Number(iForm.plant_id),
      litres: Number(iForm.litres) || 0,
      exclude: iForm.id ? { src: 'issue', id: Number(iForm.id) } : undefined
    }),
    enabled: !!iForm && !!iForm.plant_id && Number(iForm.litres) > 0
  })
  const iQuote = issueQuote.data
  const iCharge = iQuote?.amount ?? 0
  const issueAvail = iQuote?.available ?? ((stock?.balance ?? 0) + (iForm?.id ? Number(issues.find((i) => i.id === iForm.id)?.litres || 0) : 0))

  function exportExcel(): void {
    if (tab === 'issues') {
      downloadExcel('diesel-issues', 'Diesel Issues',
        ['No', 'Date', 'Source', 'Recipient', 'Context', 'Litres', 'Cost (FIFO)', 'Charged To'],
        issuesAll.map((x) => [x.ref_no, fmtDate(x.date), x.source_label, x.recipient, x.context, x.litres, x.amount ?? '', x.charged_to ?? '']))
    } else {
      downloadExcel('diesel-purchases', 'Diesel Purchases',
        ['Purchase No', 'Date', 'Creditor', 'Plant', 'Litres', 'Rate', 'Amount', 'Paid', 'Status'],
        purchases.map((x) => [x.purchase_no, fmtDate(x.date), x.supplier_name, x.plant_name, x.litres, x.rate ?? '', x.amount ?? '', x.paid_amount, x.payment_status]))
    }
  }

  return (
    <>
      <PageHeader
        title="Diesel"
        description="Daily diesel purchases (creditor ledger), litre stock, and issuing to a machine, vehicle or transporter"
        actions={
          <>
            <Button variant="outline" onClick={exportExcel} disabled={tab === 'issues' ? !issuesAll.length : !purchases.length}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            {tab !== 'by_machine' && (
              <Button onClick={tab === 'issues' ? openIssue : openPurchase} disabled={!plants.length || (tab === 'purchases' && !suppliers.length)}>
                <Plus size={16} /> {tab === 'issues' ? 'Issue Diesel' : 'New Purchase'}
              </Button>
            )}
          </>
        }
      />
      <Page>
        {/* Stock */}
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StockCard icon={<Fuel size={21} />} label="Purchased" value={`${fmtQty(stock?.purchased)} L`} />
          <StockCard icon={<Gauge size={21} />} label="Issued" value={`${fmtQty(stock?.issued)} L`} tone="warning" />
          <StockCard icon={<FlaskConical size={21} />} label="In Stock" value={`${fmtQty(stock?.balance)} L`} tone="success" />
        </div>

        <div className="mb-4 flex gap-2">
          <Button variant={tab === 'purchases' ? 'default' : 'outline'} size="sm" onClick={() => setTab('purchases')}>Purchases</Button>
          <Button variant={tab === 'issues' ? 'default' : 'outline'} size="sm" onClick={() => setTab('issues')}>Issues</Button>
          <Button variant={tab === 'by_machine' ? 'default' : 'outline'} size="sm" onClick={() => setTab('by_machine')}>By Machine</Button>
        </div>

        {tab === 'purchases' && (
          purchases.length === 0 ? <EmptyState message="No diesel purchases yet." /> : (
            <Table>
              <THead><TR>
                <TH>No</TH><TH>Date</TH><TH>Creditor</TH><TH className="text-right">Litres</TH>
                <TH className="text-right">Rate</TH><TH className="text-right">Amount</TH><TH>Payment</TH><TH className="text-right">Actions</TH>
              </TR></THead>
              <TBody>
                {purchases.map((x) => (
                  <TR key={x.id}>
                    <TD className="font-mono text-xs">{x.purchase_no}</TD>
                    <TD>{fmtDate(x.date)}</TD>
                    <TD className="font-medium">{x.supplier_name}</TD>
                    <TD className="tnum text-right">{fmtQty(x.litres)}</TD>
                    <TD className="tnum text-right">{x.rate == null ? '-' : fmtMoney(x.rate)}</TD>
                    <TD className="tnum text-right font-semibold">{fmtMoney(x.amount)}</TD>
                    <TD><Badge variant={payBadge[x.payment_status]}>{x.payment_status}</Badge></TD>
                    <TD className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => setPForm({ ...x, rate: x.rate ?? '', paid_amount: x.paid_amount || '' })}><Pencil size={15} /></Button>
                      <Button variant="ghost" size="icon" onClick={() => removePurchase(x)}><Trash2 size={15} className="text-destructive" /></Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )
        )}

        {tab === 'issues' && (
          issuesAll.length === 0 ? <EmptyState message="No diesel issued yet — from here, a rack loading/unloading, or a rack sale." /> : (
            <>
              <div className="mb-2 text-xs text-muted-foreground">
                Every diesel issuance — direct issues plus diesel consumed on rack loading, unloading and sale transport.
                Rack rows are edited on their own rack.
              </div>
              <Table>
                <THead><TR>
                  <TH>No</TH><TH>Date</TH><TH>Source</TH><TH>Recipient</TH><TH className="text-right">Litres</TH><TH>Charged To</TH><TH className="text-right">Cost (FIFO)</TH><TH className="text-right">Actions</TH>
                </TR></THead>
                <TBody>
                  {issuesAll.map((x) => (
                    <TR key={`${x.source}-${x.id}`}>
                      <TD className="font-mono text-xs">{x.ref_no}</TD>
                      <TD className="whitespace-nowrap">{fmtDate(x.date)}</TD>
                      <TD><Badge variant={x.source === 'issue' ? 'default' : 'muted'}>{x.source_label}</Badge></TD>
                      <TD>
                        <div className="font-medium">{x.recipient}</div>
                        {x.context && <div className="text-[11px] text-muted-foreground">{x.context}</div>}
                      </TD>
                      <TD className="tnum text-right font-semibold">{fmtQty(x.litres)}</TD>
                      <TD className="text-muted-foreground">{x.charged_to ?? '-'}</TD>
                      <TD className="tnum text-right">{x.amount != null ? `₹${fmtMoney(x.amount)}` : '-'}</TD>
                      <TD className="text-right">
                        {x.editable ? (
                          <>
                            <Button variant="ghost" size="icon" onClick={() => {
                              const full = issues.find((i) => i.id === x.id)
                              if (full) setIForm({ ...full, recipient: full.transporter_id ? 'transporter' : 'asset', asset_id: full.asset_id, transporter_id: full.transporter_id ?? null, charged: !!full.charged, litres: full.litres })
                            }}><Pencil size={15} /></Button>
                            <Button variant="ghost" size="icon" onClick={() => { const full = issues.find((i) => i.id === x.id); if (full) removeIssue(full) }}><Trash2 size={15} className="text-destructive" /></Button>
                          </>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">on rack</span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </>
          )
        )}

        {tab === 'by_machine' && (
          byAsset.length === 0 ? <EmptyState message="No diesel issued yet." /> : (
            <Table>
              <THead><TR><TH>Machine / Vehicle</TH><TH className="text-right">Total Diesel (L)</TH></TR></THead>
              <TBody>
                {byAsset.map((x, i) => (
                  <TR key={i}>
                    <TD className="font-medium">{x.asset_name}</TD>
                    <TD className="tnum text-right font-semibold">{fmtQty(x.litres)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )
        )}
      </Page>

      {/* Purchase modal */}
      {pForm && (
        <Modal open onClose={() => setPForm(null)} title={pForm.id ? `Edit ${pForm.purchase_no}` : 'New Diesel Purchase'} width="max-w-2xl">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Creditor (Supplier)" required>
              <SearchSelect
                value={pForm.supplier_id || ''}
                onChange={(v) => setPForm({ ...pForm, supplier_id: Number(v) })}
                options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
              />
            </Field>
            <Field label="Plant" required hint={plantId ? 'Locked to active plant' : undefined}>
              <SearchSelect
                value={pForm.plant_id || ''}
                disabled={!!plantId}
                onChange={(v) => setPForm({ ...pForm, plant_id: Number(v) })}
                options={plants.map((p) => ({ value: p.id, label: p.name }))}
              />
            </Field>
            <Field label="Litres" required>
              <Input type="number" step="0.01" value={pForm.litres} onChange={(e) => setPForm({ ...pForm, litres: e.target.value })} />
            </Field>
            <Field label="Rate / Litre">
              <Input type="number" step="0.01" value={pForm.rate} onChange={(e) => setPForm({ ...pForm, rate: e.target.value })} placeholder="Optional" />
            </Field>
            <Field label="Amount" hint="= litres × rate">
              <Input value={fmtMoney(pAmount)} disabled />
            </Field>
            <Field label="Date" required>
              <Input type="date" value={pForm.date} onChange={(e) => setPForm({ ...pForm, date: e.target.value })} />
            </Field>
            <Field label="Amount Paid" hint="Sets payment status automatically">
              <Input type="number" step="0.01" value={pForm.paid_amount} onChange={(e) => setPForm({ ...pForm, paid_amount: e.target.value })} />
            </Field>
            <Field label="Payment Status">
              <div className="flex h-9 items-center">
                <Badge variant={payBadge[derivePaymentStatus(pAmount, Number(pForm.paid_amount) || 0)]}>
                  {derivePaymentStatus(pAmount, Number(pForm.paid_amount) || 0)}
                </Badge>
              </div>
            </Field>
            <div className="col-span-2">
              <Field label="Remarks">
                <Input value={pForm.remarks || ''} onChange={(e) => setPForm({ ...pForm, remarks: e.target.value })} />
              </Field>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPForm(null)}>Cancel</Button>
            <Button onClick={() => savePurchase.mutate({ ...pForm, litres: Number(pForm.litres), rate: pForm.rate === '' ? null : Number(pForm.rate), paid_amount: Number(pForm.paid_amount) || 0 })} disabled={!pForm.supplier_id || !(Number(pForm.litres) > 0)}>
              Save Purchase
            </Button>
          </div>
        </Modal>
      )}

      {/* Issue modal */}
      {iForm && (
        <Modal open onClose={() => setIForm(null)} title={iForm.id ? `Edit ${iForm.issue_no}` : 'Issue Diesel'}>
          <div className="space-y-4">
            {/* Issue recipient */}
            <Field label="Issue To" required>
              <div className="flex flex-wrap gap-2">
                {([['asset', 'Machine / Vehicle'], ['transporter', 'Transporter']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      if (iForm.recipient === key) return
                      setIForm({ ...iForm, recipient: key, asset_id: null, transporter_id: null, rate: key === 'transporter' ? iForm.rate : '' })
                    }}
                    className={cn(
                      'rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors',
                      iForm.recipient === key ? 'border-primary bg-primary/5 text-foreground' : 'border-input text-muted-foreground hover:bg-accent'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Field>
            {iForm.recipient === 'transporter' ? (
              <Field label="Transporter" required hint="Diesel is charged to this transporter — debits their ledger">
                <SearchSelect
                  value={iForm.transporter_id ?? ''}
                  onChange={(v) => setIForm({ ...iForm, transporter_id: v ? Number(v) : null })}
                  options={transporters.map((t) => ({ value: t.id, label: t.name }))}
                  placeholder="Select transporter…"
                />
              </Field>
            ) : (
              <Field label="Machine / Vehicle">
                <SearchSelect
                  value={iForm.asset_id ?? ''}
                  onChange={(v) => setIForm({ ...iForm, asset_id: v ? Number(v) : null })}
                  options={[
                    { value: '', label: '— Unassigned —' },
                    ...assets.map((a) => ({ value: a.id, label: `${a.name}${a.identifier ? ` (${a.identifier})` : ''}` }))
                  ]}
                />
              </Field>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Litres" required>
                <Input type="number" step="0.01" value={iForm.litres} onChange={(e) => setIForm({ ...iForm, litres: e.target.value })} />
              </Field>
              <Field label="Date" required>
                <Input type="date" value={iForm.date} onChange={(e) => setIForm({ ...iForm, date: e.target.value })} />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Diesel Cost (FIFO)" hint="Valued at the oldest stock's rate first">
                <Input value={Number(iForm.litres) > 0 ? `₹${fmtMoney(iCharge)}` : '—'} disabled />
              </Field>
              {iForm.recipient === 'transporter' && (
                <Field label="Charge to transporter?" hint="Tick to debit this cost to the transporter">
                  <label className="flex h-9 cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4" checked={!!iForm.charged} onChange={(e) => setIForm({ ...iForm, charged: e.target.checked })} />
                    {iForm.charged ? `Charging ₹${fmtMoney(iCharge)}` : 'Not charged (we bear it)'}
                  </label>
                </Field>
              )}
            </div>
            <Field label="Remarks">
              <Input value={iForm.remarks || ''} onChange={(e) => setIForm({ ...iForm, remarks: e.target.value })} />
            </Field>
            <div className="rounded-lg bg-muted/60 px-4 py-2.5 text-sm">
              In stock: <b>{fmtQty(issueAvail)} L</b>
              {Number(iForm.litres) > issueAvail && <span className="ml-2 font-medium text-destructive">— exceeds stock!</span>}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setIForm(null)}>Cancel</Button>
              <Button
                onClick={() => {
                  const toTransporter = iForm.recipient === 'transporter'
                  saveIssue.mutate({
                    ...iForm,
                    litres: Number(iForm.litres),
                    asset_id: toTransporter ? null : iForm.asset_id || null,
                    transporter_id: toTransporter ? iForm.transporter_id || null : null,
                    charged: toTransporter && !!iForm.charged
                  })
                }}
                disabled={
                  !(Number(iForm.litres) > 0) ||
                  Number(iForm.litres) > issueAvail ||
                  (iForm.recipient === 'transporter' && !iForm.transporter_id)
                }
              >
                Save Issue
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

function StockCard({
  icon,
  label,
  value,
  tone
}: {
  icon: React.ReactNode
  label: string
  value: string
  tone?: 'success' | 'warning'
}): React.JSX.Element {
  const t = tone === 'success' ? 'bg-success/10 text-success' : tone === 'warning' ? 'bg-warning/15 text-warning' : 'bg-primary/10 text-primary'
  return (
    <Card>
      <CardContent className="flex items-center gap-3.5 p-4">
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${t}`}>{icon}</div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="tnum text-xl font-bold">{value}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function clean(f: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(f)) if (v != null && v !== '') out[k] = v
  return out
}
