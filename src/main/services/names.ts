import { getDb } from '../db'

/**
 * Reject a duplicate name before insert/update. Compares case-insensitively (names
 * are stored upper-cased) and ignores the row being edited. Optionally scope the
 * check to a column (e.g. stock locations are unique per plant, not globally).
 */
export async function ensureUniqueName(
  table: string,
  name: string,
  opts: { id?: number; label?: string; scopeColumn?: string; scopeValue?: number | string | null } = {}
): Promise<void> {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return
  const conds = ['UPPER(name) = UPPER(?)']
  const params: unknown[] = [trimmed]
  if (opts.id) {
    conds.push('id <> ?')
    params.push(opts.id)
  }
  if (opts.scopeColumn) {
    if (opts.scopeValue == null) {
      conds.push(`${opts.scopeColumn} IS NULL`)
    } else if (typeof opts.scopeValue === 'string') {
      conds.push(`UPPER(${opts.scopeColumn}) = UPPER(?)`)
      params.push(opts.scopeValue)
    } else {
      conds.push(`${opts.scopeColumn} = ?`)
      params.push(opts.scopeValue)
    }
  }
  const row = await getDb()
    .prepare(`SELECT id FROM ${table} WHERE ${conds.join(' AND ')} LIMIT 1`)
    .get(...params)
  if (row) throw new Error(`${opts.label ?? 'A record'} named "${trimmed}" already exists.`)
}
