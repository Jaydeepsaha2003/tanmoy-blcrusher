import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, Wallet } from 'lucide-react'
import { api } from '@/lib/api'
import { PageHeader, Page } from '@/components/layout'
import { Button, Input, Select, SearchSelect, Card, CardContent, Table, THead, TBody, TR, TH, TD, EmptyState } from '@/components/ui'
import { useToast } from '@/components/toast'
import { usePlant } from '@/lib/plant'
import { fmtMoney, cn } from '@/lib/utils'

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function monthRange(d: Date): { from: string; to: string } {
  return {
    from: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`,
    to: ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0))
  }
}
function fyRange(d: Date): { from: string; to: string } {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1
  return { from: `${y}-04-01`, to: `${y + 1}-03-31` }
}

export function Budget(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { plantId } = usePlant()
  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })

  const [plant, setPlant] = React.useState<number | undefined>(plantId)
  React.useEffect(() => {
    if (plantId) setPlant(plantId)
  }, [plantId])
  React.useEffect(() => {
    if (!plant && plants.length) setPlant(plants[0].id)
  }, [plants, plant])

  const [range, setRange] = React.useState(() => monthRange(new Date()))

  const { data: report } = useQuery({
    queryKey: ['budget', plant, range.from, range.to],
    queryFn: () => api.budget.get(plant!, range.from, range.to),
    enabled: !!plant && !!range.from && !!range.to
  })

  // Editable budget amounts keyed by head, seeded from the report.
  const [edits, setEdits] = React.useState<Record<string, string>>({})
  React.useEffect(() => {
    if (report) {
      const m: Record<string, string> = {}
      for (const it of report.items) m[it.head] = it.budget ? String(it.budget) : ''
      setEdits(m)
    }
  }, [report])

  const save = useMutation({
    mutationFn: () =>
      api.budget.save(
        plant!,
        range.from,
        range.to,
        (report?.items ?? []).map((it) => ({ head: it.head, amount: Number(edits[it.head]) || 0 }))
      ),
    onSuccess: (res) => {
      if (res.ok) {
        qc.invalidateQueries({ queryKey: ['budget'] })
        toast.success('Budget saved.')
      } else toast.error(res.error || 'Could not save budget.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const totalBudget = (report?.items ?? []).reduce((s, it) => s + (Number(edits[it.head]) || 0), 0)
  const totalActual = report?.total_actual ?? 0

  return (
    <>
      <PageHeader title="Plant Budget" description="Plan spend per head and track it against actual, for any period" />
      <Page>
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <SearchSelect
            className="w-full sm:w-52"
            value={plant ?? ''}
            disabled={!!plantId}
            onChange={(v) => setPlant(Number(v))}
            options={plants.map((p) => ({ value: p.id, label: p.name }))}
          />
          <Button variant="outline" size="sm" onClick={() => setRange(monthRange(new Date()))}>This Month</Button>
          <Button variant="outline" size="sm" onClick={() => setRange(fyRange(new Date()))}>This FY</Button>
          <div className="flex items-center gap-1">
            <Input type="date" className="w-36" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
            <span className="text-muted-foreground">to</span>
            <Input type="date" className="w-36" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </div>
        </div>

        {plants.length === 0 ? (
          <EmptyState message="Create a plant first." />
        ) : (
          <Card>
            <CardContent className="pt-5">
              <Table>
                <THead>
                  <TR>
                    <TH className="flex items-center gap-2"><Wallet size={14} /> Head</TH>
                    <TH className="text-right">Budget</TH>
                    <TH className="text-right">Actual</TH>
                    <TH className="text-right">Variance</TH>
                    <TH className="text-right">Used %</TH>
                  </TR>
                </THead>
                <TBody>
                  {(report?.items ?? []).map((it) => {
                    const budget = Number(edits[it.head]) || 0
                    const variance = Math.round((budget - it.actual + Number.EPSILON) * 100) / 100
                    const usedPct = budget > 0 ? Math.round((it.actual / budget) * 100) : null
                    return (
                      <TR key={it.head}>
                        <TD className="font-medium">{it.label}</TD>
                        <TD className="text-right">
                          <Input
                            type="number"
                            step="0.01"
                            className="ml-auto h-8 w-32 text-right"
                            value={edits[it.head] ?? ''}
                            placeholder="0"
                            onChange={(e) => setEdits({ ...edits, [it.head]: e.target.value })}
                          />
                        </TD>
                        <TD className="tnum text-right">{fmtMoney(it.actual)}</TD>
                        <TD className={cn('tnum text-right font-semibold', variance < 0 ? 'text-destructive' : 'text-success')}>
                          {fmtMoney(Math.abs(variance))} {variance < 0 ? 'over' : 'left'}
                        </TD>
                        <TD className="tnum text-right text-muted-foreground">
                          {usedPct == null ? '-' : `${usedPct}%`}
                        </TD>
                      </TR>
                    )
                  })}
                  <TR className="border-t-2 bg-muted/40 font-bold">
                    <TD>Total</TD>
                    <TD className="tnum text-right">{fmtMoney(totalBudget)}</TD>
                    <TD className="tnum text-right">{fmtMoney(totalActual)}</TD>
                    <TD className={cn('tnum text-right', totalBudget - totalActual < 0 ? 'text-destructive' : 'text-success')}>
                      {fmtMoney(Math.abs(totalBudget - totalActual))} {totalBudget - totalActual < 0 ? 'over' : 'left'}
                    </TD>
                    <TD className="tnum text-right">{totalBudget > 0 ? `${Math.round((totalActual / totalBudget) * 100)}%` : '-'}</TD>
                  </TR>
                </TBody>
              </Table>
              <div className="mt-4 flex justify-end">
                <Button onClick={() => save.mutate()} disabled={!plant}>
                  <Save size={16} /> Save Budget
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </Page>
    </>
  )
}
