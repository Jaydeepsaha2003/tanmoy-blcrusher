import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, ShieldCheck, UserCog } from 'lucide-react'
import { api } from '@/lib/api'
import type { User, Role, ModuleKey } from '@shared/types'
import { STAFF_MODULES, ROLE_PRESETS } from '@shared/permissions'
import { PageHeader, Page } from '@/components/layout'
import { usePerms } from '@/lib/user'
import {
  Button,
  Input,
  Select,
  SearchSelect,
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

type ModState = 'none' | 'view' | 'edit'

interface Form {
  id?: number
  username: string
  name: string
  password: string
  role: Role
  modules: ModuleKey[]
  edit_modules: ModuleKey[]
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
    setForm({ username: '', name: '', password: '', role: 'staff', modules: [], edit_modules: [] })
  }
  function openEdit(u: User): void {
    setForm({
      id: u.id,
      username: u.username,
      name: u.name,
      password: '',
      role: u.role,
      modules: u.modules,
      edit_modules: u.edit_modules
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

  function modState(m: ModuleKey): ModState {
    if (!form) return 'none'
    if (form.edit_modules.includes(m)) return 'edit'
    if (form.modules.includes(m)) return 'view'
    return 'none'
  }
  function setModState(m: ModuleKey, state: ModState): void {
    if (!form) return
    const modules = form.modules.filter((x) => x !== m)
    const edit_modules = form.edit_modules.filter((x) => x !== m)
    if (state === 'view') modules.push(m)
    if (state === 'edit') {
      modules.push(m)
      edit_modules.push(m)
    }
    setForm({ ...form, modules, edit_modules })
  }

  function applyPreset(key: string): void {
    if (!form) return
    const preset = ROLE_PRESETS[key]
    if (!preset) return
    setForm({ ...form, role: 'staff', modules: [...preset.modules], edit_modules: [...preset.edit_modules] })
  }

  const canSave = form && form.username.trim().length >= 3 && (form.id || form.password.length >= 4)

  return (
    <>
      <PageHeader
        title="Users"
        description="Create staff logins and control what each person can access — per module"
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
                      <Badge variant="default">
                        <ShieldCheck size={12} className="mr-1 inline" />
                        Admin
                      </Badge>
                    ) : (
                      <Badge variant="muted">Staff</Badge>
                    )}
                  </TD>
                  <TD className="text-sm text-muted-foreground">
                    {u.role === 'admin'
                      ? 'Everything'
                      : `${u.modules.length} module${u.modules.length === 1 ? '' : 's'} · ${u.edit_modules.length} editable`}
                  </TD>
                  <TD>
                    {u.active ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="destructive">Disabled</Badge>
                    )}
                  </TD>
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
                <SearchSelect value={form.role} onChange={(v) => setForm({ ...form, role: v as Role })} options={[{ value: 'staff', label: 'Staff (scoped access)' }, { value: 'admin', label: 'Admin (full access)' }]} />
              </Field>
            </div>

            {form.role === 'staff' && (
              <>
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
                    Access per module — choose for each what this user can do
                  </div>
                  <div className="grid grid-cols-1 gap-2 rounded-lg border p-3 sm:grid-cols-2">
                    {STAFF_MODULES.map((m) => (
                      <div key={m.key} className="flex items-center justify-between gap-2">
                        <span className="text-sm">{m.label}</span>
                        <SearchSelect
                          className="w-28 shrink-0"
                          value={modState(m.key)}
                          onChange={(v) => setModState(m.key, v as ModState)}
                          options={[{ value: 'none', label: 'No access' }, { value: 'view', label: 'View' }, { value: 'edit', label: 'Edit' }]}
                        />
                      </div>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    View = read only · Edit = create/update/delete. Settings and Users &amp; Activity Log
                    are reserved for admins.
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
