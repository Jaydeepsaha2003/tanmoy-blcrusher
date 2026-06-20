import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BellRing, Gauge } from 'lucide-react'
import { api } from '@/lib/api'
import { PageHeader, Page } from '@/components/layout'
import { Button, Input, Badge, Table, THead, TBody, TR, TH, TD, EmptyState } from '@/components/ui'
import { useToast } from '@/components/toast'
import { fmtDate } from '@/lib/utils'

const docLabel: Record<string, string> = {
  insurance: 'Insurance',
  permit: 'Permit',
  fitness: 'Fitness',
  puc: 'PUC / Pollution',
  rc: 'Registration (RC)',
  tax: 'Road Tax',
  other: 'Other'
}

export function Reminders(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const nav = useNavigate()
  const { data: settings } = useQuery({ queryKey: ['reminderSettings'], queryFn: api.machinery.reminderSettings })
  const { data: rows = [] } = useQuery({ queryKey: ['reminders'], queryFn: () => api.machinery.reminders() })
  const [days, setDays] = React.useState('')
  React.useEffect(() => {
    if (settings?.days != null) setDays(String(settings.days))
  }, [settings])

  const saveDays = useMutation({
    mutationFn: (n: number) => api.machinery.setReminderDays(n),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminderSettings'] })
      qc.invalidateQueries({ queryKey: ['reminders'] })
      toast.success('Reminder window updated.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  const expired = rows.filter((r) => r.reminder_status === 'expired')
  const due = rows.filter((r) => r.reminder_status === 'due')

  return (
    <>
      <PageHeader
        title="Reminders"
        description="Machine documents that have expired or are expiring soon — insurance, permit, fitness, PUC and more"
      />
      <Page>
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm">
          <BellRing size={16} className="text-primary" />
          <span>Remind me</span>
          <Input type="number" className="w-20" value={days} onChange={(e) => setDays(e.target.value)} />
          <span>days before a document expires.</span>
          <Button size="sm" onClick={() => saveDays.mutate(Math.max(1, Number(days) || 30))} disabled={!days}>Save</Button>
          <span className="ml-auto text-muted-foreground">
            {expired.length} expired · {due.length} due soon
          </span>
        </div>

        {rows.length === 0 ? (
          <EmptyState message="Nothing expiring. All machine documents are valid." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Machine</TH>
                <TH>Document</TH>
                <TH>Number</TH>
                <TH>Expiry</TH>
                <TH>Status</TH>
                <TH className="text-right"></TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id} className={r.reminder_status === 'expired' ? 'bg-destructive/5' : ''}>
                  <TD className="font-medium">{r.asset_name}</TD>
                  <TD>{docLabel[r.doc_type] ?? r.doc_type}</TD>
                  <TD className="font-mono text-xs">{r.number || '-'}</TD>
                  <TD className="text-muted-foreground">{r.expiry_date ? fmtDate(r.expiry_date) : '-'}</TD>
                  <TD>
                    {r.reminder_status === 'expired' ? (
                      <Badge variant="destructive">
                        Expired{r.days_left != null ? ` ${Math.abs(r.days_left)}d ago` : ''}
                      </Badge>
                    ) : (
                      <Badge variant="warning">{r.days_left}d left</Badge>
                    )}
                  </TD>
                  <TD className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => nav(`/machinery/${r.asset_id}`)}>
                      <Gauge size={14} /> Open
                    </Button>
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
