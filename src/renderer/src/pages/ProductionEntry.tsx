import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Cog } from 'lucide-react'
import { api } from '@/lib/api'
import type { Production } from '@shared/types'
import { toCm, UOMS } from '@shared/types'
import { PageHeader, Page } from '@/components/layout'
import {
  Button,
  Input,
  Select,
  SearchSelect,
  Field,
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
import { fmtQty, fmtDate, today } from '@/lib/utils'

export function ProductionEntry(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { plantId } = usePlant()
  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })
  const { data: locations = [] } = useQuery({ queryKey: ['locations', 0], queryFn: () => api.locations.list() })
  const { data = [] } = useQuery({ queryKey: ['productions', plantId], queryFn: () => api.productions.list({ plant_id: plantId }) })

  const [open, setOpen] = React.useState(false)
  const [form, setForm] = React.useState<any>(null)
  const [preview, setPreview] = React.useState<{ product_name: string; percentage: number; quantity: number }[]>([])

  const formLocations = locations.filter((l) => l.plant_id === form?.plant_id)
  const selectedLoc = locations.find((l) => l.id === form?.stock_location_id)
  const formPlant = plants.find((p) => p.id === form?.plant_id)
  const rawQtyCm = form ? toCm(Number(form.quantity) || 0, form.uom || 'CM', formPlant) : 0

  React.useEffect(() => {
    let active = true
    if (form?.plant_id && rawQtyCm > 0) {
      api.productions.preview(form.plant_id, rawQtyCm).then((p) => {
        if (active) setPreview(p)
      })
    } else setPreview([])
    return () => {
      active = false
    }
  }, [form?.plant_id, rawQtyCm])

  const save = useMutation({
    mutationFn: (p: any) => api.productions.create(p),
    onSuccess: () => {
      qc.invalidateQueries()
      setOpen(false)
      toast.success('Production recorded. Stock updated.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  function openNew(): void {
    setForm({ plant_id: plantId ?? plants[0]?.id, stock_location_id: undefined, uom: 'CM', quantity: '', date: today(), remarks: '' })
    setOpen(true)
  }

  async function remove(p: Production): Promise<void> {
    const ok = await confirmDialog({ title: 'Delete production', message: `Delete ${p.production_no}? Stock will be reversed.` })
    if (!ok) return
    const res = await api.productions.delete(p.id)
    if (res.ok) {
      qc.invalidateQueries()
      toast.success('Production deleted.')
    } else toast.error(res.error || 'Could not delete.')
  }

  return (
    <>
      <PageHeader
        title="Production Entry"
        description="Process raw material into finished goods"
        actions={
          <Button onClick={openNew} disabled={!plants.length}>
            <Plus size={16} /> New Production
          </Button>
        }
      />
      <Page>
        {data.length === 0 ? (
          <EmptyState message="No production entries yet." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Production No</TH>
                <TH>Date</TH>
                <TH>Plant</TH>
                <TH>Location</TH>
                <TH className="text-right">Raw Used</TH>
                <TH>Outputs</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {data.map((p) => (
                <TR key={p.id}>
                  <TD className="font-mono text-xs font-medium">{p.production_no}</TD>
                  <TD>{fmtDate(p.date)}</TD>
                  <TD className="font-medium">{p.plant_name}</TD>
                  <TD className="text-muted-foreground">{p.stock_location_name}</TD>
                  <TD className="whitespace-nowrap text-right">
                    {fmtQty(p.quantity || p.raw_qty)} <span className="text-[11px] text-muted-foreground">{p.uom || 'CM'}</span>
                    {(p.uom || 'CM') !== 'CM' && <div className="text-[11px] text-muted-foreground">{fmtQty(p.raw_qty)} m³</div>}
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {p.outputs?.map((o) => (
                        <span key={o.id} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                          {o.product_name}: {fmtQty(o.quantity)}
                        </span>
                      ))}
                    </div>
                  </TD>
                  <TD className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => remove(p)}>
                      <Trash2 size={15} className="text-destructive" />
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Page>

      {form && (
        <Modal open={open} onClose={() => setOpen(false)} title="New Production" width="max-w-2xl">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Plant" hint={plantId ? 'Locked to active plant' : undefined}>
              <SearchSelect
                value={form.plant_id || ''}
                disabled={!!plantId}
                onChange={(v) => setForm({ ...form, plant_id: Number(v), stock_location_id: undefined })}
                options={plants.map((p) => ({ value: p.id, label: p.name }))}
              />
            </Field>
            <Field label="Production Date">
              <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </Field>
            <Field
              label="Stock Location"
              required={formLocations.length > 0}
              hint={
                selectedLoc
                  ? `Available: ${fmtQty(selectedLoc.balance_qty)} m³`
                  : formLocations.length > 0
                    ? 'Pick which location to draw raw material from'
                    : 'No locations for this plant — the plant itself is used as the default'
              }
            >
              <SearchSelect
                value={form.stock_location_id || ''}
                placeholder="Select stock location…"
                onChange={(v) =>
                  setForm({ ...form, stock_location_id: v ? Number(v) : undefined })
                }
                options={
                  formLocations.length > 0
                    ? formLocations.map((l) => ({ value: l.id, label: `${l.name} (${fmtQty(l.balance_qty)} m³)` }))
                    : [{ value: '', label: 'Plant default (auto)' }]
                }
              />
            </Field>
            <Field label="Raw Material Unit">
              <SearchSelect
                value={form.uom || 'CM'}
                onChange={(v) => setForm({ ...form, uom: v })}
                options={UOMS.map((u) => ({ value: u, label: u }))}
              />
            </Field>
            <Field
              label={`Raw Material Qty (${form.uom || 'CM'})`}
              hint={(form.uom || 'CM') === 'CM' ? 'Stored as cubic metres' : `= ${fmtQty(rawQtyCm)} m³`}
            >
              <Input type="number" step="0.001" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
            </Field>
            <div className="col-span-2">
              <Field label="Remarks">
                <Input value={form.remarks || ''} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
              </Field>
            </div>
          </div>

          {preview.length > 0 && (
            <Card className="mt-4">
              <CardContent className="pt-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Cog size={15} /> Finished Goods Output (auto-calculated)
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                  {preview.map((o) => (
                    <div key={o.product_name} className="flex justify-between border-b border-dashed py-1">
                      <span className="text-muted-foreground">{o.product_name} ({o.percentage}%)</span>
                      <span className="font-medium">{fmtQty(o.quantity)} m³</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          {form.plant_id && preview.length === 0 && rawQtyCm > 0 && (
            <p className="mt-3 text-sm text-destructive">
              No production settings for this plant. Set them up in Production Settings first.
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={() => save.mutate({ ...form, quantity: Number(form.quantity), uom: form.uom || 'CM' })}
              disabled={!(Number(form.quantity) > 0) || preview.length === 0 || (formLocations.length > 0 && !form.stock_location_id)}
            >
              Submit Production
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}
