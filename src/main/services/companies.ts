import { getDb } from '../db'
import type { Company } from '@shared/types'
import { properCase } from '@shared/types'

/** A company can be linked from suppliers, customers and transporters (multiple roles). */
export function listCompanies(): Company[] {
  const d = getDb()
  const rows = d.prepare(`SELECT * FROM companies ORDER BY name`).all() as Company[]
  for (const c of rows) {
    const roles: string[] = []
    const asCustomer = d
      .prepare(`SELECT COUNT(*) AS n FROM customers WHERE company_id = ?`)
      .get(c.id) as { n: number }
    const asSupplier = d
      .prepare(`SELECT COUNT(*) AS n FROM suppliers WHERE company_id = ?`)
      .get(c.id) as { n: number }
    const asTransporter = d
      .prepare(`SELECT COUNT(*) AS n FROM transporters WHERE company_id = ?`)
      .get(c.id) as { n: number }
    if (asCustomer.n) roles.push('Customer')
    if (asSupplier.n) roles.push('Supplier')
    if (asTransporter.n) roles.push('Transporter')
    c.roles = roles
  }
  return rows
}

export function createCompany(p: {
  name: string
  contact: string
  address: string
  remarks: string
}): Company {
  const d = getDb()
  if (!p.name?.trim()) throw new Error('Company name is required.')
  const info = d
    .prepare(`INSERT INTO companies (name, contact, address, remarks) VALUES (?, ?, ?, ?)`)
    .run(properCase(p.name), p.contact ?? '', p.address ?? '', p.remarks ?? '')
  return d.prepare(`SELECT * FROM companies WHERE id = ?`).get(info.lastInsertRowid) as Company
}

export function updateCompany(p: {
  id: number
  name: string
  contact: string
  address: string
  remarks: string
}): Company {
  const d = getDb()
  if (!p.name?.trim()) throw new Error('Company name is required.')
  d.prepare(`UPDATE companies SET name=?, contact=?, address=?, remarks=? WHERE id=?`).run(
    properCase(p.name),
    p.contact ?? '',
    p.address ?? '',
    p.remarks ?? '',
    p.id
  )
  return d.prepare(`SELECT * FROM companies WHERE id = ?`).get(p.id) as Company
}

/** Deleting a company unlinks it from any parties (their records are kept). */
export function deleteCompany(payload: { id: number }): { ok: boolean } {
  const d = getDb()
  const tx = d.transaction(() => {
    d.prepare(`UPDATE customers SET company_id = NULL WHERE company_id = ?`).run(payload.id)
    d.prepare(`UPDATE suppliers SET company_id = NULL WHERE company_id = ?`).run(payload.id)
    d.prepare(`UPDATE transporters SET company_id = NULL WHERE company_id = ?`).run(payload.id)
    d.prepare(`DELETE FROM companies WHERE id = ?`).run(payload.id)
  })
  tx()
  return { ok: true }
}
