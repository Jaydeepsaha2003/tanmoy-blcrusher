import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, ShieldCheck, UserCog } from 'lucide-react'
import { api } from '@/lib/api'
import type { User, Role, AccessLevel, ModuleKey } from '@shared/types'
import { STAFF_MODULES, ROLE_PRESETS } from '@shared/permissions'
import { PageHeader, Page } from '@/components/layout'
import { usePerms } from '@/lib/user'
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
import { confirmDialog } from '@/components/confirm'

interface Form {
  id?: number
  username: string
  name: string
  password: string
  role: Role
  access_level: AccessLevel
  modules: ModuleKey[]
}

export function UsersPage(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const { user: me } = usePerms()
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: api.users.list })
  const [form, setForm] = React.useState<Form | null>(null)

  const save = useMutation({
    mutationFn: (f: Form) => (f.id ? api.users.update(f) : api.users.create(f)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setForm(null)
      toast.success('User saved.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  function openNew(): void {
    setForm({ username: '', name: '', password: '', role: 'staff', access_level: 'edit', modules: [] })
  }
  function openEdit(u: User): void {
    setForm({
      id: u.id,
      username: u.username,
      name: u.name,
      password: '',
      role: u.role,
      access_level: u.access_level,
      modules: u.modules
    })
  }
  async function remove(u: User): Promise<void> {
    const ok = await confirmDialog({ title: 'Delete user', message: `Delete user "${u.username}"?` })
    if (!ok) return
    const res = await api.users.delete(u.id)
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ['users'] })
      toast.success('User deleted.')
    } else toast.error(res.error || 'Could not delete.')
  }

  function toggleModule(m: ModuleKey): void {
    if (!form) return
    setForm({
      ...form,
      modules: form.modules.includes(m) ? form.modules.filter((x) => x !== m) : [...form.modules, m]
    })
  }

  function applyPreset(key: string): void {
    if (!form) return
    const preset = ROLE_PRESETS[key]
    if (!preset) return
    setForm({ ...form, role: 'staff', access_level: preset.access_level, modules: [...preset.modules] })
  }

  const canSave = form && form.username.trim().length >= 3 && (form.id || form.password.length >= 4)

  return (
    <>
      <PageHeader
        title="Users"
        description="Create staff logins and control what each person can access"
        actions={
          <Button onClick={openNew}>
            <Plus size={16} /> New User
          </Button>
        }
      />
      <Page>
        {users.length === 0 ? (
          <EmptyState message="No users yet." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Username</TH>
                <TH>Name</TH>
                <TH>Role</TH>
                <TH>Access</TH>
                <TH>Status</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {users.map((u) => (
                <TR key={u.id}>
                  <TD className="font-mono text-xs font-medium">{u.username}</TD>
                  <TD className="font-medium">{u.name}</TD>
                  <TD>
                    {u.role === 'admin' ? (
                      <Badge variant="default"><ShieldCheck size={12} className="mr-1 inline" />Admin</Badge>
                    ) : (
                      <Badge variant="muted">Staff</Badge>
                    )}
                  </TD>
                  <TD className="text-sm text-muted-foreground">
                    {u.role === 'admin'
                      ? 'Everything'
                      : `${u.access_level === 'edit' ? 'Edit' : 'View'} · ${u.modules.length} module${u.modules.length === 1 ? '' : 's'}`}
                  </TD>
                  <TD>{u.active ? <Badge variant="success">Active</Badge> : <Badge variant="destructive">Disabled</Badge>}</TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-1.5">
                      <Button variant="ghost" size="icon" title="Edit" onClick={() => openEdit(u)}>
                        <Pencil size={15} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={me?.id === u.id ? 'You cannot delete yourself' : 'Delete'}
                        disabled={me?.id === u.id}
                        onClick={() => remove(u)}
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Page>

      {form && (
        <Modal open onClose={() => setForm(null)} title={form.id ? 'Edit User' : 'New User'}>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Username" hint="letters, numbers, . _ -">
                <Input
                  value={form.username}
                  disabled={!!form.id}
                  placeholder="e.g. ramesh"
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                />
              </Field>
              <Field label="Full name">
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label={form.id ? 'New password (blank = keep)' : 'Password'}>
                <Input
                  type="password"
                  value={form.password}
                  placeholder={form.id ? '••••••' : 'min 4 characters'}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </Field>
              <Field label="Role">
                <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                  <option value="staff">Staff (scoped access)</option>
                  <option value="admin">Admin (full access)</option>
                </Select>
              </Field>
            </div>

            {form.role === 'staff' && (
              <>
                <Field label="Access level">
                  <Select
                    value={form.access_level}
                    onChange={(e) => setForm({ ...form, access_level: e.target.value as AccessLevel })}
                  >
                    <option value="view">View only (read)</option>
                    <option value="edit">Edit (create / update / delete)</option>
                  </Select>
                </Field>

                <div>
                  <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-foreground/80">
                    <UserCog size={15} /> Quick presets
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(ROLE_PRESETS).map(([key, p]) => (
                      <Button key={key} type="button" size="sm" variant="outline" onClick={() => applyPreset(key)}>
                        {p.label.split(' (')[0]}
                      </Button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 text-sm font-medium text-foreground/80">
                    Modules this user can access
                  </div>
                  <div className="grid grid-cols-1 gap-1.5 rounded-lg border p-3 sm:grid-cols-2">
                    {STAFF_MODULES.map((m) => (
                      <label key={m.key} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-input"
                          checked={form.modules.includes(m.key)}
                          onChange={() => toggleModule(m.key)}
                        />
                        {m.label}
                      </label>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Admin-only areas (Settings, Users &amp; Activity Log) are reserved for admins.
                  </p>
                </div>
              </>
            )}

            {form.role === 'admin' && (
              <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                Admins have full access to every module, including Settings and user management.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setForm(null)}>
                Cancel
              </Button>
              <Button onClick={() => save.mutate(form)} disabled={!canSave || save.isPending}>
                {form.id ? 'Save Changes' : 'Create User'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
