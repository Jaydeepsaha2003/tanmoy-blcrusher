import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Tags, Truck, MapPin } from 'lucide-react'
import { api } from '@/lib/api'
import type { RateChartRow, TransportCharge, Destination, Uom, TransportBasis } from '@shared/types'
import { UOMS } from '@shared/types'
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
  CardHeader,
  CardTitle,
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
import { fmtMoney } from '@/lib/utils'

const LORRY_TYPES = ['Tractor', 'Tipper', 'Dumper', '6 Wheeler', '10 Wheeler', '12 Wheeler', '14 Wheeler', 'Truck']
const basisLabel: Record<TransportBasis, string> = { trip: 'Per Trip', cm: 'Per m³', ton: 'Per Ton' }

export function RateChart(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { plantId } = usePlant()
  const { data: locations = [] } = useQuery({ queryKey: ['locations', 0], queryFn: () => api.locations.list() })
  const { data: products = [] } = useQuery({ queryKey: ['products', plantId], queryFn: () => api.products.list(plantId) })
  const { data: destinations = [] } = useQuery({ queryKey: ['destinations'], queryFn: api.destinations.list })
  const { data: rows = [] } = useQuery({ queryKey: ['rateChart', plantId], queryFn: () => api.rateChart.list(plantId) })
  const { data: transport = [] } = useQuery({ queryKey: ['transportCharges', plantId], queryFn: () => api.transportCharges.list(plantId) })

  const formLocations = locations.filter((l) => !plantId || l.plant_id === plantId)

  const [rateForm, setRateForm] = React.useState<Partial<RateChartRow> | null>(null)
  const [tForm, setTForm] = React.useState<Partial<TransportCharge> | null>(null)
  const [destForm, setDestForm] = React.useState<Partial<Destination> | null>(null)

  const saveRate = useMutation({
    mutationFn: (p: Partial<RateChartRow>) => (p.id ? api.rateChart.update(p) : api.rateChart.create(p)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rateChart'] })
      setRateForm(null)
      toast.success('Rate saved.')
    },
    onError: (e: Error) => toast.error(e.message)
  })
  const saveTransport = useMutation({
    mutationFn: (p: Partial<TransportCharge>) =>
      p.id ? api.transportCharges.update(p) : api.transportCharges.create(p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transportCharges'] })
      setTForm(null)
      toast.success('Transport rate saved.')
    },
    onError: (e: Error) => toast.error(e.message)
  })
  const saveDest = useMutation({
    mutationFn: (p: Partial<Destination>) => (p.id ? api.destinations.update(p) : api.destinations.create(p)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['destinations'] })
      setDestForm(null)
      toast.success('Destination saved.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  async function removeRate(r: RateChartRow): Promise<void> {
    if (!(await confirmDialog({ title: 'Delete rate', message: `Delete the rate for ${r.product_name}?` }))) return
    await api.rateChart.delete(r.id!)
    qc.invalidateQueries({ queryKey: ['rateChart'] })
    toast.success('Rate deleted.')
  }
  async function removeTransport(t: TransportCharge): Promise<void> {
    if (!(await confirmDialog({ title: 'Delete rate', message: `Delete the ${t.vehicle_type} rate?` }))) return
    await api.transportCharges.delete(t.id!)
    qc.invalidateQueries({ queryKey: ['transportCharges'] })
    toast.success('Transport rate deleted.')
  }
  async function removeDest(x: Destination): Promise<void> {
    if (!(await confirmDialog({ title: 'Delete destination', message: `Delete "${x.name}"?` }))) return
    const res = await api.destinations.delete(x.id)
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ['destinations'] })
      toast.success('Destination deleted.')
    } else toast.error(res.error || 'Could not delete destination.')
  }

  const noPlants = locations.length === 0
  const destName = (id?: number | null): string => destinations.find((d) => d.id === id)?.name ?? ''

  return (
    <>
      <PageHeader
        title="Rate Chart"
        description="Product rates per location (Wholesale / Retail / Customer) and origin → destination transport rates by vehicle type"
      />
      <Page>
        {/* Product rates */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2"><Tags size={18} /> Product Rates</CardTitle>
            <Button
              size="sm"
              disabled={noPlants || products.length === 0}
              onClick={() =>
                setRateForm({
                  product_name: '',
                  stock_location_id: formLocations[0]?.id,
                  uom: 'CM',
                  rate_wholesale: 0,
                  rate_retail: 0,
                  rate_customer: 0
                })
              }
            >
              <Plus size={15} /> New Rate
            </Button>
          </CardHeader>
          <CardContent>
            {noPlants ? (
              <EmptyState message="Create a plant and stock location first." />
            ) : products.length === 0 ? (
              <EmptyState message="Add products first (Products menu)." />
            ) : rows.length === 0 ? (
              <EmptyState message="No rates yet. Add a product rate for a location." />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Product</TH>
                    <TH>Location</TH>
                    <TH>Unit</TH>
                    <TH className="text-right">Wholesale</TH>
                    <TH className="text-right">Retail</TH>
                    <TH className="text-right">Customer</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((r) => (
                    <TR key={r.id}>
                      <TD className="font-medium">{r.product_name}</TD>
                      <TD className="text-muted-foreground">{r.plant_name} · {r.stock_location_name}</TD>
                      <TD><Badge variant="muted">{r.uom}</Badge></TD>
                      <TD className="tnum text-right">{fmtMoney(r.rate_wholesale)}</TD>
                      <TD className="tnum text-right">{fmtMoney(r.rate_retail)}</TD>
                      <TD className="tnum text-right">{fmtMoney(r.rate_customer)}</TD>
                      <TD className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => setRateForm(r)}><Pencil size={15} /></Button>
                        <Button variant="ghost" size="icon" onClick={() => removeRate(r)}><Trash2 size={15} className="text-destructive" /></Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Transport / delivery rates (origin → destination) */}
        <Card className="mt-6">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2"><Truck size={18} /> Transport Rates <span className="text-sm font-normal text-muted-foreground">· origin → destination</span></CardTitle>
            <Button
              size="sm"
              disabled={noPlants}
              onClick={() => setTForm({ vehicle_type: '', stock_location_id: formLocations[0]?.id, destination_id: null, basis: 'trip', charge: 0 })}
            >
              <Plus size={15} /> New Rate
            </Button>
          </CardHeader>
          <CardContent>
            {noPlants ? (
              <EmptyState message="Create a plant and stock location first." />
            ) : transport.length === 0 ? (
              <EmptyState message="No transport rates yet. Add a rate per origin, destination and lorry type." />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Origin (Location)</TH>
                    <TH>Destination</TH>
                    <TH>Vehicle / Lorry</TH>
                    <TH>Basis</TH>
                    <TH className="text-right">Rate</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {transport.map((t) => (
                    <TR key={t.id}>
                      <TD className="text-muted-foreground">{t.plant_name} · {t.stock_location_name}</TD>
                      <TD className="font-medium">{t.destination_name ?? <span className="font-normal text-muted-foreground">Any destination</span>}</TD>
                      <TD>{t.vehicle_type}</TD>
                      <TD><Badge variant="muted">{basisLabel[t.basis]}</Badge></TD>
                      <TD className="tnum text-right">{fmtMoney(t.charge)}</TD>
                      <TD className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => setTForm(t)}><Pencil size={15} /></Button>
                        <Button variant="ghost" size="icon" onClick={() => removeTransport(t)}><Trash2 size={15} className="text-destructive" /></Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Destinations master */}
        <Card className="mt-6">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2"><MapPin size={18} /> Destinations</CardTitle>
            <Button size="sm" onClick={() => setDestForm({ name: '', remarks: '' })}>
              <Plus size={15} /> New Destination
            </Button>
          </CardHeader>
          <CardContent>
            {destinations.length === 0 ? (
              <EmptyState message="No destinations yet. Add the places you deliver to, then use them in transport rates." />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Destination</TH>
                    <TH>Remarks</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {destinations.map((x) => (
                    <TR key={x.id}>
                      <TD className="font-medium">{x.name}</TD>
                      <TD className="text-muted-foreground">{x.remarks || '-'}</TD>
                      <TD className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => setDestForm(x)}><Pencil size={15} /></Button>
                        <Button variant="ghost" size="icon" onClick={() => removeDest(x)}><Trash2 size={15} className="text-destructive" /></Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </Page>

      {/* Rate modal */}
      {rateForm && (
        <Modal open onClose={() => setRateForm(null)} title={rateForm.id ? 'Edit Rate' : 'New Product Rate'} width="max-w-xl">
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Product">
                <SearchSelect value={rateForm.product_name || ''} onChange={(v) => setRateForm({ ...rateForm, product_name: v })} options={[...(rateForm.product_name && !products.some((p) => p.name === rateForm.product_name) ? [{ value: rateForm.product_name, label: rateForm.product_name }] : []), ...products.map((p) => ({ value: p.name, label: p.name }))]} placeholder="Select…" />
              </Field>
              <Field label="Location" className="sm:col-span-2">
                <SearchSelect value={rateForm.stock_location_id || ''} onChange={(v) => setRateForm({ ...rateForm, stock_location_id: Number(v) })} options={formLocations.map((l) => ({ value: l.id, label: `${l.plant_name} · ${l.name}` }))} placeholder="Select…" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Unit">
                <SearchSelect value={rateForm.uom || 'CM'} onChange={(v) => setRateForm({ ...rateForm, uom: v as Uom })} options={UOMS.map((u) => ({ value: u, label: u }))} />
              </Field>
              <Field label="Wholesale ₹">
                <Input type="number" step="0.01" value={rateForm.rate_wholesale ?? ''} onChange={(e) => setRateForm({ ...rateForm, rate_wholesale: Number(e.target.value) })} />
              </Field>
              <Field label="Retail ₹">
                <Input type="number" step="0.01" value={rateForm.rate_retail ?? ''} onChange={(e) => setRateForm({ ...rateForm, rate_retail: Number(e.target.value) })} />
              </Field>
              <Field label="Customer ₹">
                <Input type="number" step="0.01" value={rateForm.rate_customer ?? ''} onChange={(e) => setRateForm({ ...rateForm, rate_customer: Number(e.target.value) })} />
              </Field>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setRateForm(null)}>Cancel</Button>
              <Button onClick={() => saveRate.mutate(rateForm)} disabled={!rateForm.product_name || !rateForm.stock_location_id}>Save</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Transport rate modal */}
      {tForm && (
        <Modal open onClose={() => setTForm(null)} title={tForm.id ? 'Edit Transport Rate' : 'New Transport Rate'} width="max-w-xl">
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Origin (Location)">
                <SearchSelect value={tForm.stock_location_id || ''} onChange={(v) => setTForm({ ...tForm, stock_location_id: Number(v) })} options={formLocations.map((l) => ({ value: l.id, label: `${l.plant_name} · ${l.name}` }))} placeholder="Select…" />
              </Field>
              <Field label="Destination" hint="Leave as “Any” for a general origin charge">
                <SearchSelect
                  value={tForm.destination_id ?? ''}
                  onChange={(v) => setTForm({ ...tForm, destination_id: v ? Number(v) : null })}
                  options={[{ value: '', label: 'Any destination' }, ...destinations.map((d) => ({ value: d.id, label: d.name }))]}
                  placeholder="Any destination"
                />
              </Field>
              <Field label="Vehicle / Lorry Type">
                <Input list="lorry-types" value={tForm.vehicle_type || ''} onChange={(e) => setTForm({ ...tForm, vehicle_type: e.target.value })} placeholder="e.g. 10 Wheeler" />
                <datalist id="lorry-types">{LORRY_TYPES.map((v) => <option key={v} value={v} />)}</datalist>
              </Field>
              <Field label="Basis">
                <SearchSelect value={tForm.basis || 'trip'} onChange={(v) => setTForm({ ...tForm, basis: v as TransportBasis })} options={[{ value: 'trip', label: 'Per Trip' }, { value: 'cm', label: 'Per m³' }, { value: 'ton', label: 'Per Ton' }]} />
              </Field>
              <Field label="Rate ₹">
                <Input type="number" step="0.01" value={tForm.charge ?? ''} onChange={(e) => setTForm({ ...tForm, charge: Number(e.target.value) })} />
              </Field>
            </div>
            {tForm.stock_location_id && tForm.vehicle_type?.trim() && (
              <div className="rounded-lg bg-muted/60 px-4 py-2 text-sm text-muted-foreground">
                {formLocations.find((l) => l.id === tForm.stock_location_id)?.name} → <b className="text-foreground">{tForm.destination_id ? destName(tForm.destination_id) : 'Any destination'}</b> · {tForm.vehicle_type} · {basisLabel[tForm.basis || 'trip']} · <b className="text-foreground">{fmtMoney(tForm.charge)}</b>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setTForm(null)}>Cancel</Button>
              <Button onClick={() => saveTransport.mutate(tForm)} disabled={!tForm.vehicle_type?.trim() || !tForm.stock_location_id}>Save</Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Destination modal */}
      {destForm && (
        <Modal open onClose={() => setDestForm(null)} title={destForm.id ? 'Edit Destination' : 'New Destination'}>
          <div className="space-y-4">
            <Field label="Destination Name">
              <Input value={destForm.name || ''} onChange={(e) => setDestForm({ ...destForm, name: e.target.value })} placeholder="e.g. Guwahati, Silchar, Site A" />
            </Field>
            <Field label="Remarks" hint="Optional">
              <Input value={destForm.remarks || ''} onChange={(e) => setDestForm({ ...destForm, remarks: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setDestForm(null)}>Cancel</Button>
              <Button onClick={() => saveDest.mutate(destForm)} disabled={!destForm.name?.trim()}>Save</Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
