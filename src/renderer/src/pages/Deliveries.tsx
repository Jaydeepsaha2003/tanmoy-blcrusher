import * as React from 'react'
import { usePersistentState } from '@/lib/persistentState'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Truck, IndianRupee } from 'lucide-react'
import { api } from '@/lib/api'
import type { Dispatch, DeliveryStatus, PaymentStatus } from '@shared/types'
import { usePlant } from '@/lib/plant'
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
import { fmtQty, fmtMoney, fmtDate } from '@/lib/utils'

const payBadge: Record<PaymentStatus, 'success' | 'warning' | 'destructive'> = {
  paid: 'success',
  partial: 'warning',
  unpaid: 'destructive'
}

export function Deliveries(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { plantId } = usePlant()
  const [view, setView] = usePersistentState<'all' | 'pending' | 'rate_pending'>('view', 'all')

  const filter =
    view === 'pending'
      ? { delivery_status: 'pending', plant_id: plantId }
      : view === 'rate_pending'
        ? { delivery_status: 'delivered', rate_pending: true, plant_id: plantId }
        : { plant_id: plantId }

  const { data = [] } = useQuery({
    queryKey: ['dispatches', view, plantId],
    queryFn: () => api.dispatches.list(filter)
  })

  const [rateForm, setRateForm] = React.useState<{ id: number; rate: number; no: string } | null>(null)

  const setDelivery = useMutation({
    mutationFn: (v: { id: number; status: DeliveryStatus }) => api.dispatches.setDelivery(v.id, v.status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dispatches'] })
      toast.success('Delivery status updated.')
    }
  })

  const saveRate = useMutation({
    mutationFn: () => api.dispatches.setRate(rateForm!.id, Number(rateForm!.rate)),
    onSuccess: () => {
      // A rate sets the sale amount, so the customer ledger, dues and dashboard change.
      qc.invalidateQueries({ queryKey: ['dispatches'] })
      qc.invalidateQueries({ queryKey: ['ledger'] })
      qc.invalidateQueries({ queryKey: ['ledger-balances'] })
      qc.invalidateQueries({ queryKey: ['allDues'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      setRateForm(null)
      toast.success('Rate updated.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  return (
    <>
      <PageHeader
        title="Delivery Status Tracking"
        description="Update delivery status and add rates after delivery"
      />
      <Page>
        <div className="mb-4 flex flex-wrap gap-2">
          <Button variant={view === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setView('all')}>All</Button>
          <Button variant={view === 'pending' ? 'default' : 'outline'} size="sm" onClick={() => setView('pending')}>Pending Delivery</Button>
          <Button variant={view === 'rate_pending' ? 'default' : 'outline'} size="sm" onClick={() => setView('rate_pending')}>Delivered, Rate Pending</Button>
        </div>

        {data.length === 0 ? (
          <EmptyState message="No dispatches in this view." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Dispatch No</TH>
                <TH>Date</TH>
                <TH>Customer</TH>
                <TH>Product</TH>
                <TH className="text-right">Qty</TH>
                <TH className="text-right">Rate</TH>
                <TH>Delivery</TH>
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
                  <TD className="text-muted-foreground">{d.product_name}</TD>
                  <TD className="text-right">{fmtQty(d.quantity)} <span className="text-xs text-muted-foreground">{d.uom}</span></TD>
                  <TD className="text-right">{d.rate == null ? <Badge variant="warning">No rate</Badge> : fmtMoney(d.rate)}</TD>
                  <TD>
                    <Badge variant={d.delivery_status === 'delivered' ? 'success' : 'muted'}>{d.delivery_status}</Badge>
                  </TD>
                  <TD><Badge variant={payBadge[d.payment_status]}>{d.payment_status}</Badge></TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-2">
                      {d.delivery_status === 'pending' ? (
                        <Button variant="success" size="sm" onClick={() => setDelivery.mutate({ id: d.id, status: 'delivered' })}>
                          <Truck size={14} /> Mark Delivered
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => setDelivery.mutate({ id: d.id, status: 'pending' })}>
                          Mark Pending
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => setRateForm({ id: d.id, rate: d.rate ?? 0, no: d.dispatch_no })}>
                        <IndianRupee size={14} /> {d.rate == null ? 'Add Rate' : 'Edit Rate'}
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Page>

      {rateForm && (
        <Modal open={!!rateForm} onClose={() => setRateForm(null)} title={`Update Rate — ${rateForm.no}`}>
          <div className="space-y-4">
            <Field label="Rate per m³">
              <Input type="number" step="0.01" autoFocus value={rateForm.rate} onChange={(e) => setRateForm({ ...rateForm, rate: Number(e.target.value) })} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setRateForm(null)}>Cancel</Button>
              <Button onClick={() => saveRate.mutate()} disabled={!(Number(rateForm.rate) >= 0)}>Save</Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
