import * as React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Trash2, AlertTriangle, Receipt, Plus, X, Factory, Pencil, Scale, Building2, Image as ImageIcon } from 'lucide-react'
import { api } from '@/lib/api'
import type { Plant } from '@shared/types'
import { PageHeader, Page } from '@/components/layout'
import {
  Button,
  Input,
  Select,
  SearchSelect,
  Field,
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

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function SettingsPage(): React.JSX.Element {
  const qc = useQueryClient()
  const toast = useToast()
  const [current, setCurrent] = React.useState('')
  const [next, setNext] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [loading, setLoading] = React.useState(false)
  const [wipePassword, setWipePassword] = React.useState('')
  const [wipeConfirm, setWipeConfirm] = React.useState('')
  const [wiping, setWiping] = React.useState(false)
  const [newType, setNewType] = React.useState('')

  const { data: expenseTypes = [] } = useQuery({
    queryKey: ['expenseTypes'],
    queryFn: api.racks.expenseTypes
  })
  const { data: plants = [] } = useQuery({ queryKey: ['plants'], queryFn: api.plants.list })
  const { data: delStatus } = useQuery({ queryKey: ['deleteStatus'], queryFn: api.system.deleteStatus })
  const [plantForm, setPlantForm] = React.useState<Partial<Plant>>({ status: 'active' })

  const { data: branding } = useQuery({ queryKey: ['branding'], queryFn: api.rates.getBranding })
  const [businessName, setBusinessName] = React.useState('')
  React.useEffect(() => {
    if (branding?.business_name != null) setBusinessName(branding.business_name)
  }, [branding])
  const saveBusinessName = useMutation({
    mutationFn: (name: string) => api.rates.setBusinessName(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['branding'] })
      qc.invalidateQueries({ queryKey: ['businessName'] })
      toast.success('Business name saved — updated on the sidebar.')
    },
    onError: (e: Error) => toast.error(e.message)
  })
  const logoInputRef = React.useRef<HTMLInputElement>(null)
  const saveLogo = useMutation({
    mutationFn: (logo: string) => api.rates.setLogo(logo),
    onSuccess: (res) => {
      if (res.ok) {
        qc.invalidateQueries({ queryKey: ['branding'] })
        toast.success('Logo updated.')
      } else toast.error(res.error || 'Could not save logo.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  // Downscale the chosen image to a small square data URL so it stays light.
  async function onLogoFile(file: File): Promise<void> {
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file.')
      return
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => reject(new Error('Could not read the file.'))
      r.readAsDataURL(file)
    })
    const img = new window.Image()
    img.onload = () => {
      const max = 256
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        saveLogo.mutate(dataUrl)
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      saveLogo.mutate(canvas.toDataURL('image/png'))
    }
    img.onerror = () => toast.error('That image could not be loaded.')
    img.src = dataUrl
  }

  const { data: workdays } = useQuery({ queryKey: ['workdays'], queryFn: api.system.getWorkdays })
  const offDays = new Set(workdays?.weekly_offs ?? [0])
  const saveWorkdays = useMutation({
    mutationFn: (arr: number[]) => api.system.setWorkdays(arr),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workdays'] })
      toast.success('Working days updated.')
    },
    onError: (e: Error) => toast.error(e.message)
  })
  function toggleOff(i: number): void {
    const next = new Set(offDays)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    saveWorkdays.mutate([...next])
  }

  const savePlant = useMutation({
    mutationFn: (p: Partial<Plant>) => (p.id ? api.plants.update(p) : api.plants.create(p)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plants'] })
      setPlantForm({ status: 'active' })
      toast.success('Plant saved.')
    },
    onError: (e: Error) => toast.error(e.message)
  })

  async function removePlant(p: Plant): Promise<void> {
    const ok = await confirmDialog({ title: 'Delete plant', message: `Delete "${p.name}"?` })
    if (!ok) return
    const res = await api.plants.delete(p.id)
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ['plants'] })
      toast.success('Plant deleted.')
    } else toast.error(res.error || 'Could not delete plant.')
  }

  async function addType(): Promise<void> {
    const res = await api.racks.createExpenseType(newType)
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ['expenseTypes'] })
      setNewType('')
      toast.success('Expense type added.')
    } else toast.error(res.error || 'Could not add expense type.')
  }

  async function removeType(name: string): Promise<void> {
    const ok = await confirmDialog({
      title: 'Delete expense type',
      message: `Remove "${name}" from the list? Existing rack expenses already using it are not affected.`
    })
    if (!ok) return
    await api.racks.deleteExpenseType(name)
    qc.invalidateQueries({ queryKey: ['expenseTypes'] })
    toast.success('Expense type removed.')
  }

  async function requestDelete(): Promise<void> {
    const ok = await confirmDialog({
      title: 'Schedule data deletion?',
      message:
        'This schedules permanent deletion of ALL records, to run 3 days from now. You can cancel any time before then from this screen. Continue?',
      confirmText: 'Yes, schedule deletion'
    })
    if (!ok) return
    setWiping(true)
    try {
      const res = await api.system.requestDelete(wipePassword)
      if (res.ok) {
        setWipePassword('')
        setWipeConfirm('')
        qc.invalidateQueries({ queryKey: ['deleteStatus'] })
        toast.success('Data deletion scheduled — runs in 3 days. You can cancel it here.')
      } else toast.error(res.error || 'Could not schedule deletion.')
    } finally {
      setWiping(false)
    }
  }

  async function cancelDelete(): Promise<void> {
    await api.system.cancelDelete()
    qc.invalidateQueries({ queryKey: ['deleteStatus'] })
    toast.success('Scheduled deletion cancelled — your data is safe.')
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (next !== confirm) {
      toast.error('New passwords do not match.')
      return
    }
    setLoading(true)
    try {
      const res = await api.auth.changePassword(current, next)
      if (res.ok) {
        toast.success('Password changed successfully.')
        setCurrent('')
        setNext('')
        setConfirm('')
      } else toast.error(res.error || 'Could not change password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <PageHeader title="Settings" description="Application settings, master lists and security" />
      <Page>
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Change password */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound size={18} /> Change Admin Password
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="space-y-4">
                <Field label="Current Password">
                  <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} />
                </Field>
                <Field label="New Password" hint="At least 4 characters">
                  <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} />
                </Field>
                <Field label="Confirm New Password">
                  <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                </Field>
                <Button type="submit" disabled={loading || !current || !next}>
                  {loading ? 'Saving…' : 'Update Password'}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Expense types */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Receipt size={18} /> Expense Types
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                These appear as suggestions when you add an expense to a rack. New types are also
                saved automatically the first time you type them on a rack.
              </p>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Field label="New Expense Type">
                    <Input
                      value={newType}
                      onChange={(e) => setNewType(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newType.trim()) addType()
                      }}
                      placeholder="e.g. Railway Freight, Loading Labour"
                    />
                  </Field>
                </div>
                <Button onClick={addType} disabled={!newType.trim()}>
                  <Plus size={16} /> Add
                </Button>
              </div>

              {expenseTypes.length === 0 ? (
                <EmptyState message="No expense types yet." />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {expenseTypes.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1.5 rounded-full border bg-secondary px-3 py-1 text-sm text-secondary-foreground"
                    >
                      {t}
                      <button
                        onClick={() => removeType(t)}
                        className="text-muted-foreground transition-colors hover:text-destructive"
                        title="Remove"
                      >
                        <X size={14} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          {/* Working days (payroll) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Receipt size={18} /> Payroll — Working Days
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Tick the <b>weekly off</b> days. The remaining days are counted as working days when
                calculating monthly salaries in Payroll.
              </p>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((w, i) => {
                  const off = offDays.has(i)
                  return (
                    <button
                      key={w}
                      onClick={() => toggleOff(i)}
                      className={
                        'rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ' +
                        (off
                          ? 'border-destructive/40 bg-destructive/10 text-destructive'
                          : 'border-input bg-card hover:bg-accent')
                      }
                    >
                      {w}
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Off days: <b>{[...offDays].sort().map((i) => WEEKDAYS[i]).join(', ') || 'None'}</b>
              </p>
            </CardContent>
          </Card>
          {/* Branding — name + logo (sidebar and shared rate pages) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 size={18} /> Branding
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Your business name shows at the top of the sidebar and on the public rate pages you share. The logo shows in the sidebar.
              </p>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Field label="Business name">
                    <Input
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      placeholder="e.g. BL Crushing"
                    />
                  </Field>
                </div>
                <Button onClick={() => saveBusinessName.mutate(businessName)} disabled={!businessName.trim()}>
                  Save
                </Button>
              </div>
              <Field label="Logo" hint="Square images look best — it's resized automatically.">
                <div className="flex items-center gap-3">
                  {branding?.logo ? (
                    <img src={branding.logo} alt="Current logo" className="h-12 w-12 rounded-xl object-cover ring-1 ring-black/5" />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-dashed text-muted-foreground">
                      <ImageIcon size={18} />
                    </div>
                  )}
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) onLogoFile(f)
                      e.target.value = ''
                    }}
                  />
                  <Button variant="outline" onClick={() => logoInputRef.current?.click()} disabled={saveLogo.isPending}>
                    {branding?.logo ? 'Change Logo' : 'Upload Logo'}
                  </Button>
                  {branding?.logo && (
                    <Button variant="ghost" onClick={() => saveLogo.mutate('')} disabled={saveLogo.isPending}>
                      Remove
                    </Button>
                  )}
                </div>
              </Field>
            </CardContent>
          </Card>
        </div>

        {/* Plants */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Factory size={18} /> Plants
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Add or edit your crushing plants. Switch the active plant any time from the selector at
              the top-right of every screen. The <b>density</b> and <b>CFT</b> factors below convert
              TON and CFT to/from m³ for that plant's purchases and sales.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Field label="Plant Name">
                <Input value={plantForm.name || ''} onChange={(e) => setPlantForm({ ...plantForm, name: e.target.value })} />
              </Field>
              <Field label="Code">
                <Input value={plantForm.code || ''} onChange={(e) => setPlantForm({ ...plantForm, code: e.target.value })} placeholder="e.g. P1" />
              </Field>
              <Field label="Location">
                <Input value={plantForm.location || ''} onChange={(e) => setPlantForm({ ...plantForm, location: e.target.value })} />
              </Field>
              <Field label="Density (TON/m³)" hint="Default 1.6">
                <Input
                  type="number"
                  step="0.001"
                  value={plantForm.ton_per_cm ?? ''}
                  placeholder="1.6"
                  onChange={(e) =>
                    setPlantForm({ ...plantForm, ton_per_cm: e.target.value === '' ? undefined : Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="CFT per m³" hint="Default 35.31">
                <Input
                  type="number"
                  step="0.01"
                  value={plantForm.cft_per_cm ?? ''}
                  placeholder="35.31"
                  onChange={(e) =>
                    setPlantForm({ ...plantForm, cft_per_cm: e.target.value === '' ? undefined : Number(e.target.value) })
                  }
                />
              </Field>
              <Field label="Status">
                <SearchSelect value={plantForm.status || 'active'} onChange={(v) => setPlantForm({ ...plantForm, status: v as Plant['status'] })} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
              </Field>
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={() => savePlant.mutate(plantForm)} disabled={!plantForm.name?.trim() || !plantForm.code?.trim()}>
                {plantForm.id ? 'Update Plant' : <><Plus size={16} /> Add Plant</>}
              </Button>
              {plantForm.id && (
                <Button variant="ghost" onClick={() => setPlantForm({ status: 'active' })}>Cancel</Button>
              )}
            </div>

            {plants.length === 0 ? (
              <EmptyState message="No plants yet. Add your first plant above." />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Name</TH>
                    <TH>Code</TH>
                    <TH>Location</TH>
                    <TH className="flex items-center gap-1"><Scale size={13} /> TON·CFT / m³</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {plants.map((p) => (
                    <TR key={p.id}>
                      <TD className="font-medium">{p.name}</TD>
                      <TD className="font-mono text-xs">{p.code}</TD>
                      <TD className="text-muted-foreground">{p.location || '-'}</TD>
                      <TD className="font-mono text-xs text-muted-foreground">
                        {(p.ton_per_cm ?? 1.6)} · {(p.cft_per_cm ?? 35.31)}
                      </TD>
                      <TD className="capitalize text-muted-foreground">{p.status}</TD>
                      <TD className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => setPlantForm(p)}>
                          <Pencil size={15} />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => removePlant(p)}>
                          <Trash2 size={15} className="text-destructive" />
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Danger zone */}
        <Card className="mt-6 max-w-2xl border-destructive/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <Trash2 size={18} /> Danger Zone — Delete All Data
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {delStatus?.scheduled_at ? (
              <>
                <div className="flex items-start gap-2.5 rounded-lg bg-destructive/10 px-3.5 py-3 text-xs leading-relaxed text-destructive">
                  <AlertTriangle size={26} className="shrink-0" />
                  <span>
                    Data deletion is <b>scheduled for {new Date(delStatus.scheduled_at).toLocaleString()}</b>
                    {delStatus.requested_by ? ` (requested by ${delStatus.requested_by})` : ''}. All records
                    will be permanently deleted then. Cancel below to keep your data.
                  </span>
                </div>
                <Button variant="outline" onClick={cancelDelete}>
                  Cancel scheduled deletion
                </Button>
              </>
            ) : (
              <>
                <div className="flex items-start gap-2.5 rounded-lg bg-destructive/10 px-3.5 py-3 text-xs leading-relaxed text-destructive">
                  <AlertTriangle size={26} className="shrink-0" />
                  <span>
                    Permanently deletes <b>every record</b> — masters, purchases, productions, racks, sales,
                    ledgers, payments and stock history. To prevent accidents, deletion runs{' '}
                    <b>3 days</b> after you request it, and can be cancelled any time in between. Users &amp;
                    settings are kept; document numbering restarts.
                  </span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Your Password">
                    <Input
                      type="password"
                      value={wipePassword}
                      onChange={(e) => setWipePassword(e.target.value)}
                    />
                  </Field>
                  <Field label={'Type "DELETE" to confirm'}>
                    <Input
                      value={wipeConfirm}
                      onChange={(e) => setWipeConfirm(e.target.value)}
                      placeholder="DELETE"
                    />
                  </Field>
                </div>
                <Button
                  variant="destructive"
                  onClick={requestDelete}
                  disabled={wiping || !wipePassword || wipeConfirm !== 'DELETE'}
                >
                  <Trash2 size={16} /> {wiping ? 'Scheduling…' : 'Request deletion (in 3 days)'}
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <p className="mt-6 text-xs text-muted-foreground">
          {businessName || 'BL Crushing'} — Stone Crusher. All data is stored locally on this computer. Keep
          regular backups of your data file.
        </p>
      </Page>
    </>
  )
}
