import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Save } from 'lucide-react'
import { api } from '@/lib/api'
import { PageHeader, Page } from '@/components/layout'
import { Button, Input, Select, Card, CardContent, EmptyState } from '@/components/ui'
import { useToast } from '@/components/toast'
import { usePlant } from '@/lib/plant'
import { cn } from '@/lib/utils'

interface Row {
  product_name: string
  output_percentage: number | string
}

export function ProductionSettings(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { plantId: globalPlant } = usePlant()
  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })
  const [plantId, setPlantId] = React.useState<number | undefined>(globalPlant)

  React.useEffect(() => {
    if (globalPlant) setPlantId(globalPlant)
  }, [globalPlant])
  React.useEffect(() => {
    if (!plantId && plants.length) setPlantId(plants[0].id)
  }, [plants, plantId])

  const { data: settings = [] } = useQuery({
    queryKey: ['productionSettings', plantId],
    queryFn: () => api.productionSettings.list(plantId!),
    enabled: !!plantId
  })

  const [rows, setRows] = React.useState<Row[]>([])
  React.useEffect(() => {
    setRows(
      settings.length
        ? settings.map((s) => ({ product_name: s.product_name, output_percentage: s.output_percentage }))
        : [{ product_name: '', output_percentage: '' }]
    )
  }, [settings])

  const total = rows.reduce((s, r) => s + (Number(r.output_percentage) || 0), 0)
  const totalOk = Math.abs(total - 100) < 0.001

  const save = useMutation({
    mutationFn: () =>
      api.productionSettings.save(
        plantId!,
        rows.map((r) => ({ product_name: r.product_name, output_percentage: Number(r.output_percentage) || 0 }))
      ),
    onSuccess: (res) => {
      if (res.ok) {
        qc.invalidateQueries({ queryKey: ['productionSettings'] })
        toast.success('Production settings saved.')
      } else toast.error(res.error || 'Could not save.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  function update(i: number, patch: Partial<Row>): void {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  return (
    <>
      <PageHeader
        title="Production Settings"
        description="Define finished-goods output percentages per plant (must total 100%)"
      />
      <Page>
        {plants.length === 0 ? (
          <EmptyState message="Create a plant first." />
        ) : (
          <div className="max-w-2xl space-y-4">
            <Select className="w-full sm:w-72" value={plantId || ''} disabled={!!globalPlant} onChange={(e) => setPlantId(Number(e.target.value))}>
              {plants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>

            <Card>
              <CardContent className="pt-5">
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_140px_40px] gap-2 px-1 text-xs font-semibold uppercase text-muted-foreground">
                    <div>Product Name</div>
                    <div>Output %</div>
                    <div></div>
                  </div>
                  {rows.map((r, i) => (
                    <div key={i} className="grid grid-cols-[1fr_140px_40px] gap-2">
                      <Input value={r.product_name} placeholder="e.g. 30/40" onChange={(e) => update(i, { product_name: e.target.value })} />
                      <Input type="number" step="0.01" value={r.output_percentage} onChange={(e) => update(i, { output_percentage: e.target.value })} />
                      <Button variant="ghost" size="icon" onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}>
                        <Trash2 size={15} className="text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => setRows((rs) => [...rs, { product_name: '', output_percentage: '' }])}
                >
                  <Plus size={15} /> Add Product
                </Button>

                <div className="mt-5 flex items-center justify-between border-t pt-4">
                  <div className={cn('text-sm font-semibold', totalOk ? 'text-success' : 'text-destructive')}>
                    Total: {Math.round((total + Number.EPSILON) * 1000) / 1000}%
                    {!totalOk && <span className="ml-2 font-normal">(must equal 100%)</span>}
                  </div>
                  <Button onClick={() => save.mutate()} disabled={!totalOk}>
                    <Save size={16} /> Save Settings
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </Page>
    </>
  )
}
