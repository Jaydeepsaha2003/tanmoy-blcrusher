import { SCHEMA } from './schema'
import { hashPassword } from '../crypto'
import type { Adapter, DbKind } from './adapters'

// Full MySQL schema (all columns, including those SQLite added incrementally via
// ALTER). Long free text is TEXT (nullable); short/keyed text is VARCHAR. No FK
// constraints — referential integrity is managed in the service layer, same as
// the SQLite build effectively does.
const MYSQL_DDL = `
CREATE TABLE IF NOT EXISTS settings (
  \`key\`  VARCHAR(191) NOT NULL PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS counters (
  name    VARCHAR(191) NOT NULL PRIMARY KEY,
  current INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token      VARCHAR(191) NOT NULL PRIMARY KEY,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  user_id    INT
);
CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(191) NOT NULL UNIQUE,
  name          VARCHAR(255) NOT NULL DEFAULT '',
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(32) NOT NULL DEFAULT 'staff',
  access_level  VARCHAR(32) NOT NULL DEFAULT 'view',
  modules       TEXT,
  active        INT NOT NULL DEFAULT 1,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS activity_log (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  ts       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_id  INT,
  username VARCHAR(191) NOT NULL DEFAULT '',
  action   VARCHAR(255) NOT NULL DEFAULT '',
  module   VARCHAR(64) NOT NULL DEFAULT '',
  method   VARCHAR(64) NOT NULL DEFAULT '',
  detail   TEXT,
  ip       VARCHAR(64) NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS plants (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  code       VARCHAR(64) NOT NULL,
  location   VARCHAR(255) NOT NULL DEFAULT '',
  status     VARCHAR(32) NOT NULL DEFAULT 'active',
  ton_per_cm DOUBLE NOT NULL DEFAULT 1.6,
  cft_per_cm DOUBLE NOT NULL DEFAULT 35.31,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  plant_id    INT NOT NULL,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  status      VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS customer_rates (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  customer_id  INT NOT NULL,
  plant_id     INT NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  uom          VARCHAR(8) NOT NULL DEFAULT 'CM',
  rate         DOUBLE NOT NULL DEFAULT 0,
  updated_at   VARCHAR(32) NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS rate_chart (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  product_name      VARCHAR(255) NOT NULL,
  stock_location_id INT NOT NULL,
  uom               VARCHAR(8) NOT NULL DEFAULT 'CM',
  rate_wholesale    DOUBLE NOT NULL DEFAULT 0,
  rate_retail       DOUBLE NOT NULL DEFAULT 0,
  rate_customer     DOUBLE NOT NULL DEFAULT 0,
  updated_at        VARCHAR(32) NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS transport_charges (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_type      VARCHAR(255) NOT NULL,
  stock_location_id INT NOT NULL,
  basis             VARCHAR(8) NOT NULL DEFAULT 'trip',
  charge            DOUBLE NOT NULL DEFAULT 0,
  updated_at        VARCHAR(32) NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS stock_locations (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  plant_id    INT NOT NULL,
  name        VARCHAR(255) NOT NULL,
  opening_qty DOUBLE NOT NULL DEFAULT 0,
  remarks     TEXT,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS suppliers (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  contact    VARCHAR(255) NOT NULL DEFAULT '',
  address    TEXT,
  remarks    TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  company_id INT,
  plant_id   INT
);
CREATE TABLE IF NOT EXISTS customers (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  contact     VARCHAR(255) NOT NULL DEFAULT '',
  address     TEXT,
  remarks     TEXT,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  company_id  INT,
  plant_id    INT,
  share_token VARCHAR(64)
);
CREATE TABLE IF NOT EXISTS transporters (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  contact    VARCHAR(255) NOT NULL DEFAULT '',
  address    TEXT,
  remarks    TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  company_id INT,
  plant_id   INT
);
CREATE TABLE IF NOT EXISTS companies (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  contact    VARCHAR(255) NOT NULL DEFAULT '',
  address    TEXT,
  remarks    TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS businesses (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  contact    VARCHAR(255) NOT NULL DEFAULT '',
  remarks    TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS outsource (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  head       VARCHAR(255) NOT NULL DEFAULT '',
  contact    VARCHAR(255) NOT NULL DEFAULT '',
  remarks    TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS purchases (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  purchase_no       VARCHAR(191) NOT NULL UNIQUE,
  supplier_id       INT NOT NULL,
  plant_id          INT NOT NULL,
  stock_location_id INT NOT NULL,
  material_type     VARCHAR(16) NOT NULL DEFAULT 'raw',
  product_name      VARCHAR(255) NOT NULL DEFAULT '',
  outsource_id      INT,
  quantity          DOUBLE NOT NULL,
  rate              DOUBLE,
  amount            DOUBLE,
  paid_amount       DOUBLE NOT NULL DEFAULT 0,
  payment_status    VARCHAR(32) NOT NULL DEFAULT 'unpaid',
  date              VARCHAR(32) NOT NULL,
  remarks           TEXT,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS production_settings (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  plant_id          INT NOT NULL,
  product_name      VARCHAR(255) NOT NULL,
  output_percentage DOUBLE NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS productions (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  production_no     VARCHAR(191) NOT NULL UNIQUE,
  plant_id          INT NOT NULL,
  stock_location_id INT NOT NULL,
  raw_qty           DOUBLE NOT NULL,
  date              VARCHAR(32) NOT NULL,
  remarks           TEXT,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS production_outputs (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  production_id INT NOT NULL,
  product_name  VARCHAR(255) NOT NULL,
  percentage    DOUBLE NOT NULL,
  quantity      DOUBLE NOT NULL
);
CREATE TABLE IF NOT EXISTS finished_goods_opening (
  plant_id     INT NOT NULL,
  product_name VARCHAR(191) NOT NULL,
  opening_qty  DOUBLE NOT NULL DEFAULT 0,
  PRIMARY KEY (plant_id, product_name)
);
CREATE TABLE IF NOT EXISTS dispatches (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  dispatch_no      VARCHAR(191) NOT NULL UNIQUE,
  customer_id      INT NOT NULL,
  plant_id         INT NOT NULL,
  product_name     VARCHAR(255) NOT NULL,
  uom              VARCHAR(8) NOT NULL DEFAULT 'CM',
  quantity         DOUBLE NOT NULL,
  qty_cm           DOUBLE NOT NULL DEFAULT 0,
  sale_quantity    DOUBLE,
  outsource_id     INT,
  transporter_id   INT,
  rate             DOUBLE,
  amount           DOUBLE,
  transport_charge DOUBLE NOT NULL DEFAULT 0,
  transport_billed INT NOT NULL DEFAULT 0,
  other_charge     DOUBLE NOT NULL DEFAULT 0,
  other_billed     INT NOT NULL DEFAULT 0,
  vehicle_no       VARCHAR(64) NOT NULL DEFAULT '',
  vehicle_type     VARCHAR(16) NOT NULL DEFAULT 'own',
  driver           VARCHAR(255) NOT NULL DEFAULT '',
  challan_no       VARCHAR(64) NOT NULL DEFAULT '',
  outsourced       INT NOT NULL DEFAULT 0,
  delivery_status  VARCHAR(32) NOT NULL DEFAULT 'pending',
  dispatch_status  VARCHAR(32) NOT NULL DEFAULT 'pending',
  payment_status   VARCHAR(32) NOT NULL DEFAULT 'unpaid',
  paid_amount      DOUBLE NOT NULL DEFAULT 0,
  date             VARCHAR(32) NOT NULL,
  remarks          TEXT,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS stock_movements (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  type              VARCHAR(32) NOT NULL,
  material_type     VARCHAR(16) NOT NULL,
  ref_no            VARCHAR(64) NOT NULL DEFAULT '',
  plant_id          INT NOT NULL,
  stock_location_id INT,
  product_name      VARCHAR(255),
  change_qty        DOUBLE NOT NULL,
  date              VARCHAR(32) NOT NULL,
  note              TEXT,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS racks (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  rack_no     VARCHAR(191) NOT NULL UNIQUE,
  destination VARCHAR(255) NOT NULL DEFAULT '',
  date        VARCHAR(32) NOT NULL,
  status      VARCHAR(32) NOT NULL DEFAULT 'loading',
  remarks     TEXT,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS rack_loadings (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  loading_no     VARCHAR(191) NOT NULL UNIQUE,
  rack_id        INT NOT NULL,
  plant_id       INT NOT NULL,
  product_name   VARCHAR(255) NOT NULL,
  transporter_id INT NOT NULL,
  vehicle_no     VARCHAR(64) NOT NULL DEFAULT '',
  trips          DOUBLE NOT NULL DEFAULT 0,
  per_trip_cm    DOUBLE NOT NULL DEFAULT 0,
  total_cm       DOUBLE NOT NULL,
  rate           DOUBLE,
  amount         DOUBLE,
  diesel_litres  DOUBLE,
  diesel_amount  DOUBLE,
  outsourced     INT NOT NULL DEFAULT 0,
  date           VARCHAR(32) NOT NULL,
  remarks        TEXT,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS expense_types (
  id   INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(191) NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS rack_expenses (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  rack_id      INT NOT NULL,
  expense_type VARCHAR(191) NOT NULL,
  amount       DOUBLE NOT NULL,
  date         VARCHAR(32) NOT NULL,
  remarks      TEXT,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS rack_unloadings (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  unloading_no   VARCHAR(191) NOT NULL UNIQUE,
  rack_id        INT NOT NULL,
  product_name   VARCHAR(255) NOT NULL,
  transporter_id INT,
  vehicle_no     VARCHAR(64) NOT NULL DEFAULT '',
  trips          DOUBLE NOT NULL DEFAULT 0,
  per_trip_cm    DOUBLE NOT NULL DEFAULT 0,
  total_cm       DOUBLE NOT NULL DEFAULT 0,
  uom            VARCHAR(8) NOT NULL DEFAULT 'CM',
  quantity       DOUBLE NOT NULL DEFAULT 0,
  qty_cm         DOUBLE NOT NULL,
  rate           DOUBLE,
  amount         DOUBLE,
  diesel_litres  DOUBLE,
  diesel_amount  DOUBLE,
  date           VARCHAR(32) NOT NULL,
  remarks        TEXT,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS rack_sales (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  sale_no      VARCHAR(191) NOT NULL UNIQUE,
  rack_id      INT NOT NULL,
  customer_id  INT NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  uom          VARCHAR(8) NOT NULL DEFAULT 'CM',
  quantity     DOUBLE NOT NULL,
  qty_cm       DOUBLE NOT NULL,
  rate         DOUBLE,
  amount       DOUBLE,
  truck_no     VARCHAR(64) NOT NULL DEFAULT '',
  date         VARCHAR(32) NOT NULL,
  remarks      TEXT,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS assets (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  asset_type  VARCHAR(16) NOT NULL DEFAULT 'machine',
  category    VARCHAR(64) NOT NULL DEFAULT '',
  identifier  VARCHAR(64) NOT NULL DEFAULT '',
  plant_id    INT,
  business_id INT,
  status      VARCHAR(32) NOT NULL DEFAULT 'active',
  remarks     TEXT,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS plant_expenses (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  expense_no     VARCHAR(191) NOT NULL UNIQUE,
  plant_id       INT NOT NULL,
  category       VARCHAR(32) NOT NULL,
  title          VARCHAR(255) NOT NULL DEFAULT '',
  asset_id       INT,
  outsource_id   INT,
  meter_open     DOUBLE,
  meter_close    DOUBLE,
  units          DOUBLE,
  rate           DOUBLE,
  hours          DOUBLE,
  parts          TEXT,
  amount         DOUBLE NOT NULL DEFAULT 0,
  payment_status VARCHAR(32) NOT NULL DEFAULT 'unpaid',
  paid_amount    DOUBLE NOT NULL DEFAULT 0,
  date           VARCHAR(32) NOT NULL,
  remarks        TEXT,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS employees (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(255) NOT NULL,
  designation    VARCHAR(255) NOT NULL DEFAULT '',
  wage_type      VARCHAR(16) NOT NULL DEFAULT 'monthly',
  monthly_salary DOUBLE NOT NULL DEFAULT 0,
  daily_wage     DOUBLE NOT NULL DEFAULT 0,
  ot_rate        DOUBLE NOT NULL DEFAULT 0,
  plant_id       INT,
  contact        VARCHAR(255) NOT NULL DEFAULT '',
  status         VARCHAR(32) NOT NULL DEFAULT 'active',
  remarks        TEXT,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS wage_entries (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  entry_no       VARCHAR(191) NOT NULL UNIQUE,
  employee_id    INT NOT NULL,
  plant_id       INT NOT NULL,
  asset_id       INT,
  period         VARCHAR(32) NOT NULL,
  wage_type      VARCHAR(16) NOT NULL DEFAULT 'monthly',
  working_days   DOUBLE NOT NULL DEFAULT 0,
  days_worked    DOUBLE NOT NULL DEFAULT 0,
  earned         DOUBLE NOT NULL DEFAULT 0,
  ot_hours       DOUBLE NOT NULL DEFAULT 0,
  ot_rate        DOUBLE NOT NULL DEFAULT 0,
  ot_amount      DOUBLE NOT NULL DEFAULT 0,
  deduction      DOUBLE NOT NULL DEFAULT 0,
  gross          DOUBLE NOT NULL DEFAULT 0,
  amount         DOUBLE NOT NULL DEFAULT 0,
  payment_status VARCHAR(32) NOT NULL DEFAULT 'unpaid',
  paid_amount    DOUBLE NOT NULL DEFAULT 0,
  date           VARCHAR(32) NOT NULL,
  remarks        TEXT,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS diesel_purchases (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  purchase_no    VARCHAR(191) NOT NULL UNIQUE,
  supplier_id    INT NOT NULL,
  plant_id       INT NOT NULL,
  litres         DOUBLE NOT NULL,
  rate           DOUBLE,
  amount         DOUBLE,
  payment_status VARCHAR(32) NOT NULL DEFAULT 'unpaid',
  paid_amount    DOUBLE NOT NULL DEFAULT 0,
  date           VARCHAR(32) NOT NULL,
  remarks        TEXT,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS diesel_issues (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  issue_no   VARCHAR(191) NOT NULL UNIQUE,
  plant_id   INT NOT NULL,
  asset_id   INT,
  litres     DOUBLE NOT NULL,
  date       VARCHAR(32) NOT NULL,
  remarks    TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS opening_balances (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  party_type  VARCHAR(32) NOT NULL,
  party_id    INT NOT NULL,
  amount      DOUBLE NOT NULL DEFAULT 0,
  direction   VARCHAR(8) NOT NULL DEFAULT 'debit',
  as_of_date  VARCHAR(32) NOT NULL,
  remarks     TEXT,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS budgets (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  plant_id   INT NOT NULL,
  head       VARCHAR(32) NOT NULL,
  from_date  VARCHAR(32) NOT NULL,
  to_date    VARCHAR(32) NOT NULL,
  amount     DOUBLE NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS payments (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  party_type VARCHAR(32) NOT NULL,
  party_id   INT NOT NULL,
  direction  VARCHAR(8) NOT NULL,
  amount     DOUBLE NOT NULL,
  mode       VARCHAR(16) NOT NULL DEFAULT 'cash',
  ref        VARCHAR(255) NOT NULL DEFAULT '',
  date       VARCHAR(32) NOT NULL,
  remarks    TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_loc_plant ON stock_locations(plant_id);
CREATE INDEX idx_rload_rack ON rack_loadings(rack_id);
CREATE INDEX idx_rload_transporter ON rack_loadings(transporter_id);
CREATE INDEX idx_rexp_rack ON rack_expenses(rack_id);
CREATE INDEX idx_runload_rack ON rack_unloadings(rack_id);
CREATE INDEX idx_rsale_rack ON rack_sales(rack_id);
CREATE INDEX idx_rsale_customer ON rack_sales(customer_id);
CREATE INDEX idx_pay_party ON payments(party_type, party_id);
CREATE INDEX idx_assets_plant ON assets(plant_id);
CREATE INDEX idx_pexp_plant ON plant_expenses(plant_id);
CREATE INDEX idx_dpur_plant ON diesel_purchases(plant_id);
CREATE INDEX idx_diss_plant ON diesel_issues(plant_id);
CREATE INDEX idx_emp_plant ON employees(plant_id);
CREATE INDEX idx_wage_plant ON wage_entries(plant_id);
CREATE INDEX idx_purchase_supplier ON purchases(supplier_id);
CREATE INDEX idx_dispatch_customer ON dispatches(customer_id);
CREATE INDEX idx_move_plant ON stock_movements(plant_id);
`

