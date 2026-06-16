import * as React from 'react'
import { Mountain, Lock, User as UserIcon } from 'lucide-react'
import type { User } from '@shared/types'
import { api } from '@/lib/api'
import { Button, Input } from '@/components/ui'

export function Login({ onSuccess }: { onSuccess: (user: User) => void }): React.JSX.Element {
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [error, setError] = React.useState('')
  const [loading, setLoading] = React.useState(false)

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await api.auth.login(username.trim(), password)
      if (res.ok && res.user) onSuccess(res.user)
      else setError('Incorrect username or password.')
    } catch {
      setError('Unable to sign in. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-primary/10 via-background to-background p-4">
      <form onSubmit={submit} className="w-full max-w-[360px] rounded-2xl border bg-card p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Mountain size={28} />
          </div>
          <h1 className="text-lg font-bold">BL Crushing Manager</h1>
          <p className="text-sm text-muted-foreground">Stone Crusher Business Software</p>
        </div>

        <label className="mb-1.5 block text-sm font-medium text-foreground/80">Username</label>
        <div className="relative mb-3">
          <UserIcon className="absolute left-3 top-2.5 text-muted-foreground" size={16} />
          <Input
            autoFocus
            className="pl-9"
            placeholder="e.g. admin"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>

        <label className="mb-1.5 block text-sm font-medium text-foreground/80">Password</label>
        <div className="relative">
          <Lock className="absolute left-3 top-2.5 text-muted-foreground" size={16} />
          <Input
            type="password"
            className="pl-9"
            placeholder="Enter password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

        <Button type="submit" className="mt-5 w-full" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Default login is <span className="font-mono font-semibold">admin</span> /{' '}
          <span className="font-mono font-semibold">admin123</span> — change it in Settings.
        </p>
      </form>
    </div>
  )
}
