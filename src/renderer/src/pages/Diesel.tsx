import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, FileSpreadsheet, Fuel, FlaskConical, Gauge } from 'lucide-react'
import { api } from '@/lib/api'
import type { DieselPurchase, DieselIssue, PaymentStatus } from '@shared/types'
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
import { fmtQty, fmtMoney, fmtDate, today, downloadExcel } from '@/lib/utils'

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
  const { data: assets = [] } = useQuery({ queryKey: ['assets', plantId], queryFn: () => api.assets.list(plantId) })
  const { data: stock } = useQuery({ queryKey: ['dieselStock', plantId], queryFn: () => api.diesel.stock(plantId) })
  const { data: purchases = [] } = useQuery({ queryKey: ['dieselPurchases', plantId], queryFn: () => api.diesel.purchases(clean({ plant_id: plantId })) })
  const { data: issues = [] } = useQuery({ queryKey: ['dieselIssues', plantId], queryFn: () => api.diesel.issues(clean({ plant_id: plantId })) })
  const { data: byAsset = [] } = useQuery({ queryKey: ['dieselByAsset', plantId], queryFn: () => api.diesel.byAsset(plantId) })

  const [pForm, setPForm] = React.useState<any>(null)
  const [iForm, setIForm] = React.useState<any>(null)

  function refresh(): void {
    qc.invalidateQueries({ queryKey: ['dieselStock'] })
    qc.invalidateQueries({ queryKey: ['dieselPurchases'] })
    qc.invalidateQueries({ queryKey: ['dieselIssues'] })
    qc.invalidateQueries({ queryKey: ['dieselByAsset'] })
    qc.invalidateQueries({ queryKey: ['ledger'] })
    qc.invalidateQueries({ queryKey: ['ledger-balances'] })
    qc.invalidateQueries({ queryKey: ['allDues'] })
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
    setIForm({ plant_id: plantId ?? plants[0]?.id, asset_id: null, litres: '', date: today(), remarks: '' })
  }

  const pAmount = pForm ? (Number(pForm.litres) || 0) * (Number(pForm.rate) || 0) : 0
  const issueAvail = (stock?.balance ?? 0) + (iForm?.id ? Number(issues.find((i) => i.id === iForm.id)?.litres || 0) : 0)

  function exportExcel(): void {
    if (tab === 'issues') {
      downloadExcel('diesel-issues', 'Diesel Issues',
        ['Issue No', 'Date', 'Machine/Vehicle', 'Litres', 'Remarks'],
        issues.map((x) => [x.issue_no, fmtDate(x.date), x.asset_name ?? 'Unassigned', x.litres, x.remarks]))
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
        description="Daily diesel purchases (creditor ledger), litre stock, and issuing to machines & vehicles"
        actions={
          <>
            <Button variant="outline" onClick={exportExcel} disabled={tab === 'issues' ? !issues.length : !purchases.length}>
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
        <div className="mb-5 grid grid-cols-3 gap-3">
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
          issues.length === 0 ? <EmptyState message="No diesel issued yet." /> : (
            <Table>
              <THead><TR>
                <TH>No</TH><TH>Date</TH><TH>Machine / Vehicle</TH><TH className="text-right">Litres</TH><TH>Remarks</TH><TH className="text-right">Actions</TH>
              </TR></THead>
              <TBody>
                {issues.map((x) => (
                  <TR key={x.id}>
                    <TD className="font-mono text-xs">{x.issue_no}</TD>
                    <TD>{fmtDate(x.date)}</TD>
                    <TD className="font-medium">{x.asset_name ?? 'Unassigned'}</TD>
                    <TD className="tnum text-right font-semibold">{fmtQty(x.litres)}</TD>
                    <TD className="text-muted-foreground">{x.remarks || '-'}</TD>
                    <TD className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => setIForm({ ...x, asset_id: x.asset_id, litres: x.litres })}><Pencil size={15} /></Button>
                      <Button variant="ghost" size="icon" onClick={() => removeIssue(x)}><Trash2 size={15} className="text-destructive" /></Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
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
          <div className="grid grid-cols-2 gap-4">
            <Field label="Creditor (Supplier)" required>
              <Select value={pForm.supplier_id || ''} onChange={(e) => setPForm({ ...pForm, supplier_id: Number(e.target.value) })}>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Plant" required hint={plantId ? 'Locked to active plant' : undefined}>
              <Select value={pForm.plant_id || ''} disabled={!!plantId} onChange={(e) => setPForm({ ...pForm, plant_id: Number(e.target.value) })}>
                {plants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
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
            <Field label="Machine / Vehicle">
              <Select value={iForm.asset_id ?? ''} onChange={(e) => setIForm({ ...iForm, asset_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">— Unassigned —</option>
                {assets.map((a) => <option key={a.id} value={a.id}>{a.name}{a.identifier ? ` (${a.identifier})` : ''}</option>)}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Litres" required>
                <Input type="number" step="0.01" value={iForm.litres} onChange={(e) => setIForm({ ...iForm, litres: e.target.value })} />
              </Field>
              <Field label="Date" required>
                <Input type="date" value={iForm.date} onChange={(e) => setIForm({ ...iForm, date: e.target.value })} />
              </Field>
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
              <Button onClick={() => saveIssue.mutate({ ...iForm, litres: Number(iForm.litres) })} disabled={!(Number(iForm.litres) > 0) || Number(iForm.litres) > issueAvail}>
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