interface Migration {
  id: string
  sql: string
}

const MYSQL_MIGRATIONS: Migration[] = [
  { id: '001_initial_schema', sql: MYSQL_DDL },
  {
    // Per-module edit access. Existing edit-level users get edit on all their modules.
    id: '002_user_edit_modules',
    sql: `ALTER TABLE users ADD COLUMN edit_modules TEXT;
UPDATE users SET edit_modules = modules WHERE access_level = 'edit'`
  },
  {
    // Multi-UOM purchases. Existing rows were in m³, so qty_cm mirrors quantity.
    id: '003_purchase_uom',
    sql: `ALTER TABLE purchases ADD COLUMN uom VARCHAR(8) NOT NULL DEFAULT 'CM';
ALTER TABLE purchases ADD COLUMN qty_cm DOUBLE NOT NULL DEFAULT 0;
UPDATE purchases SET qty_cm = quantity WHERE qty_cm = 0`
  },
  {
    // Per-plant UOM/density factors, Products master, per-customer rate lists,
    // and a public share token on customers (for the no-login rate page).
    id: '004_products_rates_density',
    sql: `ALTER TABLE plants ADD COLUMN ton_per_cm DOUBLE NOT NULL DEFAULT 1.6;
ALTER TABLE plants ADD COLUMN cft_per_cm DOUBLE NOT NULL DEFAULT 35.31;
ALTER TABLE customers ADD COLUMN share_token VARCHAR(64);
CREATE TABLE IF NOT EXISTS products (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  plant_id    INT NOT NULL,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  status      VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS customer_rates (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  customer_id  INT NOT NULL,
  plant_id     INT NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  uom          VARCHAR(8) NOT NULL DEFAULT 'CM',
  rate         DOUBLE NOT NULL DEFAULT 0,
  updated_at   VARCHAR(32) NOT NULL DEFAULT ''
);
CREATE INDEX idx_products_plant ON products(plant_id);
CREATE INDEX idx_crates_customer ON customer_rates(customer_id)`
  },
  {
    // Purchasing finished goods: a purchase can be raw material or a finished
    // product (which lands in finished-goods stock).
    id: '005_purchase_finished_goods',
    sql: `ALTER TABLE purchases ADD COLUMN material_type VARCHAR(16) NOT NULL DEFAULT 'raw';
ALTER TABLE purchases ADD COLUMN product_name VARCHAR(255) NOT NULL DEFAULT ''`
  },
  {
    // Direct sale: actual quantity (existing 'quantity') vs sale quantity. The
    // bill uses sale_quantity when set, otherwise the actual quantity.
    id: '006_dispatch_sale_quantity',
    sql: `ALTER TABLE dispatches ADD COLUMN sale_quantity DOUBLE`
  },
  {
    // Tag a sale / purchase with the outsource vendor it came from (shows the head).
    id: '007_outsource_on_sale_purchase',
    sql: `ALTER TABLE dispatches ADD COLUMN outsource_id INT;
ALTER TABLE purchases ADD COLUMN outsource_id INT`
  },
  {
    // Per-account opening balances (financial-year carry-forward is computed).
    id: '008_opening_balances',
    sql: `CREATE TABLE IF NOT EXISTS opening_balances (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  party_type  VARCHAR(32) NOT NULL,
  party_id    INT NOT NULL,
  amount      DOUBLE NOT NULL DEFAULT 0,
  direction   VARCHAR(8) NOT NULL DEFAULT 'debit',
  as_of_date  VARCHAR(32) NOT NULL,
  remarks     TEXT,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_opening_party ON opening_balances(party_type, party_id)`
  },
  {
    // Advanced rate chart (product × location × tier) + transport charges (vehicle × location).
    id: '009_rate_chart_transport',
    sql: `CREATE TABLE IF NOT EXISTS rate_chart (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  product_name      VARCHAR(255) NOT NULL,
  stock_location_id INT NOT NULL,
  uom               VARCHAR(8) NOT NULL DEFAULT 'CM',
  rate_wholesale    DOUBLE NOT NULL DEFAULT 0,
  rate_retail       DOUBLE NOT NULL DEFAULT 0,
  rate_customer     DOUBLE NOT NULL DEFAULT 0,
  updated_at        VARCHAR(32) NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS transport_charges (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_type      VARCHAR(255) NOT NULL,
  stock_location_id INT NOT NULL,
  basis             VARCHAR(8) NOT NULL DEFAULT 'trip',
  charge            DOUBLE NOT NULL DEFAULT 0,
  updated_at        VARCHAR(32) NOT NULL DEFAULT ''
);
CREATE INDEX idx_ratechart_loc ON rate_chart(stock_location_id);
CREATE INDEX idx_transport_loc ON transport_charges(stock_location_id)`
  },
  {
    // Dispatch stage on direct sales + plant-wise budgets.
    id: '010_dispatch_status_and_budgets',
    sql: `ALTER TABLE dispatches ADD COLUMN dispatch_status VARCHAR(32) NOT NULL DEFAULT 'pending';
CREATE TABLE IF NOT EXISTS budgets (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  plant_id   INT NOT NULL,
  head       VARCHAR(32) NOT NULL,
  from_date  VARCHAR(32) NOT NULL,
  to_date    VARCHAR(32) NOT NULL,
  amount     DOUBLE NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_budget_plant ON budgets(plant_id)`
  },
  {
    // Select a transporter on a direct sale (auto-links the transporter ledger).
    id: '011_dispatch_transporter',
    sql: `ALTER TABLE dispatches ADD COLUMN transporter_id INT`
  }
]

