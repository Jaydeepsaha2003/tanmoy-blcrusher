import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Tags, Truck } from 'lucide-react'
import { api } from '@/lib/api'
import type { RateChartRow, TransportCharge, Uom, TransportBasis } from '@shared/types'
import { UOMS } from '@shared/types'
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
  const { data: products = [] } = useQuery({ queryKey: ['products'], queryFn: () => api.products.list() })
  const { data: rows = [] } = useQuery({ queryKey: ['rateChart', plantId], queryFn: () => api.rateChart.list(plantId) })
  const { data: transport = [] } = useQuery({ queryKey: ['transportCharges', plantId], queryFn: () => api.transportCharges.list(plantId) })

  const formLocations = locations.filter((l) => !plantId || l.plant_id === plantId)

  const [rateForm, setRateForm] = React.useState<Partial<RateChartRow> | null>(null)
  const [tForm, setTForm] = React.useState<Partial<TransportCharge> | null>(null)

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
      toast.success('Transport charge saved.')
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
    if (!(await confirmDialog({ title: 'Delete charge', message: `Delete the ${t.vehicle_type} charge?` }))) return
    await api.transportCharges.delete(t.id!)
    qc.invalidateQueries({ queryKey: ['transportCharges'] })
    toast.success('Transport charge deleted.')
  }

  const noPlants = locations.length === 0

  return (
    <>
      <PageHeader
        title="Rate Chart"
        description="Set product rates per location for Wholesale / Retail / Customer, plus transport charges by lorry type"
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

        {/* Transport charges */}
        <Card className="mt-6">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2"><Truck size={18} /> Transport Charges</CardTitle>
            <Button
              size="sm"
              disabled={noPlants}
              onClick={() =>
                setTForm({ vehicle_type: '', stock_location_id: formLocations[0]?.id, basis: 'trip', charge: 0 })
              }
            >
              <Plus size={15} /> New Charge
            </Button>
          </CardHeader>
          <CardContent>
            {noPlants ? (
              <EmptyState message="Create a plant and stock location first." />
            ) : transport.length === 0 ? (
              <EmptyState message="No transport charges yet. Add a charge per lorry type and location." />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Vehicle / Lorry</TH>
                    <TH>Location</TH>
                    <TH>Basis</TH>
                    <TH className="text-right">Charge</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {transport.map((t) => (
                    <TR key={t.id}>
                      <TD className="font-medium">{t.vehicle_type}</TD>
                      <TD className="text-muted-foreground">{t.plant_name} · {t.stock_location_name}</TD>
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

      {/* Transport modal */}
      {tForm && (
        <Modal open onClose={() => setTForm(null)} title={tForm.id ? 'Edit Transport Charge' : 'New Transport Charge'} width="max-w-xl">
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Vehicle / Lorry Type">
                <Input list="lorry-types" value={tForm.vehicle_type || ''} onChange={(e) => setTForm({ ...tForm, vehicle_type: e.target.value })} placeholder="e.g. 10 Wheeler" />
                <datalist id="lorry-types">{LORRY_TYPES.map((v) => <option key={v} value={v} />)}</datalist>
              </Field>
              <Field label="Location">
                <SearchSelect value={tForm.stock_location_id || ''} onChange={(v) => setTForm({ ...tForm, stock_location_id: Number(v) })} options={formLocations.map((l) => ({ value: l.id, label: `${l.plant_name} · ${l.name}` }))} placeholder="Select…" />
              </Field>
              <Field label="Basis">
                <SearchSelect value={tForm.basis || 'trip'} onChange={(v) => setTForm({ ...tForm, basis: v as TransportBasis })} options={[{ value: 'trip', label: 'Per Trip' }, { value: 'cm', label: 'Per m³' }, { value: 'ton', label: 'Per Ton' }]} />

              </Field>
              <Field label="Charge ₹">
                <Input type="number" step="0.01" value={tForm.charge ?? ''} onChange={(e) => setTForm({ ...tForm, charge: Number(e.target.value) })} />
              </Field>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setTForm(null)}>Cancel</Button>
              <Button onClick={() => saveTransport.mutate(tForm)} disabled={!tForm.vehicle_type?.trim() || !tForm.stock_location_id}>Save</Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
