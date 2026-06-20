import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileSpreadsheet, ScrollText } from 'lucide-react'
import { api } from '@/lib/api'
import { PageHeader, Page } from '@/components/layout'
import {
  Button,
  Input,
  Select,
  SearchSelect,
  Field,
  Badge,
  Table,
  THead,
  TBody,
  TR,
  TH,
  TD,
  EmptyState
} from '@/components/ui'
import { downloadExcel } from '@/lib/utils'

export function ActivityLog(): React.JSX.Element {
  const [userId, setUserId] = React.useState<string>('')
  const [from, setFrom] = React.useState<string>('')
  const [to, setTo] = React.useState<string>('')

  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: api.users.list })
  const filter = {
    user_id: userId ? Number(userId) : undefined,
    from: from || undefined,
    to: to || undefined
  }
  const { data: rows = [] } = useQuery({
    queryKey: ['activity', filter],
    queryFn: () => api.activity.list(filter)
  })

  function exportExcel(): void {
    downloadExcel(
      'activity-log',
      'Activity Log',
      ['Time', 'User', 'Action', 'Module', 'Details', 'IP'],
      rows.map((r) => [r.ts, r.username, r.action, r.module, r.detail, r.ip])
    )
  }

  return (
    <>
      <PageHeader
        title="Activity Log"
        description="Audit trail — who did what, and when"
        actions={
          <Button variant="outline" onClick={exportExcel} disabled={!rows.length}>
            <FileSpreadsheet size={16} /> Excel
          </Button>
        }
      />
      <Page>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Field label="User" className="w-48">
            <SearchSelect
              value={userId}
              onChange={(v) => setUserId(v)}
              options={[{ value: '', label: 'All users' }, ...users.map((u) => ({ value: u.id, label: u.username }))]}
            />
          </Field>
          <Field label="From" className="w-40">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To" className="w-40">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>

        {rows.length === 0 ? (
          <EmptyState message="No activity recorded for this filter." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Time</TH>
                <TH>User</TH>
                <TH>Action</TH>
                <TH>Module</TH>
                <TH>Details</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD className="whitespace-nowrap font-mono text-xs">{r.ts}</TD>
                  <TD className="font-medium">{r.username || '—'}</TD>
                  <TD>
                    <span className="inline-flex items-center gap-1.5">
                      <ScrollText size={13} className="text-muted-foreground" />
                      {r.action}
                    </span>
                  </TD>
                  <TD>{r.module ? <Badge variant="muted">{r.module}</Badge> : '—'}</TD>
                  <TD className="max-w-[420px] truncate text-sm text-muted-foreground" title={r.detail}>
                    {r.detail || '—'}
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