/** Add columns introduced after the first release to existing SQLite databases. */
async function sqliteLegacyMigrate(adapter: Adapter): Promise<void> {
  const addColumn = async (table: string, col: string, def: string): Promise<void> => {
    const cols = (await adapter.exec(`PRAGMA table_info(${table})`, undefined, null)).rows as {
      name: string
    }[]
    if (!cols.some((c) => c.name === col)) {
      await adapter.execRaw(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`)
    }
  }
  for (const table of ['suppliers', 'customers', 'transporters']) {
    await addColumn(table, 'company_id', 'INTEGER')
    await addColumn(table, 'plant_id', 'INTEGER')
  }
  await addColumn('dispatches', 'uom', `TEXT NOT NULL DEFAULT 'CM'`)
  await addColumn('dispatches', 'qty_cm', 'REAL NOT NULL DEFAULT 0')
  await addColumn('dispatches', 'transport_charge', 'REAL NOT NULL DEFAULT 0')
  await addColumn('dispatches', 'transport_billed', 'INTEGER NOT NULL DEFAULT 0')
  await addColumn('dispatches', 'other_charge', 'REAL NOT NULL DEFAULT 0')
  await addColumn('dispatches', 'other_billed', 'INTEGER NOT NULL DEFAULT 0')
  await addColumn('dispatches', 'vehicle_type', `TEXT NOT NULL DEFAULT 'own'`)
  await addColumn('dispatches', 'challan_no', `TEXT NOT NULL DEFAULT ''`)
  await addColumn('dispatches', 'payment_status', `TEXT NOT NULL DEFAULT 'unpaid'`)
  await addColumn('dispatches', 'paid_amount', 'REAL NOT NULL DEFAULT 0')
  await adapter.execRaw(`UPDATE dispatches SET qty_cm = quantity WHERE qty_cm = 0 AND quantity <> 0`)
  await addColumn('dispatches', 'outsourced', 'INTEGER NOT NULL DEFAULT 0')
  await addColumn('dispatches', 'dispatch_status', `TEXT NOT NULL DEFAULT 'pending'`)
  await addColumn('dispatches', 'transporter_id', 'INTEGER')
  await addColumn('rack_loadings', 'outsourced', 'INTEGER NOT NULL DEFAULT 0')
  await addColumn('rack_sales', 'truck_no', `TEXT NOT NULL DEFAULT ''`)
  await addColumn('rack_unloadings', 'transporter_id', 'INTEGER')
  await addColumn('rack_unloadings', 'vehicle_no', `TEXT NOT NULL DEFAULT ''`)
  await addColumn('rack_unloadings', 'trips', 'REAL NOT NULL DEFAULT 0')
  await addColumn('rack_unloadings', 'per_trip_cm', 'REAL NOT NULL DEFAULT 0')
  await addColumn('rack_unloadings', 'total_cm', 'REAL NOT NULL DEFAULT 0')
  await addColumn('rack_unloadings', 'rate', 'REAL')
  await addColumn('rack_unloadings', 'amount', 'REAL')
  await addColumn('rack_unloadings', 'diesel_litres', 'REAL')
  await addColumn('rack_unloadings', 'diesel_amount', 'REAL')
  await adapter.execRaw(`UPDATE rack_unloadings SET total_cm = qty_cm WHERE total_cm = 0 AND qty_cm <> 0`)
  await addColumn('assets', 'business_id', 'INTEGER')
  await addColumn('wage_entries', 'asset_id', 'INTEGER')
  await addColumn('plant_expenses', 'outsource_id', 'INTEGER')
  await addColumn('sessions', 'user_id', 'INTEGER')
  await addColumn('users', 'edit_modules', `TEXT NOT NULL DEFAULT '[]'`)
  await adapter.execRaw(`UPDATE users SET edit_modules = modules WHERE access_level = 'edit' AND (edit_modules IS NULL OR edit_modules = '' OR edit_modules = '[]')`)
  // Multi-UOM purchases: existing rows were recorded in m³, so qty_cm mirrors quantity.
  await addColumn('purchases', 'uom', `TEXT NOT NULL DEFAULT 'CM'`)
  await addColumn('purchases', 'qty_cm', 'REAL NOT NULL DEFAULT 0')
  await adapter.execRaw(`UPDATE purchases SET qty_cm = quantity WHERE qty_cm = 0 AND quantity <> 0`)
  // Per-plant UOM/density factors and the customer share token.
  await addColumn('plants', 'ton_per_cm', 'REAL NOT NULL DEFAULT 1.6')
  await addColumn('plants', 'cft_per_cm', 'REAL NOT NULL DEFAULT 35.31')
  await addColumn('customers', 'share_token', 'TEXT')
  // Purchasing finished goods (raw vs finished product).
  await addColumn('purchases', 'material_type', `TEXT NOT NULL DEFAULT 'raw'`)
  await addColumn('purchases', 'product_name', `TEXT NOT NULL DEFAULT ''`)
  // Direct sale: separate sale quantity from the actual dispatched quantity.
  await addColumn('dispatches', 'sale_quantity', 'REAL')
  // Outsource vendor tag on sales and purchases.
  await addColumn('dispatches', 'outsource_id', 'INTEGER')
  await addColumn('purchases', 'outsource_id', 'INTEGER')
}

/**
 * Keep the global Products master in sync: import any product names that exist
 * in production settings but not yet in products, and de-duplicate products by
 * name (products are global, not plant-specific). Safe to run on every boot.
 */
async function importProductsFromSettings(adapter: Adapter): Promise<void> {
  // De-dupe existing products by name (keep the lowest id). Handles upgrades
  // from the earlier plant-scoped products, where the same name could repeat.
  const all = (await adapter.exec(`SELECT id, name FROM products ORDER BY id`, undefined, null))
    .rows as { id: number; name: string }[]
  const keep = new Map<string, number>()
  for (const p of all) {
    const key = (p.name || '').trim().toLowerCase()
    if (!key) continue
    if (!keep.has(key)) keep.set(key, p.id)
    else await adapter.exec(`DELETE FROM products WHERE id = ?`, [p.id], null)
  }
  // Import distinct production-settings product names that aren't products yet.
  const names = (
    await adapter.exec(
      `SELECT DISTINCT product_name FROM production_settings`,
      undefined,
      null
    )
  ).rows as { product_name: string }[]
  for (const r of names) {
    const name = (r.product_name || '').trim()
    if (!name) continue
    if (keep.has(name.toLowerCase())) continue
    await adapter.exec(
      `INSERT INTO products (plant_id, name, description, status) VALUES (0, ?, '', 'active')`,
      [name],
      null
    )
    keep.set(name.toLowerCase(), 0)
  }
}

async function seedDefaults(adapter: Adapter): Promise<void> {
  const pwRow = (
    await adapter.exec("SELECT value FROM settings WHERE `key` = 'admin_password'", undefined, null)
  ).rows[0] as { value: string } | undefined
  if (!pwRow) {
    await adapter.exec("INSERT INTO settings (`key`, value) VALUES ('admin_password', ?)", ['admin123'], null)
  }
  const cnt = (await adapter.exec('SELECT COUNT(*) AS n FROM users', undefined, null)).rows[0] as {
    n: number
  }
  if (Number(cnt.n) === 0) {
    const stored =
      ((await adapter.exec("SELECT value FROM settings WHERE `key` = 'admin_password'", undefined, null))
        .rows[0] as { value: string } | undefined)?.value || 'admin123'
    const hash = stored.startsWith('scrypt$') ? stored : hashPassword(stored)
    await adapter.exec(
      `INSERT INTO users (username, name, password_hash, role, access_level, modules, active)
       VALUES ('admin', 'Administrator', ?, 'admin', 'edit', '[]', 1)`,
      [hash],
      null
    )
  }
}

/** Create/upgrade the schema and seed defaults. Runs on every startup/deploy. */
export async function runMigrations(adapter: Adapter, kind: DbKind): Promise<void> {
  if (kind === 'sqlite') {
    await adapter.execRaw(SCHEMA)
    await sqliteLegacyMigrate(adapter)
  } else {
    await adapter.execRaw(
      `CREATE TABLE IF NOT EXISTS schema_migrations (id VARCHAR(191) NOT NULL PRIMARY KEY, applied_at VARCHAR(32))`
    )
    for (const m of MYSQL_MIGRATIONS) {
      const done = (await adapter.exec('SELECT id FROM schema_migrations WHERE id = ?', [m.id], null)).rows
      if (done.length > 0) continue
      const statements = m.sql
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      for (const stmt of statements) {
        try {
          await adapter.exec(stmt, undefined, null)
        } catch (e) {
          const msg = String((e as Error)?.message || '')
          // Tolerate "already applied" errors so a re-run after a partial/failed
          // attempt still succeeds (MySQL DDL auto-commits and can't roll back).
          if (/duplicate column|already exists|duplicate key name|check that column/i.test(msg)) continue
          throw e
        }
      }
      await adapter.exec('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', [
        m.id,
        new Date().toISOString()
      ], null)
    }
  }
  await seedDefaults(adapter)
  await importProductsFromSettings(adapter)
}
