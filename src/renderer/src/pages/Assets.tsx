import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, FileSpreadsheet, BarChart3 } from 'lucide-react'
import { api } from '@/lib/api'
import type { Asset } from '@shared/types'
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
import { usePlant } from '@/lib/plant'
import { fmtQty, fmtMoney, downloadExcel } from '@/lib/utils'

const CATEGORIES = ['Crusher', 'Tipper', 'Excavator', 'JCB', 'JCB Loader', 'Loader', 'Dumper', 'Generator', 'Other']

export function Assets(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { plantId } = usePlant()
  const { data = [] } = useQuery({ queryKey: ['assets', plantId], queryFn: () => api.assets.list(plantId) })
  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })
  const { data: businesses = [] } = useQuery({ queryKey: ['businesses'], queryFn: api.businesses.list })
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState<Partial<Asset>>({})
  const [reportFor, setReportFor] = React.useState<Asset | null>(null)
  const { data: report } = useQuery({
    queryKey: ['assetReport', reportFor?.id],
    queryFn: () => api.assets.report(reportFor!.id),
    enabled: !!reportFor
  })

  const save = useMutation({
    mutationFn: (p: Partial<Asset>) => (p.id ? api.assets.update(p) : api.assets.create(p)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assets'] })
      setOpen(false)
      toast.success('Saved.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  async function remove(a: Asset): Promise<void> {
    const ok = await confirmDialog({ title: 'Delete', message: `Delete "${a.name}"?` })
    if (!ok) return
    const res = await api.assets.delete(a.id)
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ['assets'] })
      toast.success('Deleted.')
    } else toast.error(res.error || 'Could not delete.')
  }

  function exportExcel(): void {
    downloadExcel(
      'machinery-vehicles',
      'Machinery & Vehicles',
      ['Name', 'Type', 'Category', 'Identifier', 'Plant', 'Business', 'Status'],
      data.map((a) => [a.name, a.asset_type, a.category, a.identifier, a.plant_name ?? 'Common', a.business_name ?? '', a.status])
    )
  }

  return (
    <>
      <PageHeader
        title="Machinery & Vehicles"
        description="Register the machines and vehicles your business owns"
        actions={
          <>
            <Button variant="outline" onClick={exportExcel} disabled={!data.length}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button onClick={() => { setForm({ asset_type: 'machine', status: 'active', plant_id: plantId ?? null, business_id: null }); setOpen(true) }}>
              <Plus size={16} /> New Asset
            </Button>
          </>
        }
      />
      <Page>
        {data.length === 0 ? (
          <EmptyState message="No machinery or vehicles added yet." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Type</TH>
                <TH>Category</TH>
                <TH>Identifier / Reg.</TH>
                <TH>Plant</TH>
                <TH>Business</TH>
                <TH>Status</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {data.map((a) => (
                <TR key={a.id}>
                  <TD className="font-medium">{a.name}</TD>
                  <TD><Badge variant={a.asset_type === 'vehicle' ? 'default' : 'muted'}>{a.asset_type}</Badge></TD>
                  <TD className="text-muted-foreground">{a.category || '-'}</TD>
                  <TD className="font-mono text-xs">{a.identifier || '-'}</TD>
                  <TD className="text-muted-foreground">{a.plant_name || 'Common'}</TD>
                  <TD className="text-muted-foreground">{a.business_name || '-'}</TD>
                  <TD className="capitalize text-muted-foreground">{a.status}</TD>
                  <TD className="text-right">
                    <Button variant="ghost" size="icon" title="Machine report" onClick={() => setReportFor(a)}>
                      <BarChart3 size={15} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => { setForm(a); setOpen(true) }}>
                      <Pencil size={15} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(a)}>
                      <Trash2 size={15} className="text-destructive" />
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Page>

      <Modal open={open} onClose={() => setOpen(false)} title={form.id ? 'Edit Asset' : 'New Machine / Vehicle'} width="max-w-2xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Name">
            <Input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Crusher Unit 1" />
          </Field>
          <Field label="Type">
            <Select value={form.asset_type || 'machine'} onChange={(e) => setForm({ ...form, asset_type: e.target.value as Asset['asset_type'] })}>
              <option value="machine">Machine</option>
              <option value="vehicle">Vehicle</option>
            </Select>
          </Field>
          <Field label="Category">
            <Input list="asset-cats" value={form.category || ''} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Crusher, Tipper, JCB…" />
            <datalist id="asset-cats">
              {CATEGORIES.map((c) => <option key={c} value={c} />)}
            </datalist>
          </Field>
          <Field label="Identifier / Reg. No.">
            <Input value={form.identifier || ''} onChange={(e) => setForm({ ...form, identifier: e.target.value })} placeholder="e.g. JH-01-AB-1234" />
          </Field>
          <Field label="Plant" hint="Common = shared by all plants">
            <Select value={form.plant_id ?? ''} onChange={(e) => setForm({ ...form, plant_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Common (all plants)</option>
              {plants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Owning Business / Firm" hint="Costs & rent of this machine roll up here">
            <Select value={form.business_id ?? ''} onChange={(e) => setForm({ ...form, business_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">— None —</option>
              {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.status || 'active'} onChange={(e) => setForm({ ...form, status: e.target.value as Asset['status'] })}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </Field>
          <div className="col-span-2">
            <Field label="Remarks">
              <Input value={form.remarks || ''} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
            </Field>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => save.mutate(form)} disabled={!form.name?.trim()}>Save</Button>
        </div>
      </Modal>

      {reportFor && (
        <Modal open onClose={() => setReportFor(null)} title={`Report — ${reportFor.name}`} width="max-w-lg">
          {!report ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="space-y-4">
              <div className="text-xs text-muted-foreground">
                {report.business_name ? <>Business: <b className="text-foreground">{report.business_name}</b></> : 'Not linked to a business'}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <RptCard label="Diesel Consumed" value={`${fmtQty(report.diesel_litres)} L`} />
                <RptCard label="Diesel Cost (avg)" value={fmtMoney(report.diesel_cost)} tone="destructive" />
                <RptCard label="Maintenance" value={fmtMoney(report.maintenance)} tone="destructive" />
                <RptCard label="Operator Wages" value={fmtMoney(report.wages)} tone="destructive" />
                <RptCard label="Other Expenses" value={fmtMoney(report.other_expense)} tone="destructive" />
                <RptCard label="Rent Earned" value={fmtMoney(report.rent_income)} tone="success" />
              </div>
              <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-4 py-3">
                <span className="text-sm font-semibold">Net to Business (rent − costs)</span>
                <span className={`tnum text-lg font-bold ${report.net < 0 ? 'text-destructive' : 'text-success'}`}>{fmtMoney(report.net)}</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Diesel is valued at the average purchase rate. Operator wages count when a wage entry is tagged to this machine.
              </p>
            </div>
          )}
          <div className="mt-5 flex justify-end">
            <Button variant="outline" onClick={() => setReportFor(null)}>Close</Button>
          </div>
        </Modal>
      )}
    </>
  )
}

function RptCard({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'destructive' }): React.JSX.Element {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`tnum mt-0.5 text-base font-bold ${tone === 'success' ? 'text-success' : tone === 'destructive' ? 'text-destructive' : ''}`}>{value}</div>
    </div>
  )
}
