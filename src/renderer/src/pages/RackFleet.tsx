import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, FileSpreadsheet, Truck, Forklift } from 'lucide-react'
import { api } from '@/lib/api'
import type { RackVehicle, RackJcb } from '@shared/types'
import { PageHeader, Page } from '@/components/layout'
import {
  Button,
  Input,
  Field,
  Modal,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
  EmptyState,
  PlantCheckboxes
} from '@/components/ui'
import { useToast } from '@/components/toast'
import { confirmDialog } from '@/components/confirm'
import { usePlant } from '@/lib/plant'
import { fmtMoney, fmtQty, downloadExcel } from '@/lib/utils'

export function RackFleet(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { plantId } = usePlant()
  const [tab, setTab] = React.useState<'vehicles' | 'jcb'>('vehicles')
  const [q, setQ] = React.useState('')

  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })
  const { data: vehicles = [] } = useQuery({ queryKey: ['rackVehicles', plantId], queryFn: () => api.rackVehicles.list(plantId) })
  const { data: jcbs = [] } = useQuery({ queryKey: ['rackJcbs', plantId], queryFn: () => api.rackJcbs.list(plantId) })

  const [vForm, setVForm] = React.useState<any>(null)
  const [jForm, setJForm] = React.useState<any>(null)

  const plantNames = (ids?: number[]): string =>
    (ids ?? []).length ? (ids ?? []).map((id) => plants.find((p) => p.id === id)?.name ?? '').filter(Boolean).join(', ') : 'All plants'

  function togglePlant(form: any, set: (f: any) => void, id: number): void {
    const cur: number[] = form.plant_ids ?? []
    set({ ...form, plant_ids: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] })
  }

  const saveVehicle = useMutation({
    mutationFn: (p: any) => (p.id ? api.rackVehicles.update(p) : api.rackVehicles.create(p)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rackVehicles'] }); setVForm(null); toast.success('Vehicle saved.') },
    onError: (e: Error) => toast.error(e.message)
  })
  const saveJcb = useMutation({
    mutationFn: (p: any) => (p.id ? api.rackJcbs.update(p) : api.rackJcbs.create(p)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rackJcbs'] }); setJForm(null); toast.success('JCB saved.') },
    onError: (e: Error) => toast.error(e.message)
  })

  async function removeVehicle(v: RackVehicle): Promise<void> {
    if (!(await confirmDialog({ title: 'Delete vehicle', message: `Delete "${v.vehicle_no}"?` }))) return
    await api.rackVehicles.delete(v.id); qc.invalidateQueries({ queryKey: ['rackVehicles'] }); toast.success('Deleted.')
  }
  async function removeJcb(j: RackJcb): Promise<void> {
    if (!(await confirmDialog({ title: 'Delete JCB', message: `Delete "${j.name}"?` }))) return
    await api.rackJcbs.delete(j.id); qc.invalidateQueries({ queryKey: ['rackJcbs'] }); toast.success('Deleted.')
  }

  const vFiltered = React.useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return vehicles
    return vehicles.filter((v) => `${v.vehicle_no} ${v.owner_name} ${v.driver_name}`.toLowerCase().includes(t))
  }, [vehicles, q])
  const jFiltered = React.useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return jcbs
    return jcbs.filter((j) => `${j.name} ${j.owner_name} ${j.driver_name}`.toLowerCase().includes(t))
  }, [jcbs, q])

  function exportExcel(): void {
    if (tab === 'vehicles') {
      downloadExcel('rack-vehicles', 'Rack Vehicles',
        ['Vehicle No', 'Owner', 'Owner Mobile', 'Driver', 'Driver Mobile', 'Cap (m³)', 'Cap (Ton)', 'Cap (CFT)', 'Rate / Trip', 'Plants'],
        vehicles.map((v) => [v.vehicle_no, v.owner_name, v.owner_mobile, v.driver_name, v.driver_mobile, v.cap_cm ?? '', v.cap_ton ?? '', v.cap_cft ?? '', v.rate_per_trip ?? '', plantNames(v.plant_ids)]))
    } else {
      downloadExcel('rack-jcbs', 'Rack JCB Loaders',
        ['JCB', 'Owner', 'Owner Mobile', 'Driver', 'Driver Mobile', 'Unloading /wagon', 'Loading /tipper', 'Other /hour', 'Plants'],
        jcbs.map((j) => [j.name, j.owner_name, j.owner_mobile, j.driver_name, j.driver_mobile, j.rate_unloading ?? '', j.rate_loading ?? '', j.rate_other ?? '', plantNames(j.plant_ids)]))
    }
  }

  function newVehicle(): void {
    setVForm({ vehicle_no: '', owner_name: '', owner_mobile: '', driver_name: '', driver_mobile: '', cap_cm: '', cap_ton: '', cap_cft: '', rate_per_trip: '', remarks: '', plant_ids: plantId ? [plantId] : [] })
  }
  function newJcb(): void {
    setJForm({ name: '', owner_name: '', owner_mobile: '', driver_name: '', driver_mobile: '', rate_unloading: '', rate_loading: '', rate_other: '', remarks: '', plant_ids: plantId ? [plantId] : [] })
  }

  return (
    <>
      <PageHeader
        title="Rack Vehicles & JCB"
        description="Hired vehicles and JCB loaders for railway-rack work, available per plant"
        actions={
          <>
            <Button variant="outline" onClick={exportExcel} disabled={tab === 'vehicles' ? !vehicles.length : !jcbs.length}>
              <FileSpreadsheet size={16} /> Excel
            </Button>
            <Button onClick={tab === 'vehicles' ? newVehicle : newJcb} disabled={!plants.length}>
              <Plus size={16} /> {tab === 'vehicles' ? 'New Vehicle' : 'New JCB'}
            </Button>
          </>
        }
      />
      <Page>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button variant={tab === 'vehicles' ? 'default' : 'outline'} size="sm" onClick={() => setTab('vehicles')}><Truck size={15} /> Vehicles</Button>
          <Button variant={tab === 'jcb' ? 'default' : 'outline'} size="sm" onClick={() => setTab('jcb')}><Forklift size={15} /> JCB Loaders</Button>
          <span className="mx-1 h-5 w-px bg-border" />
          <Input className="w-full sm:w-60" placeholder="Search no, owner, driver…" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <Button variant="ghost" size="sm" onClick={() => setQ('')}>Clear</Button>}
        </div>

        {tab === 'vehicles' ? (
          vFiltered.length === 0 ? (
            <EmptyState message={vehicles.length ? 'No vehicles match your search.' : 'No vehicles yet. Add a vehicle to build the rack fleet.'} />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Vehicle No</TH>
                  <TH>Owner</TH>
                  <TH>Driver</TH>
                  <TH className="text-right">Capacity (m³ / Ton / CFT)</TH>
                  <TH className="text-right">Rate / Trip</TH>
                  <TH>Plants</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {vFiltered.map((v) => (
                  <TR key={v.id}>
                    <TD className="font-medium">{v.vehicle_no}</TD>
                    <TD className="text-muted-foreground">{[v.owner_name, v.owner_mobile].filter(Boolean).join(' · ') || '-'}</TD>
                    <TD className="text-muted-foreground">{[v.driver_name, v.driver_mobile].filter(Boolean).join(' · ') || '-'}</TD>
                    <TD className="tnum text-right">{[v.cap_cm, v.cap_ton, v.cap_cft].map((c) => (c == null ? '–' : fmtQty(c))).join(' / ')}</TD>
                    <TD className="tnum text-right">{v.rate_per_trip == null ? '-' : fmtMoney(v.rate_per_trip)}</TD>
                    <TD className="text-muted-foreground">{plantNames(v.plant_ids)}</TD>
                    <TD className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => setVForm({ ...v, cap_cm: v.cap_cm ?? '', cap_ton: v.cap_ton ?? '', cap_cft: v.cap_cft ?? '', rate_per_trip: v.rate_per_trip ?? '', plant_ids: v.plant_ids ?? [] })}><Pencil size={15} /></Button>
                      <Button variant="ghost" size="icon" onClick={() => removeVehicle(v)}><Trash2 size={15} className="text-destructive" /></Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )
        ) : jFiltered.length === 0 ? (
          <EmptyState message={jcbs.length ? 'No JCBs match your search.' : 'No JCB loaders yet. Add one with its per-work-type rates.'} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>JCB</TH>
                <TH>Owner</TH>
                <TH>Driver</TH>
                <TH className="text-right">Unloading (/wagon)</TH>
                <TH className="text-right">Loading (/tipper)</TH>
                <TH className="text-right">Other (/hour)</TH>
                <TH>Plants</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {jFiltered.map((j) => (
                <TR key={j.id}>
                  <TD className="font-medium">{j.name}</TD>
                  <TD className="text-muted-foreground">{[j.owner_name, j.owner_mobile].filter(Boolean).join(' · ') || '-'}</TD>
                  <TD className="text-muted-foreground">{[j.driver_name, j.driver_mobile].filter(Boolean).join(' · ') || '-'}</TD>
                  <TD className="tnum text-right">{j.rate_unloading == null ? '-' : fmtMoney(j.rate_unloading)}</TD>
                  <TD className="tnum text-right">{j.rate_loading == null ? '-' : fmtMoney(j.rate_loading)}</TD>
                  <TD className="tnum text-right">{j.rate_other == null ? '-' : fmtMoney(j.rate_other)}</TD>
                  <TD className="text-muted-foreground">{plantNames(j.plant_ids)}</TD>
                  <TD className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => setJForm({ ...j, rate_unloading: j.rate_unloading ?? '', rate_loading: j.rate_loading ?? '', rate_other: j.rate_other ?? '', plant_ids: j.plant_ids ?? [] })}><Pencil size={15} /></Button>
                    <Button variant="ghost" size="icon" onClick={() => removeJcb(j)}><Trash2 size={15} className="text-destructive" /></Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Page>

      {/* Vehicle modal */}
      {vForm && (
        <Modal open onClose={() => setVForm(null)} title={vForm.id ? `Edit ${vForm.vehicle_no}` : 'New Vehicle'} width="max-w-2xl">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Vehicle No." required><Input value={vForm.vehicle_no} onChange={(e) => setVForm({ ...vForm, vehicle_no: e.target.value })} placeholder="e.g. JH-01-AB-1234" /></Field>
            <Field label="Rate per Trip (₹)"><Input type="number" step="0.01" value={vForm.rate_per_trip} onChange={(e) => setVForm({ ...vForm, rate_per_trip: e.target.value })} placeholder="Optional" /></Field>
            <Field label="Owner Name"><Input value={vForm.owner_name} onChange={(e) => setVForm({ ...vForm, owner_name: e.target.value })} /></Field>
            <Field label="Owner Mobile"><Input value={vForm.owner_mobile} onChange={(e) => setVForm({ ...vForm, owner_mobile: e.target.value })} /></Field>
            <Field label="Driver Name"><Input value={vForm.driver_name} onChange={(e) => setVForm({ ...vForm, driver_name: e.target.value })} /></Field>
            <Field label="Driver Mobile"><Input value={vForm.driver_mobile} onChange={(e) => setVForm({ ...vForm, driver_mobile: e.target.value })} /></Field>
            <Field label="Capacity (m³)"><Input type="number" step="0.001" value={vForm.cap_cm} onChange={(e) => setVForm({ ...vForm, cap_cm: e.target.value })} placeholder="per trip" /></Field>
            <Field label="Capacity (Ton)"><Input type="number" step="0.001" value={vForm.cap_ton} onChange={(e) => setVForm({ ...vForm, cap_ton: e.target.value })} placeholder="per trip" /></Field>
            <Field label="Capacity (CFT)"><Input type="number" step="0.001" value={vForm.cap_cft} onChange={(e) => setVForm({ ...vForm, cap_cft: e.target.value })} placeholder="per trip" /></Field>
            <Field label="Remarks"><Input value={vForm.remarks} onChange={(e) => setVForm({ ...vForm, remarks: e.target.value })} /></Field>
          </div>
          <div className="mt-4">
            <Field label="Plants" hint="Tick the plants this vehicle works for — leave all unticked for all plants">
              <PlantCheckboxes plants={plants} selected={vForm.plant_ids ?? []} onToggle={(id) => togglePlant(vForm, setVForm, id)} />
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setVForm(null)}>Cancel</Button>
            <Button onClick={() => saveVehicle.mutate(vForm)} disabled={!vForm.vehicle_no?.trim()}>Save Vehicle</Button>
          </div>
        </Modal>
      )}

      {/* JCB modal */}
      {jForm && (
        <Modal open onClose={() => setJForm(null)} title={jForm.id ? `Edit ${jForm.name}` : 'New JCB Loader'} width="max-w-2xl">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="JCB Name / No." required><Input value={jForm.name} onChange={(e) => setJForm({ ...jForm, name: e.target.value })} placeholder="e.g. JCB-01" /></Field>
            <div className="hidden sm:block" />
            <Field label="Owner Name"><Input value={jForm.owner_name} onChange={(e) => setJForm({ ...jForm, owner_name: e.target.value })} /></Field>
            <Field label="Owner Mobile"><Input value={jForm.owner_mobile} onChange={(e) => setJForm({ ...jForm, owner_mobile: e.target.value })} /></Field>
            <Field label="Driver Name"><Input value={jForm.driver_name} onChange={(e) => setJForm({ ...jForm, driver_name: e.target.value })} /></Field>
            <Field label="Driver Mobile"><Input value={jForm.driver_mobile} onChange={(e) => setJForm({ ...jForm, driver_mobile: e.target.value })} /></Field>
          </div>
          <div className="mt-4 space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground/80">Rates by work type</div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="JCB Unloading" hint="per wagon"><Input type="number" step="0.01" value={jForm.rate_unloading} onChange={(e) => setJForm({ ...jForm, rate_unloading: e.target.value })} placeholder="₹ / wagon" /></Field>
              <Field label="JCB Loading" hint="per tipper load"><Input type="number" step="0.01" value={jForm.rate_loading} onChange={(e) => setJForm({ ...jForm, rate_loading: e.target.value })} placeholder="₹ / tipper" /></Field>
              <Field label="Other Work" hint="per hour"><Input type="number" step="0.01" value={jForm.rate_other} onChange={(e) => setJForm({ ...jForm, rate_other: e.target.value })} placeholder="₹ / hour" /></Field>
            </div>
          </div>
          <div className="mt-4">
            <Field label="Remarks"><Input value={jForm.remarks} onChange={(e) => setJForm({ ...jForm, remarks: e.target.value })} /></Field>
          </div>
          <div className="mt-4">
            <Field label="Plants" hint="Tick the plants this JCB works for — leave all unticked for all plants">
              <PlantCheckboxes plants={plants} selected={jForm.plant_ids ?? []} onToggle={(id) => togglePlant(jForm, setJForm, id)} />
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setJForm(null)}>Cancel</Button>
            <Button onClick={() => saveJcb.mutate(jForm)} disabled={!jForm.name?.trim()}>Save JCB</Button>
          </div>
        </Modal>
      )}
    </>
  )
}
