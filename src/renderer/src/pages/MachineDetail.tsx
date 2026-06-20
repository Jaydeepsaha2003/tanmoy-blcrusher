import * as React from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Pencil, Trash2, Gauge, FileText, BarChart3, Paperclip, AlertTriangle, BookOpen } from 'lucide-react'
import { api } from '@/lib/api'
import type { MachineLog, AssetDocument, AssetDocType } from '@shared/types'
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
import { fmtQty, fmtMoney, fmtDate, today } from '@/lib/utils'

const DOC_TYPES: { value: AssetDocType; label: string }[] = [
  { value: 'insurance', label: 'Insurance' },
  { value: 'permit', label: 'Permit' },
  { value: 'fitness', label: 'Fitness' },
  { value: 'puc', label: 'PUC / Pollution' },
  { value: 'rc', label: 'Registration (RC)' },
  { value: 'tax', label: 'Road Tax' },
  { value: 'other', label: 'Other' }
]
const docLabel = (t: string): string => DOC_TYPES.find((d) => d.value === t)?.label ?? t

export function MachineDetail(): React.JSX.Element {
  const { id } = useParams()
  const assetId = Number(id)
  const qc = useQueryClient()
  const toast = useToast()
  const nav = useNavigate()

  const [tab, setTab] = React.useState<'sheet' | 'ledger' | 'logbook' | 'documents'>('sheet')
  const [from, setFrom] = React.useState('')
  const [to, setTo] = React.useState('')

  const { data: assets = [] } = useQuery({ queryKey: ['assets'], queryFn: () => api.assets.list() })
  const asset = assets.find((a) => a.id === assetId)
  const unit = (asset?.meter_type ?? 'hour') === 'km' ? 'km' : 'hr'

  const { data: sheet } = useQuery({
    queryKey: ['machineSheet', assetId, from, to],
    queryFn: () => api.machinery.balanceSheet(assetId, from || undefined, to || undefined)
  })
  const { data: logs = [] } = useQuery({
    queryKey: ['machineLogs', assetId, from, to],
    queryFn: () => api.machinery.logs(assetId, from || undefined, to || undefined)
  })
  const { data: docs = [] } = useQuery({
    queryKey: ['machineDocs', assetId],
    queryFn: () => api.machinery.documents(assetId)
  })
  const { data: ledger } = useQuery({
    queryKey: ['machineLedger', assetId, from, to],
    queryFn: () => api.ledgers.get('machine', assetId, from || undefined, to || undefined),
    enabled: tab === 'ledger'
  })

  const refresh = (): void => {
    qc.invalidateQueries({ queryKey: ['machineSheet'] })
    qc.invalidateQueries({ queryKey: ['machineLogs'] })
    qc.invalidateQueries({ queryKey: ['machineDocs'] })
    qc.invalidateQueries({ queryKey: ['reminders'] })
  }

  /* ---- Logbook ---- */
  const [logForm, setLogForm] = React.useState<any>(null)
  const saveLog = useMutation({
    mutationFn: (p: any) => (p.id ? api.machinery.updateLog(p) : api.machinery.addLog(p)),
    onSuccess: () => { refresh(); setLogForm(null); toast.success('Logbook entry saved.') },
    onError: (e: Error) => toast.error(e.message)
  })
  async function removeLog(l: MachineLog): Promise<void> {
    if (!(await confirmDialog({ title: 'Delete entry', message: `Delete the log for ${fmtDate(l.date)}?` }))) return
    await api.machinery.deleteLog(l.id); refresh(); toast.success('Deleted.')
  }
  const logUsage = logForm ? (Number(logForm.closing_meter) || 0) - (Number(logForm.opening_meter) || 0) : 0

  /* ---- Documents ---- */
  const [docForm, setDocForm] = React.useState<any>(null)
  const docFileRef = React.useRef<HTMLInputElement>(null)
  const saveDoc = useMutation({
    mutationFn: (p: any) => (p.id ? api.machinery.updateDocument(p) : api.machinery.addDocument(p)),
    onSuccess: (res) => {
      if (res.ok) { refresh(); setDocForm(null); toast.success('Document saved.') }
      else toast.error(res.error || 'Could not save.')
    },
    onError: (e: Error) => toast.error(e.message)
  })
  async function removeDoc(dc: AssetDocument): Promise<void> {
    if (!(await confirmDialog({ title: 'Delete document', message: `Delete this ${docLabel(dc.doc_type)} record?` }))) return
    await api.machinery.deleteDocument(dc.id); refresh(); toast.success('Deleted.')
  }
  function onDocFile(file: File): void {
    if (file.size > 6_000_000) { toast.error('File is too large (max ~6 MB).'); return }
    const r = new FileReader()
    r.onload = () => setDocForm((f: any) => ({ ...f, file_data: String(r.result), file_name: file.name }))
    r.onerror = () => toast.error('Could not read the file.')
    r.readAsDataURL(file)
  }

  if (!Number.isFinite(assetId)) return <Page><EmptyState message="Invalid machine." /></Page>

  return (
    <>
      <PageHeader
        title={asset?.name ?? 'Machine'}
        description={asset ? `${asset.asset_type === 'vehicle' ? 'Vehicle' : 'Machine'}${asset.category ? ` · ${asset.category}` : ''}${asset.identifier ? ` · ${asset.identifier}` : ''}${asset.business_name ? ` · ${asset.business_name}` : ''}` : ''}
        actions={<Button variant="outline" onClick={() => nav('/assets')}><ArrowLeft size={16} /> Machinery</Button>}
      />
      <Page>
        {/* Tabs */}
        <div className="mb-4 flex flex-wrap gap-2">
          {([['sheet', 'Balance Sheet', BarChart3], ['ledger', 'Ledger', BookOpen], ['logbook', 'Logbook', Gauge], ['documents', 'Documents', FileText]] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={
                'inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors ' +
                (tab === key ? 'border-primary bg-primary/5 text-foreground' : 'border-input text-muted-foreground hover:bg-accent')
              }
            >
              <Icon size={15} /> {label}
              {key === 'documents' && docs.some((x) => x.reminder_status && x.reminder_status !== 'ok') && (
                <span className="ml-0.5 h-2 w-2 rounded-full bg-destructive" />
              )}
            </button>
          ))}
        </div>

        {/* Date range (sheet + logbook) */}
        {tab !== 'documents' && (
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Period</span>
            <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-muted-foreground">to</span>
            <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
            {(from || to) && <Button variant="ghost" size="sm" onClick={() => { setFrom(''); setTo('') }}>All time</Button>}
          </div>
        )}

        {/* ---- Balance Sheet ---- */}
        {tab === 'sheet' && sheet && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label={`Usage (${unit})`} value={fmtQty(sheet.usage_qty)} />
              <Metric
                label="Fuel used (L)"
                value={fmtQty(sheet.fuel_litres)}
                sub={sheet.fuel_source === 'logbook' ? 'from logbook' : sheet.fuel_source === 'diesel' ? 'from diesel issues' : 'no data'}
              />
              <Metric
                label={`Actual fuel / ${unit}`}
                value={sheet.actual_consumption == null ? '—' : fmtQty(sheet.actual_consumption)}
                sub={sheet.standard_consumption != null ? `std ${fmtQty(sheet.standard_consumption)}` : undefined}
                tone={
                  sheet.actual_consumption != null && sheet.standard_consumption != null
                    ? sheet.actual_consumption > sheet.standard_consumption ? 'destructive' : 'success'
                    : undefined
                }
              />
              <Metric label={`Cost / ${unit}`} value={sheet.cost_per_unit == null ? '—' : fmtMoney(sheet.cost_per_unit)} />
            </div>

            {sheet.actual_consumption != null && sheet.standard_consumption != null && sheet.actual_consumption > sheet.standard_consumption && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
                <AlertTriangle size={16} /> Burning more fuel than standard — {fmtQty(sheet.actual_consumption)} vs {fmtQty(sheet.standard_consumption)} L/{unit}.
              </div>
            )}

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TBody>
                    <SheetRow label="Run income (logbook usage × rate)" value={fmtMoney(sheet.run_income)} tone="success" />
                    <SheetRow label="Rent earned (income)" value={fmtMoney(sheet.rent_income)} tone="success" />
                    <SheetRow label="Total income" value={fmtMoney(sheet.total_income)} tone="success" bold />
                    <SheetRow label="Diesel cost (avg rate)" value={fmtMoney(sheet.diesel_cost)} tone="destructive" />
                    <SheetRow label="Maintenance" value={fmtMoney(sheet.maintenance)} tone="destructive" />
                    <SheetRow label="Operator wages" value={fmtMoney(sheet.wages)} tone="destructive" />
                    <SheetRow label="Other expenses" value={fmtMoney(sheet.other_expense)} tone="destructive" />
                    <SheetRow label="Total cost" value={fmtMoney(sheet.total_cost)} tone="destructive" bold />
                    <TR className="border-t-2 bg-muted/40">
                      <TD className="font-bold">Net (rent − costs)</TD>
                      <TD className={`tnum text-right text-lg font-bold ${sheet.net < 0 ? 'text-destructive' : 'text-success'}`}>{fmtMoney(sheet.net)}</TD>
                    </TR>
                  </TBody>
                </Table>
              </CardContent>
            </Card>
            <p className="text-[11px] text-muted-foreground">
              Diesel is valued at the average purchase rate. Fuel comes from logbook entries when present, otherwise from diesel issued to this machine. Rent, maintenance and wages come from records tagged to this machine.
            </p>
          </div>
        )}

        {/* ---- Ledger ---- */}
        {tab === 'ledger' && (
          !ledger || ledger.entries.length === 0 ? (
            <EmptyState message="No ledger entries for this machine in the selected period." />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Particulars</TH>
                  <TH>Ref</TH>
                  <TH className="text-right">Debit (cost)</TH>
                  <TH className="text-right">Credit (income)</TH>
                  <TH className="text-right">Balance</TH>
                </TR>
              </THead>
              <TBody>
                {ledger.entries.map((e, i) => (
                  <TR key={i}>
                    <TD className="whitespace-nowrap">{fmtDate(e.date)}</TD>
                    <TD className="font-medium">{e.particulars}</TD>
                    <TD className="font-mono text-xs text-muted-foreground">{e.ref || '-'}</TD>
                    <TD className="tnum text-right">{e.debit ? fmtMoney(e.debit) : '-'}</TD>
                    <TD className="tnum text-right">{e.credit ? fmtMoney(e.credit) : '-'}</TD>
                    <TD className={`tnum text-right font-semibold ${e.balance >= 0 ? 'text-success' : 'text-destructive'}`}>{fmtMoney(e.balance)}</TD>
                  </TR>
                ))}
                <TR className="border-t-2 bg-muted/40 font-bold">
                  <TD colSpan={3}>Net (income − cost)</TD>
                  <TD className="tnum text-right">{fmtMoney(ledger.total_debit)}</TD>
                  <TD className="tnum text-right">{fmtMoney(ledger.total_credit)}</TD>
                  <TD className={`tnum text-right ${ledger.closing >= 0 ? 'text-success' : 'text-destructive'}`}>{fmtMoney(ledger.closing)}</TD>
                </TR>
              </TBody>
            </Table>
          )
        )}

        {/* ---- Logbook ---- */}
        {tab === 'logbook' && (
          <>
            <div className="mb-3 flex justify-end">
              <Button size="sm" onClick={() => setLogForm({ asset_id: assetId, date: today(), work_type: '', opening_meter: '', closing_meter: '', rate: '', fuel_litres: '', remarks: '' })}>
                <Plus size={15} /> Add Entry
              </Button>
            </div>
            {logs.length === 0 ? (
              <EmptyState message="No logbook entries in this period." />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Date</TH>
                    <TH>Work Type</TH>
                    <TH className="text-right">Opening</TH>
                    <TH className="text-right">Closing</TH>
                    <TH className="text-right">Used ({unit})</TH>
                    <TH className="text-right">Rate</TH>
                    <TH className="text-right">Income</TH>
                    <TH className="text-right">Fuel (L)</TH>
                    <TH className="text-right"></TH>
                  </TR>
                </THead>
                <TBody>
                  {logs.map((l) => (
                    <TR key={l.id}>
                      <TD className="whitespace-nowrap">{fmtDate(l.date)}</TD>
                      <TD>{l.work_type || '-'}{l.remarks && <span className="block text-[11px] text-muted-foreground">{l.remarks}</span>}</TD>
                      <TD className="tnum text-right">{fmtQty(l.opening_meter)}</TD>
                      <TD className="tnum text-right">{fmtQty(l.closing_meter)}</TD>
                      <TD className="tnum text-right font-semibold">{fmtQty(l.usage_qty)}</TD>
                      <TD className="tnum text-right">{l.rate == null ? '-' : fmtMoney(l.rate)}</TD>
                      <TD className="tnum text-right text-success">{l.amount == null ? '-' : fmtMoney(l.amount)}</TD>
                      <TD className="tnum text-right">{l.fuel_litres == null ? '—' : fmtQty(l.fuel_litres)}</TD>
                      <TD className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => setLogForm({ ...l, rate: l.rate ?? '', fuel_litres: l.fuel_litres ?? '' })}><Pencil size={15} /></Button>
                        <Button variant="ghost" size="icon" onClick={() => removeLog(l)}><Trash2 size={15} className="text-destructive" /></Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </>
        )}

        {/* ---- Documents ---- */}
        {tab === 'documents' && (
          <>
            <div className="mb-3 flex justify-end">
              <Button size="sm" onClick={() => setDocForm({ asset_id: assetId, doc_type: 'insurance', number: '', issue_date: '', expiry_date: '', file_data: '', remarks: '' })}>
                <Plus size={15} /> Add Document
              </Button>
            </div>
            {docs.length === 0 ? (
              <EmptyState message="No documents recorded for this machine." />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Type</TH>
                    <TH>Number</TH>
                    <TH>Issued</TH>
                    <TH>Expiry</TH>
                    <TH>Status</TH>
                    <TH>File</TH>
                    <TH className="text-right"></TH>
                  </TR>
                </THead>
                <TBody>
                  {docs.map((dc) => (
                    <TR key={dc.id}>
                      <TD className="font-medium">{docLabel(dc.doc_type)}</TD>
                      <TD className="font-mono text-xs">{dc.number || '-'}</TD>
                      <TD className="text-muted-foreground">{dc.issue_date ? fmtDate(dc.issue_date) : '-'}</TD>
                      <TD className="text-muted-foreground">{dc.expiry_date ? fmtDate(dc.expiry_date) : '-'}</TD>
                      <TD><ExpiryBadge dc={dc} /></TD>
                      <TD>
                        {dc.file_data ? (
                          <button className="text-xs font-medium text-primary hover:underline" onClick={() => window.open(dc.file_data as string, '_blank')}>
                            <Paperclip size={12} className="mr-0.5 inline" /> View
                          </button>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </TD>
                      <TD className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => setDocForm({ ...dc, issue_date: dc.issue_date ?? '', expiry_date: dc.expiry_date ?? '', file_data: dc.file_data ?? '' })}><Pencil size={15} /></Button>
                        <Button variant="ghost" size="icon" onClick={() => removeDoc(dc)}><Trash2 size={15} className="text-destructive" /></Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </>
        )}
      </Page>

      {/* Logbook modal */}
      {logForm && (
        <Modal open onClose={() => setLogForm(null)} title={logForm.id ? 'Edit Logbook Entry' : 'New Logbook Entry'} width="max-w-xl">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Date" required>
              <Input type="date" value={logForm.date} onChange={(e) => setLogForm({ ...logForm, date: e.target.value })} />
            </Field>
            <Field label="Work Type">
              <Input value={logForm.work_type} onChange={(e) => setLogForm({ ...logForm, work_type: e.target.value })} placeholder="Loading, Excavation, Transport…" />
            </Field>
            <Field label={`Opening meter (${unit})`}>
              <Input type="number" step="0.001" value={logForm.opening_meter} onChange={(e) => setLogForm({ ...logForm, opening_meter: e.target.value })} />
            </Field>
            <Field label={`Closing meter (${unit})`} hint={logUsage > 0 ? `Used ${fmtQty(logUsage)} ${unit}` : undefined}>
              <Input type="number" step="0.001" value={logForm.closing_meter} onChange={(e) => setLogForm({ ...logForm, closing_meter: e.target.value })} />
            </Field>
            <Field label={`Rate per ${unit}`} hint={logUsage > 0 && logForm.rate ? `Income ${fmtMoney(logUsage * Number(logForm.rate))}` : 'Usage × rate = income'}>
              <Input type="number" step="0.01" value={logForm.rate} onChange={(e) => setLogForm({ ...logForm, rate: e.target.value })} placeholder="Optional" />
            </Field>
            <Field label="Fuel used (L)" hint="Leave blank to use diesel issued instead">
              <Input type="number" step="0.01" value={logForm.fuel_litres} onChange={(e) => setLogForm({ ...logForm, fuel_litres: e.target.value })} placeholder="Optional" />
            </Field>
            <Field label="Remarks">
              <Input value={logForm.remarks} onChange={(e) => setLogForm({ ...logForm, remarks: e.target.value })} />
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setLogForm(null)}>Cancel</Button>
            <Button
              onClick={() => saveLog.mutate({
                ...logForm,
                opening_meter: Number(logForm.opening_meter) || 0,
                closing_meter: Number(logForm.closing_meter) || 0,
                rate: logForm.rate === '' || logForm.rate == null ? null : Number(logForm.rate),
                fuel_litres: logForm.fuel_litres === '' || logForm.fuel_litres == null ? null : Number(logForm.fuel_litres)
              })}
              disabled={!logForm.date}
            >
              Save
            </Button>
          </div>
        </Modal>
      )}

      {/* Document modal */}
      {docForm && (
        <Modal open onClose={() => setDocForm(null)} title={docForm.id ? 'Edit Document' : 'New Document'} width="max-w-xl">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Document Type" required>
              <SearchSelect value={docForm.doc_type} onChange={(v) => setDocForm({ ...docForm, doc_type: v })} options={DOC_TYPES} />
            </Field>
            <Field label="Number">
              <Input value={docForm.number} onChange={(e) => setDocForm({ ...docForm, number: e.target.value })} placeholder="Policy / certificate no." />
            </Field>
            <Field label="Issue Date">
              <Input type="date" value={docForm.issue_date} onChange={(e) => setDocForm({ ...docForm, issue_date: e.target.value })} />
            </Field>
            <Field label="Expiry Date" hint="Drives the reminder">
              <Input type="date" value={docForm.expiry_date} onChange={(e) => setDocForm({ ...docForm, expiry_date: e.target.value })} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Attachment" hint="Scan or photo of the document (optional, max ~6 MB)">
                <div className="flex items-center gap-3">
                  {docForm.file_data ? (
                    <span className="inline-flex items-center gap-1 text-xs text-success"><Paperclip size={12} /> {docForm.file_name || 'Attached'}</span>
                  ) : <span className="text-xs text-muted-foreground">No file</span>}
                  <input ref={docFileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onDocFile(f); e.target.value = '' }} />
                  <Button variant="outline" size="sm" onClick={() => docFileRef.current?.click()}>{docForm.file_data ? 'Replace' : 'Attach'}</Button>
                  {docForm.file_data && <Button variant="ghost" size="sm" onClick={() => setDocForm({ ...docForm, file_data: '', file_name: '' })}>Remove</Button>}
                </div>
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Remarks">
                <Input value={docForm.remarks} onChange={(e) => setDocForm({ ...docForm, remarks: e.target.value })} />
              </Field>
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDocForm(null)}>Cancel</Button>
            <Button onClick={() => saveDoc.mutate(docForm)}>Save</Button>
          </div>
        </Modal>
      )}
    </>
  )
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'success' | 'destructive' }): React.JSX.Element {
  return (
    <div className="rounded-xl border bg-card p-3.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`tnum mt-0.5 text-xl font-bold ${tone === 'success' ? 'text-success' : tone === 'destructive' ? 'text-destructive' : ''}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  )
}

function SheetRow({ label, value, tone, bold }: { label: string; value: string; tone?: 'success' | 'destructive'; bold?: boolean }): React.JSX.Element {
  return (
    <TR>
      <TD className={bold ? 'font-semibold' : ''}>{label}</TD>
      <TD className={`tnum text-right ${bold ? 'font-semibold' : ''} ${tone === 'success' ? 'text-success' : tone === 'destructive' ? 'text-destructive' : ''}`}>{value}</TD>
    </TR>
  )
}

export function ExpiryBadge({ dc }: { dc: AssetDocument }): React.JSX.Element {
  if (!dc.expiry_date) return <span className="text-xs text-muted-foreground">—</span>
  const status = dc.reminder_status
  if (status === 'expired') return <Badge variant="destructive">Expired</Badge>
  if (dc.days_left != null && dc.days_left <= 60) return <Badge variant="warning">{dc.days_left}d left</Badge>
  return <Badge variant="success">Valid</Badge>
}
