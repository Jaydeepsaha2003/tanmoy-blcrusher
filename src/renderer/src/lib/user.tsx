import * as React from 'react'
import type { User, ModuleKey } from '@shared/types'
import { canViewModule, canEditModule } from '@shared/permissions'

interface UserCtx {
  user: User | null
  setUser: (u: User | null) => void
  isAdmin: boolean
  canView: (m: ModuleKey) => boolean
  canEdit: (m: ModuleKey) => boolean
}

const Ctx = React.createContext<UserCtx | undefined>(undefined)

export function UserProvider({
  user,
  setUser,
  children
}: {
  user: User | null
  setUser: (u: User | null) => void
  children: React.ReactNode
}): React.JSX.Element {
  const value = React.useMemo<UserCtx>(
    () => ({
      user,
      setUser,
      isAdmin: user?.role === 'admin',
      canView: (m) => canViewModule(user, m),
      canEdit: (m) => canEditModule(user, m)
    }),
    [user, setUser]
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePerms(): UserCtx {
  const c = React.useContext(Ctx)
  if (!c) throw new Error('usePerms must be used within UserProvider')
  return c
}
