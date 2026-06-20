import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, FileSpreadsheet, Gauge } from 'lucide-react'
import { api } from '@/lib/api'
import type { Asset } from '@shared/types'
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
import { usePlant } from '@/lib/plant'
import { fmtQty, fmtMoney, downloadExcel } from '@/lib/utils'

const CATEGORIES = ['Crusher', 'Tipper', 'Excavator', 'JCB', 'JCB Loader', 'Loader', 'Dumper', 'Generator', 'Other']

export function Assets(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const nav = useNavigate()
  const { plantId } = usePlant()
  const { data = [] } = useQuery({ queryKey: ['assets', plantId], queryFn: () => api.assets.list(plantId) })
  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })
  const { data: businesses = [] } = useQuery({ queryKey: ['businesses'], queryFn: api.businesses.list })
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState<Partial<Asset>>({})

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
                    <Button variant="ghost" size="icon" title="Logbook, balance sheet & documents" onClick={() => nav(`/machinery/${a.id}`)}>
                      <Gauge size={15} />
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
            <SearchSelect value={form.asset_type || 'machine'} onChange={(v) => setForm({ ...form, asset_type: v as Asset['asset_type'] })} options={[{ value: 'machine', label: 'Machine' }, { value: 'vehicle', label: 'Vehicle' }]} />
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
            <SearchSelect value={form.plant_id ?? ''} onChange={(v) => setForm({ ...form, plant_id: v ? Number(v) : null })} options={[{ value: '', label: 'Common (all plants)' }, ...plants.map((p) => ({ value: p.id, label: p.name }))]} />
          </Field>
          <Field label="Owning Business / Firm" hint="Costs & rent of this machine roll up here">
            <SearchSelect value={form.business_id ?? ''} onChange={(v) => setForm({ ...form, business_id: v ? Number(v) : null })} options={[{ value: '', label: '— None —' }, ...businesses.map((b) => ({ value: b.id, label: b.name }))]} />
          </Field>
          <Field label="Meter" hint="Machines run on hours; vehicles on km">
            <SearchSelect value={form.meter_type || (form.asset_type === 'vehicle' ? 'km' : 'hour')} onChange={(v) => setForm({ ...form, meter_type: v as Asset['meter_type'] })} options={[{ value: 'hour', label: 'Hours' }, { value: 'km', label: 'Kilometres' }]} />
          </Field>
          <Field label="Standard fuel" hint={`Litres per ${(form.meter_type || (form.asset_type === 'vehicle' ? 'km' : 'hour')) === 'km' ? 'km' : 'hour'} (for the over-use check)`}>
            <Input type="number" step="0.01" value={form.standard_consumption ?? ''} onChange={(e) => setForm({ ...form, standard_consumption: e.target.value === '' ? null : Number(e.target.value) })} placeholder="Optional" />
          </Field>
          <Field label="Status">
            <SearchSelect value={form.status || 'active'} onChange={(v) => setForm({ ...form, status: v as Asset['status'] })} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
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
    </>
  )
}
