import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PackageCheck, Undo2 } from 'lucide-react'
import { api } from '@/lib/api'
import type { Dispatch, PaymentStatus } from '@shared/types'
import { usePlant } from '@/lib/plant'
import { PageHeader, Page } from '@/components/layout'
import { Button, Badge, Table, THead, TBody, TR, TH, TD, EmptyState } from '@/components/ui'
import { useToast } from '@/components/toast'
import { fmtQty, fmtDate } from '@/lib/utils'

const payBadge: Record<PaymentStatus, 'success' | 'warning' | 'destructive'> = {
  paid: 'success',
  partial: 'warning',
  unpaid: 'destructive'
}

export function DispatchQueue(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { plantId } = usePlant()
  const [view, setView] = React.useState<'pending' | 'dispatched' | 'all'>('pending')

  const filter =
    view === 'all'
      ? { plant_id: plantId }
      : { dispatch_status: view, plant_id: plantId }

  const { data = [] } = useQuery({
    queryKey: ['dispatches', 'dispatch', view, plantId],
    queryFn: () => api.dispatches.list(filter)
  })

  const setDispatch = useMutation({
    mutationFn: (v: { id: number; status: 'pending' | 'dispatched' }) => api.dispatches.setDispatch(v.id, v.status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dispatches'] })
      toast.success('Dispatch status updated.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  return (
    <>
      <PageHeader
        title="Dispatch"
        description="Every direct sale lands here — mark each one Dispatched once it leaves"
      />
      <Page>
        <div className="mb-4 flex flex-wrap gap-2">
          <Button variant={view === 'pending' ? 'default' : 'outline'} size="sm" onClick={() => setView('pending')}>To Dispatch</Button>
          <Button variant={view === 'dispatched' ? 'default' : 'outline'} size="sm" onClick={() => setView('dispatched')}>Dispatched</Button>
          <Button variant={view === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setView('all')}>All</Button>
        </div>

        {data.length === 0 ? (
          <EmptyState message="No sales in this view." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Sale No</TH>
                <TH>Date</TH>
                <TH>Customer</TH>
                <TH>Plant / Product</TH>
                <TH className="text-right">Qty</TH>
                <TH>Dispatch</TH>
                <TH>Payment</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {data.map((d: Dispatch) => (
                <TR key={d.id}>
                  <TD className="font-mono text-xs">{d.dispatch_no}</TD>
                  <TD>{fmtDate(d.date)}</TD>
                  <TD className="font-medium">{d.customer_name}</TD>
                  <TD className="text-muted-foreground">{d.plant_name} / {d.product_name}</TD>
                  <TD className="text-right">{fmtQty(d.quantity)} <span className="text-xs text-muted-foreground">{d.uom}</span></TD>
                  <TD>
                    <Badge variant={d.dispatch_status === 'dispatched' ? 'success' : 'warning'}>
                      {d.dispatch_status === 'dispatched' ? 'Dispatched' : 'To Dispatch'}
                    </Badge>
                  </TD>
                  <TD><Badge variant={payBadge[d.payment_status]}>{d.payment_status}</Badge></TD>
                  <TD className="text-right">
                    {d.dispatch_status === 'dispatched' ? (
                      <Button variant="outline" size="sm" onClick={() => setDispatch.mutate({ id: d.id, status: 'pending' })}>
                        <Undo2 size={14} /> Mark To Dispatch
                      </Button>
                    ) : (
                      <Button variant="success" size="sm" onClick={() => setDispatch.mutate({ id: d.id, status: 'dispatched' })}>
                        <PackageCheck size={14} /> Mark Dispatched
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Page>
    </>
  )
}
