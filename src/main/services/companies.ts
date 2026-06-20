import { getDb, type Db } from '../db'
import type { Company } from '@shared/types'
import { properCase } from '@shared/types'
import { deleteSupplier } from './suppliers'
import { deleteCustomer } from './customers'
import { deleteTransporter } from './transporters'

type RoleTable = 'suppliers' | 'customers' | 'transporters'
const ROLE_DELETE: Record<RoleTable, (p: { id: number }) => Promise<{ ok: boolean; error?: string }>> = {
  suppliers: deleteSupplier,
  customers: deleteCustomer,
  transporters: deleteTransporter
}

/**
 * Sync one role for a company against a checkbox flag:
 *  flag undefined → leave as-is; true → create a linked party if none exists;
 *  false → remove the linked parties that have no transactions (in-use ones stay).
 */
async function syncRole(
  d: Db,
  companyId: number,
  table: RoleTable,
  flag: boolean | undefined,
  name: string,
  contact: string,
  address: string
): Promise<void> {
  if (flag === undefined) return
  const existing = (await d
    .prepare(`SELECT id FROM ${table} WHERE company_id = ?`)
    .all(companyId)) as { id: number }[]
  if (flag) {
    if (existing.length === 0) {
      await d
        .prepare(`INSERT INTO ${table} (name, contact, address, remarks, company_id) VALUES (?, ?, ?, '', ?)`)
        .run(name, contact, address, companyId)
    }
  } else {
    for (const e of existing) await ROLE_DELETE[table]({ id: e.id })
  }
}

/** A company can be linked from suppliers, customers and transporters (multiple roles). */
export async function listCompanies(): Promise<Company[]> {
  const d = getDb()
  const rows = (await d.prepare(`SELECT * FROM companies ORDER BY name`).all()) as Company[]
  for (const c of rows) {
    const roles: string[] = []
    const asCustomer = (await d
      .prepare(`SELECT COUNT(*) AS n FROM customers WHERE company_id = ?`)
      .get(c.id)) as { n: number }
    const asSupplier = (await d
      .prepare(`SELECT COUNT(*) AS n FROM suppliers WHERE company_id = ?`)
      .get(c.id)) as { n: number }
    const asTransporter = (await d
      .prepare(`SELECT COUNT(*) AS n FROM transporters WHERE company_id = ?`)
      .get(c.id)) as { n: number }
    if (asCustomer.n) roles.push('Customer')
    if (asSupplier.n) roles.push('Supplier')
    if (asTransporter.n) roles.push('Transporter')
    c.roles = roles
  }
  return rows
}

export async function createCompany(p: {
  name: string
  contact: string
  address: string
  remarks: string
  /** Auto-create a linked party of each type (default true for all). */
  as_supplier?: boolean
  as_customer?: boolean
  as_transporter?: boolean
}): Promise<Company> {
  const d = getDb()
  if (!p.name?.trim()) throw new Error('Company name is required.')
  const name = properCase(p.name)
  const contact = p.contact ?? ''
  const address = p.address ?? ''
  return (await d.transaction(async () => {
    const info = await d
      .prepare(`INSERT INTO companies (name, contact, address, remarks) VALUES (?, ?, ?, ?)`)
      .run(name, contact, address, p.remarks ?? '')
    const companyId = Number(info.lastInsertRowid)
    // Back-fill linked parties so the company is instantly usable in each role.
    const mk = async (table: 'suppliers' | 'customers' | 'transporters'): Promise<void> => {
      await d
        .prepare(`INSERT INTO ${table} (name, contact, address, remarks, company_id) VALUES (?, ?, ?, '', ?)`)
        .run(name, contact, address, companyId)
    }
    if (p.as_supplier !== false) await mk('suppliers')
    if (p.as_customer !== false) await mk('customers')
    if (p.as_transporter !== false) await mk('transporters')
    return (await d.prepare(`SELECT * FROM companies WHERE id = ?`).get(companyId)) as Company
  }))
}

export async function updateCompany(p: {
  id: number
  name: string
  contact: string
  address: string
  remarks: string
  as_supplier?: boolean
  as_customer?: boolean
  as_transporter?: boolean
}): Promise<Company> {
  const d = getDb()
  if (!p.name?.trim()) throw new Error('Company name is required.')
  const name = properCase(p.name)
  const contact = p.contact ?? ''
  const address = p.address ?? ''
  await d.prepare(`UPDATE companies SET name=?, contact=?, address=?, remarks=? WHERE id=?`).run(
    name,
    contact,
    address,
    p.remarks ?? '',
    p.id
  )
  // Add/remove linked parties to match the role checkboxes.
  await syncRole(d, p.id, 'suppliers', p.as_supplier, name, contact, address)
  await syncRole(d, p.id, 'customers', p.as_customer, name, contact, address)
  await syncRole(d, p.id, 'transporters', p.as_transporter, name, contact, address)
  return (await d.prepare(`SELECT * FROM companies WHERE id = ?`).get(p.id)) as Company
}

/** Deleting a company unlinks it from any parties (their records are kept). */
export async function deleteCompany(payload: { id: number }): Promise<{ ok: boolean }> {
  const d = getDb()
  await d.transaction(async () => {
    await d.prepare(`UPDATE customers SET company_id = NULL WHERE company_id = ?`).run(payload.id)
    await d.prepare(`UPDATE suppliers SET company_id = NULL WHERE company_id = ?`).run(payload.id)
    await d.prepare(`UPDATE transporters SET company_id = NULL WHERE company_id = ?`).run(payload.id)
    await d.prepare(`DELETE FROM companies WHERE id = ?`).run(payload.id)
  })
  return { ok: true }
}
