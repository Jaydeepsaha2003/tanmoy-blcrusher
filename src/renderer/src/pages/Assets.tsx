import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, FileSpreadsheet, Gauge, ArrowLeftRight, AlertTriangle } from 'lucide-react'
import { api } from '@/lib/api'
import type { Asset } from '@shared/types'
import { PageHeader, Page } from '@/components/layout'
import {
  Button,
  Input,
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
import { today, fmtQty, fmtMoney, downloadExcel, cn } from '@/lib/utils'

const CATEGORIES = ['Crusher', 'Tipper', 'Excavator', 'JCB', 'JCB Loader', 'Loader', 'Dumper', 'Generator', 'Other']

export function Assets(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const nav = useNavigate()
  const { plantId } = usePlant()
  const { data = [] } = useQuery({ queryKey: ['assets', plantId], queryFn: () => api.assets.list(plantId) })
  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })
  const { data: businesses = [] } = useQuery({ queryKey: ['businesses'], queryFn: api.businesses.list })
  const { data: overview = [] } = useQuery({ queryKey: ['machineOverview'], queryFn: () => api.machinery.overview() })
  const ov = React.useMemo(() => new Map(overview.map((o) => [o.asset_id, o])), [overview])
  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState<any>({})
  const [moveForm, setMoveForm] = React.useState<any>(null)
  const [typeFilter, setTypeFilter] = React.useState<'all' | 'machine' | 'vehicle'>('all')

  const rows = typeFilter === 'all' ? data : data.filter((a) => a.asset_type === typeFilter)

  const save = useMutation({
    mutationFn: (p: any) => (p.id ? api.assets.update(p) : api.assets.create(p)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assets'] })
      setOpen(false)
      toast.success('Saved.')
    },
    onError: (e: Error) => toast.error(e.message)
  })
  const move = useMutation({
    mutationFn: (p: any) => api.assets.move({ id: p.id, plant_ids: p.plant_ids, date: p.date, remarks: p.remarks }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assets'] })
      setMoveForm(null)
      toast.success('Machine moved.')
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

  function openNew(): void {
    setForm({ asset_type: 'machine', status: 'active', plant_ids: plantId ? [plantId] : [], business_id: null })
    setOpen(true)
  }
  function openEdit(a: Asset): void {
    // The form edits efficiency (distance/run per litre); convert from the stored
    // consumption (litres per unit) for display.
    const perLitre = a.standard_consumption && a.standard_consumption > 0 ? Math.round((1 / a.standard_consumption) * 1000) / 1000 : ''
    setForm({ ...a, plant_ids: a.plant_ids ?? [], std_per_litre: perLitre })
    setOpen(true)
  }
  function togglePlant(arr: number[], id: number): number[] {
    return arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]
  }
  const plantsLabel = (a: Asset): string =>
    (a.plant_names ?? []).length === 0 ? 'All plants' : (a.plant_names ?? []).join(', ')

  function exportExcel(): void {
    downloadExcel(
      'machinery-vehicles',
      'Machines & Vehicles',
      ['Name', 'Type', 'Category', 'Identifier', 'Plants', 'Business', 'Status'],
      rows.map((a) => [a.name, a.asset_type, a.category, a.identifier, plantsLabel(a), a.business_name ?? '', a.status])
    )
  }

  const meterUnit = (form.meter_type || (form.asset_type === 'vehicle' ? 'km' : 'hour')) === 'km' ? 'km' : 'hr'
  const stdEff = Number(form.std_per_litre)

  return (
    <>
      <PageHeader
        title="Machines & Vehicles"
        description="Register your machines and vehicles, assign them to plants, and open each for its logbook, ledger and documents"
        actions={
          <>
            <Button variant="outline" onClick={exportExcel} disabled={!rows.length}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button onClick={openNew}>
              <Plus size={16} /> New
            </Button>
          </>
        }
      />
      <Page>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <SearchSelect
            className="w-full sm:w-48"
            value={typeFilter}
            onChange={(v) => setTypeFilter(v as 'all' | 'machine' | 'vehicle')}
            options={[{ value: 'all', label: 'All types' }, { value: 'machine', label: 'Machines' }, { value: 'vehicle', label: 'Vehicles' }]}
          />
        </div>
        {rows.length === 0 ? (
          <EmptyState message="No machinery or vehicles yet." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Machine / Vehicle</TH>
                <TH>Plants</TH>
                <TH className="text-right">Run</TH>
                <TH className="text-right">Diesel (L)</TH>
                <TH className="text-right">Maintenance</TH>
                <TH>Status</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((a) => {
                const o = ov.get(a.id)
                const unit = (o?.meter_type ?? a.meter_type ?? 'hour') === 'km' ? 'km' : 'hr'
                return (
                  <TR key={a.id} className="cursor-pointer" onClick={() => nav(`/machinery/${a.id}`)}>
                    <TD>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{a.name}</span>
                        <Badge variant={a.asset_type === 'vehicle' ? 'default' : 'muted'}>{a.asset_type}</Badge>
                        {o?.over && (
                          <span title={`Using ${fmtQty(o.actual_consumption)} vs standard ${fmtQty(o.standard_consumption)} L/${unit}`} className="inline-flex items-center gap-0.5 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">
                            <AlertTriangle size={11} /> Over fuel
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {a.category || 'Uncategorised'}{a.identifier ? ` · ${a.identifier}` : ''}{a.business_name ? ` · ${a.business_name}` : ''}
                      </div>
                    </TD>
                    <TD className="text-muted-foreground">
                      {(a.plant_names ?? []).length === 0 ? <Badge variant="muted">All plants</Badge> : <span className="text-[13px]">{(a.plant_names ?? []).join(', ')}</span>}
                    </TD>
                    <TD className="tnum text-right">
                      {o && o.usage_qty > 0 ? <>{fmtQty(o.usage_qty)} <span className="text-xs text-muted-foreground">{unit}</span></> : <span className="text-muted-foreground">—</span>}
                    </TD>
                    <TD className="tnum text-right">{o && o.diesel_litres > 0 ? fmtQty(o.diesel_litres) : <span className="text-muted-foreground">—</span>}</TD>
                    <TD className="tnum text-right">{o && o.maintenance > 0 ? fmtMoney(o.maintenance) : <span className="text-muted-foreground">—</span>}</TD>
                    <TD className="capitalize text-muted-foreground">{a.status}</TD>
                    <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" title="Logbook, ledger & documents" onClick={() => nav(`/machinery/${a.id}`)}>
                        <Gauge size={15} />
                      </Button>
                      <Button variant="ghost" size="icon" title="Move to another plant" onClick={() => setMoveForm({ id: a.id, name: a.name, plant_ids: a.plant_ids ?? [], date: today(), remarks: '' })}>
                        <ArrowLeftRight size={15} />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => openEdit(a)}>
                        <Pencil size={15} />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => remove(a)}>
                        <Trash2 size={15} className="text-destructive" />
                      </Button>
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
      </Page>

      <Modal open={open} onClose={() => setOpen(false)} title={form.id ? 'Edit Machine / Vehicle' : 'New Machine / Vehicle'} width="max-w-2xl">
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
          <Field label="Owning Business / Firm" hint="Costs & rent of this machine roll up here">
            <SearchSelect value={form.business_id ?? ''} onChange={(v) => setForm({ ...form, business_id: v ? Number(v) : null })} options={[{ value: '', label: '— None —' }, ...businesses.map((b) => ({ value: b.id, label: b.name }))]} />
          </Field>
          <Field label="Meter" hint="Machines run on hours; vehicles on km">
            <SearchSelect value={form.meter_type || (form.asset_type === 'vehicle' ? 'km' : 'hour')} onChange={(v) => setForm({ ...form, meter_type: v as Asset['meter_type'] })} options={[{ value: 'hour', label: 'Hours' }, { value: 'km', label: 'Kilometres' }]} />
          </Field>
          <Field
            label={`Standard ${meterUnit === 'km' ? 'mileage (km / L)' : 'run (hr / L)'}`}
            hint={
              form.std_per_litre !== '' && form.std_per_litre != null && stdEff > 0
                ? `For 1 litre it runs ${meterUnit} · ≈ ${fmtQty(1 / stdEff)} L/${meterUnit} (over-use check)`
                : `How many ${meterUnit} 1 litre runs (over-use check)`
            }
          >
            <Input
              type="number"
              step="0.01"
              value={form.std_per_litre ?? ''}
              onChange={(e) => setForm({ ...form, std_per_litre: e.target.value })}
              placeholder={meterUnit === 'km' ? 'e.g. 4 = 4 km per litre' : 'e.g. 0.06 = hr per litre'}
            />
          </Field>
          <Field label="Status">
            <SearchSelect value={form.status || 'active'} onChange={(v) => setForm({ ...form, status: v as Asset['status'] })} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
          </Field>
          <div className="col-span-2">
            <Field label="Available at plants" hint="Tick the plants that use this machine. Leave all unticked to share it across every plant.">
              <PlantPicker plants={plants} selected={form.plant_ids ?? []} onToggle={(id) => setForm({ ...form, plant_ids: togglePlant(form.plant_ids ?? [], id) })} />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Remarks">
              <Input value={form.remarks || ''} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
            </Field>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            onClick={() => {
              const { std_per_litre, ...rest } = form
              const eff = Number(std_per_litre)
              const standard_consumption =
                std_per_litre !== '' && std_per_litre != null && eff > 0
                  ? Math.round((1 / eff) * 100000) / 100000
                  : null
              save.mutate({ ...rest, standard_consumption })
            }}
            disabled={!form.name?.trim()}
          >
            Save
          </Button>
        </div>
      </Modal>

      {moveForm && (
        <Modal open onClose={() => setMoveForm(null)} title={`Move — ${moveForm.name}`}>
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Set the plant(s) this machine is now used at. The change is recorded with a date in its move history.
            </p>
            <Field label="Now at plants" hint="Leave all unticked to share across every plant.">
              <PlantPicker plants={plants} selected={moveForm.plant_ids} onToggle={(id) => setMoveForm({ ...moveForm, plant_ids: togglePlant(moveForm.plant_ids, id) })} />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Move date">
                <Input type="date" value={moveForm.date} onChange={(e) => setMoveForm({ ...moveForm, date: e.target.value })} />
              </Field>
              <Field label="Remarks">
                <Input value={moveForm.remarks} onChange={(e) => setMoveForm({ ...moveForm, remarks: e.target.value })} />
              </Field>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setMoveForm(null)}>Cancel</Button>
              <Button onClick={() => move.mutate(moveForm)}>Save Move</Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

function PlantPicker({
  plants,
  selected,
  onToggle
}: {
  plants: { id: number; name: string }[]
  selected: number[]
  onToggle: (id: number) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-2">
      {plants.length === 0 ? (
        <span className="text-xs text-muted-foreground">No plants yet.</span>
      ) : (
        plants.map((p) => {
          const on = selected.includes(p.id)
          return (
            <label
              key={p.id}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
                on ? 'border-primary bg-primary/5 text-foreground' : 'border-input text-muted-foreground hover:bg-accent'
              )}
            >
              <input type="checkbox" className="h-4 w-4" checked={on} onChange={() => onToggle(p.id)} />
              {p.name}
            </label>
          )
        })
      )}
    </div>
  )
}
