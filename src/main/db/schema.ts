export const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS counters (
  name    TEXT PRIMARY KEY,
  current INTEGER NOT NULL DEFAULT 0
);

-- Web sessions (used only by the web server; harmless in the desktop build).
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Application users (multi-user access). role 'admin' = full; 'staff' is scoped
-- by access_level (view/edit) and the modules JSON array.
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'staff',
  access_level  TEXT NOT NULL DEFAULT 'view',
  modules       TEXT NOT NULL DEFAULT '[]',
  edit_modules  TEXT NOT NULL DEFAULT '[]',
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Audit trail: who did what (mutating actions + login/logout).
CREATE TABLE IF NOT EXISTS activity_log (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  user_id  INTEGER,
  username TEXT NOT NULL DEFAULT '',
  action   TEXT NOT NULL DEFAULT '',
  module   TEXT NOT NULL DEFAULT '',
  method   TEXT NOT NULL DEFAULT '',
  detail   TEXT NOT NULL DEFAULT '',
  ip       TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS plants (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  code       TEXT NOT NULL,
  location   TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'active',
  ton_per_cm REAL NOT NULL DEFAULT 1.6,
  cft_per_cm REAL NOT NULL DEFAULT 35.31,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  plant_id    INTEGER NOT NULL REFERENCES plants(id),
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS customer_rates (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  plant_id     INTEGER NOT NULL REFERENCES plants(id),
  product_name TEXT NOT NULL,
  uom          TEXT NOT NULL DEFAULT 'CM',
  rate         REAL NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS rate_chart (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  product_name      TEXT NOT NULL,
  stock_location_id INTEGER NOT NULL REFERENCES stock_locations(id),
  uom               TEXT NOT NULL DEFAULT 'CM',
  rate_wholesale    REAL NOT NULL DEFAULT 0,
  rate_retail       REAL NOT NULL DEFAULT 0,
  rate_customer     REAL NOT NULL DEFAULT 0,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS transport_charges (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_type      TEXT NOT NULL,
  stock_location_id INTEGER NOT NULL REFERENCES stock_locations(id),
  basis             TEXT NOT NULL DEFAULT 'trip',
  charge            REAL NOT NULL DEFAULT 0,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS stock_locations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  plant_id    INTEGER NOT NULL REFERENCES plants(id),
  name        TEXT NOT NULL,
  opening_qty REAL NOT NULL DEFAULT 0,
  remarks     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  contact    TEXT NOT NULL DEFAULT '',
  address    TEXT NOT NULL DEFAULT '',
  remarks    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS customers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  contact     TEXT NOT NULL DEFAULT '',
  address     TEXT NOT NULL DEFAULT '',
  remarks     TEXT NOT NULL DEFAULT '',
  share_token TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS purchases (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_no       TEXT NOT NULL UNIQUE,
  supplier_id       INTEGER NOT NULL REFERENCES suppliers(id),
  plant_id          INTEGER NOT NULL REFERENCES plants(id),
  stock_location_id INTEGER NOT NULL REFERENCES stock_locations(id),
  material_type     TEXT NOT NULL DEFAULT 'raw',
  purchase_mode     TEXT NOT NULL DEFAULT 'purchase',
  product_name      TEXT NOT NULL DEFAULT '',
  outsource_id      INTEGER,
  uom               TEXT NOT NULL DEFAULT 'CM',
  quantity          REAL NOT NULL,
  qty_cm            REAL NOT NULL DEFAULT 0,
  rate              REAL,
  amount            REAL,
  paid_amount       REAL NOT NULL DEFAULT 0,
  payment_status    TEXT NOT NULL DEFAULT 'unpaid',
  date              TEXT NOT NULL,
  remarks           TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS purchase_transporters (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id    INTEGER NOT NULL REFERENCES purchases(id),
  transporter_id INTEGER NOT NULL REFERENCES transporters(id),
  vehicle_no     TEXT NOT NULL DEFAULT '',
  charge         REAL NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS purchase_machines (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id  INTEGER NOT NULL REFERENCES purchases(id),
  asset_id     INTEGER NOT NULL REFERENCES assets(id),
  basis        TEXT NOT NULL DEFAULT 'hour',
  qty          REAL NOT NULL DEFAULT 0,
  rate         REAL NOT NULL DEFAULT 0,
  amount       REAL NOT NULL DEFAULT 0,
  outsource_id INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS production_settings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  plant_id          INTEGER NOT NULL REFERENCES plants(id),
  product_name      TEXT NOT NULL,
  output_percentage REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS productions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  production_no     TEXT NOT NULL UNIQUE,
  plant_id          INTEGER NOT NULL REFERENCES plants(id),
  stock_location_id INTEGER NOT NULL REFERENCES stock_locations(id),
  raw_qty           REAL NOT NULL,
  date              TEXT NOT NULL,
  remarks           TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS production_outputs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  production_id INTEGER NOT NULL REFERENCES productions(id) ON DELETE CASCADE,
  product_name  TEXT NOT NULL,
  percentage    REAL NOT NULL,
  quantity      REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS finished_goods_opening (
  plant_id     INTEGER NOT NULL REFERENCES plants(id),
  product_name TEXT NOT NULL,
  opening_qty  REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (plant_id, product_name)
);

CREATE TABLE IF NOT EXISTS dispatches (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  dispatch_no     TEXT NOT NULL UNIQUE,
  customer_id     INTEGER NOT NULL REFERENCES customers(id),
  plant_id        INTEGER NOT NULL REFERENCES plants(id),
  product_name    TEXT NOT NULL,
  uom             TEXT NOT NULL DEFAULT 'CM',
  quantity        REAL NOT NULL,
  qty_cm          REAL NOT NULL DEFAULT 0,
  sale_quantity   REAL,
  outsource_id    INTEGER,
  transporter_id  INTEGER,
  rate            REAL,
  amount          REAL,
  transport_charge REAL NOT NULL DEFAULT 0,
  transport_billed INTEGER NOT NULL DEFAULT 0,
  other_charge    REAL NOT NULL DEFAULT 0,
  other_billed    INTEGER NOT NULL DEFAULT 0,
  vehicle_no      TEXT NOT NULL DEFAULT '',
  vehicle_type    TEXT NOT NULL DEFAULT 'own',
  driver          TEXT NOT NULL DEFAULT '',
  challan_no      TEXT NOT NULL DEFAULT '',
  delivery_status TEXT NOT NULL DEFAULT 'pending',
  dispatch_status TEXT NOT NULL DEFAULT 'pending',
  payment_status  TEXT NOT NULL DEFAULT 'unpaid',
  paid_amount     REAL NOT NULL DEFAULT 0,
  date            TEXT NOT NULL,
  remarks         TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  type              TEXT NOT NULL,
  material_type     TEXT NOT NULL,
  ref_no            TEXT NOT NULL DEFAULT '',
  plant_id          INTEGER NOT NULL,
  stock_location_id INTEGER,
  product_name      TEXT,
  change_qty        REAL NOT NULL,
  date              TEXT NOT NULL,
  note              TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS companies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  contact    TEXT NOT NULL DEFAULT '',
  address    TEXT NOT NULL DEFAULT '',
  remarks    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS businesses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  contact    TEXT NOT NULL DEFAULT '',
  remarks    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS outsource (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  head       TEXT NOT NULL DEFAULT '',
  contact    TEXT NOT NULL DEFAULT '',
  remarks    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS transporters (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  contact    TEXT NOT NULL DEFAULT '',
  address    TEXT NOT NULL DEFAULT '',
  remarks    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS racks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  rack_no     TEXT NOT NULL UNIQUE,
  destination TEXT NOT NULL DEFAULT '',
  date        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'loading',
  remarks     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS rack_loadings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  loading_no     TEXT NOT NULL UNIQUE,
  rack_id        INTEGER NOT NULL REFERENCES racks(id),
  plant_id       INTEGER NOT NULL REFERENCES plants(id),
  product_name   TEXT NOT NULL,
  transporter_id INTEGER NOT NULL REFERENCES transporters(id),
  vehicle_no     TEXT NOT NULL DEFAULT '',
  trips          REAL NOT NULL DEFAULT 0,
  per_trip_cm    REAL NOT NULL DEFAULT 0,
  total_cm       REAL NOT NULL,
  rate           REAL,
  amount         REAL,
  diesel_litres  REAL,
  diesel_amount  REAL,
  date           TEXT NOT NULL,
  remarks        TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS expense_types (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS rack_expenses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  rack_id      INTEGER NOT NULL REFERENCES racks(id),
  expense_type TEXT NOT NULL,
  amount       REAL NOT NULL,
  date         TEXT NOT NULL,
  remarks      TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS rack_unloadings (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  unloading_no   TEXT NOT NULL UNIQUE,
  rack_id        INTEGER NOT NULL REFERENCES racks(id),
  product_name   TEXT NOT NULL,
  transporter_id INTEGER REFERENCES transporters(id),
  vehicle_no     TEXT NOT NULL DEFAULT '',
  trips          REAL NOT NULL DEFAULT 0,
  per_trip_cm    REAL NOT NULL DEFAULT 0,
  total_cm       REAL NOT NULL DEFAULT 0,
  uom            TEXT NOT NULL DEFAULT 'CM',
  quantity       REAL NOT NULL DEFAULT 0,
  qty_cm         REAL NOT NULL,
  rate           REAL,
  amount         REAL,
  diesel_litres  REAL,
  diesel_amount  REAL,
  date           TEXT NOT NULL,
  remarks        TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS rack_sales (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_no      TEXT NOT NULL UNIQUE,
  rack_id      INTEGER NOT NULL REFERENCES racks(id),
  customer_id  INTEGER NOT NULL REFERENCES customers(id),
  product_name TEXT NOT NULL,
  uom          TEXT NOT NULL DEFAULT 'CM',
  quantity     REAL NOT NULL,
  qty_cm       REAL NOT NULL,
  rate         REAL,
  amount       REAL,
  date         TEXT NOT NULL,
  remarks      TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS assets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  asset_type  TEXT NOT NULL DEFAULT 'machine',
  category    TEXT NOT NULL DEFAULT '',
  identifier  TEXT NOT NULL DEFAULT '',
  plant_id    INTEGER,
  status      TEXT NOT NULL DEFAULT 'active',
  remarks     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS plant_expenses (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  expense_no     TEXT NOT NULL UNIQUE,
  plant_id       INTEGER NOT NULL REFERENCES plants(id),
  category       TEXT NOT NULL,
  title          TEXT NOT NULL DEFAULT '',
  asset_id       INTEGER,
  meter_open     REAL,
  meter_close    REAL,
  units          REAL,
  rate           REAL,
  hours          REAL,
  parts          TEXT NOT NULL DEFAULT '',
  amount         REAL NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  paid_amount    REAL NOT NULL DEFAULT 0,
  date           TEXT NOT NULL,
  remarks        TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS employees (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  designation    TEXT NOT NULL DEFAULT '',
  wage_type      TEXT NOT NULL DEFAULT 'monthly',
  monthly_salary REAL NOT NULL DEFAULT 0,
  daily_wage     REAL NOT NULL DEFAULT 0,
  ot_rate        REAL NOT NULL DEFAULT 0,
  plant_id       INTEGER,
  contact        TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'active',
  remarks        TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS wage_entries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_no       TEXT NOT NULL UNIQUE,
  employee_id    INTEGER NOT NULL REFERENCES employees(id),
  plant_id       INTEGER NOT NULL REFERENCES plants(id),
  period         TEXT NOT NULL,
  wage_type      TEXT NOT NULL DEFAULT 'monthly',
  working_days   REAL NOT NULL DEFAULT 0,
  days_worked    REAL NOT NULL DEFAULT 0,
  earned         REAL NOT NULL DEFAULT 0,
  ot_hours       REAL NOT NULL DEFAULT 0,
  ot_rate        REAL NOT NULL DEFAULT 0,
  ot_amount      REAL NOT NULL DEFAULT 0,
  deduction      REAL NOT NULL DEFAULT 0,
  gross          REAL NOT NULL DEFAULT 0,
  amount         REAL NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  paid_amount    REAL NOT NULL DEFAULT 0,
  date           TEXT NOT NULL,
  remarks        TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS diesel_purchases (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_no    TEXT NOT NULL UNIQUE,
  supplier_id    INTEGER NOT NULL REFERENCES suppliers(id),
  plant_id       INTEGER NOT NULL REFERENCES plants(id),
  litres         REAL NOT NULL,
  rate           REAL,
  amount         REAL,
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  paid_amount    REAL NOT NULL DEFAULT 0,
  date           TEXT NOT NULL,
  remarks        TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS diesel_issues (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_no   TEXT NOT NULL UNIQUE,
  plant_id   INTEGER NOT NULL REFERENCES plants(id),
  asset_id   INTEGER REFERENCES assets(id),
  litres     REAL NOT NULL,
  date       TEXT NOT NULL,
  remarks    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS opening_balances (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  party_type  TEXT NOT NULL,
  party_id    INTEGER NOT NULL,
  amount      REAL NOT NULL DEFAULT 0,
  direction   TEXT NOT NULL DEFAULT 'debit',
  as_of_date  TEXT NOT NULL,
  remarks     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS budgets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  plant_id   INTEGER NOT NULL REFERENCES plants(id),
  head       TEXT NOT NULL,
  from_date  TEXT NOT NULL,
  to_date    TEXT NOT NULL,
  amount     REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS payments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  party_type TEXT NOT NULL,
  party_id   INTEGER NOT NULL,
  direction  TEXT NOT NULL,
  amount     REAL NOT NULL,
  mode       TEXT NOT NULL DEFAULT 'cash',
  ref        TEXT NOT NULL DEFAULT '',
  date       TEXT NOT NULL,
  remarks    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_loc_plant ON stock_locations(plant_id);
CREATE INDEX IF NOT EXISTS idx_rload_rack ON rack_loadings(rack_id);
CREATE INDEX IF NOT EXISTS idx_rload_transporter ON rack_loadings(transporter_id);
CREATE INDEX IF NOT EXISTS idx_rexp_rack ON rack_expenses(rack_id);
CREATE INDEX IF NOT EXISTS idx_runload_rack ON rack_unloadings(rack_id);
CREATE INDEX IF NOT EXISTS idx_rsale_rack ON rack_sales(rack_id);
CREATE INDEX IF NOT EXISTS idx_rsale_customer ON rack_sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_pay_party ON payments(party_type, party_id);
CREATE INDEX IF NOT EXISTS idx_assets_plant ON assets(plant_id);
CREATE INDEX IF NOT EXISTS idx_pexp_plant ON plant_expenses(plant_id);
CREATE INDEX IF NOT EXISTS idx_dpur_plant ON diesel_purchases(plant_id);
CREATE INDEX IF NOT EXISTS idx_dpur_supplier ON diesel_purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_diss_plant ON diesel_issues(plant_id);
CREATE INDEX IF NOT EXISTS idx_diss_asset ON diesel_issues(asset_id);
CREATE INDEX IF NOT EXISTS idx_emp_plant ON employees(plant_id);
CREATE INDEX IF NOT EXISTS idx_wage_plant ON wage_entries(plant_id);
CREATE INDEX IF NOT EXISTS idx_wage_emp ON wage_entries(employee_id);
CREATE INDEX IF NOT EXISTS idx_purchase_supplier ON purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_psettings_plant ON production_settings(plant_id);
CREATE INDEX IF NOT EXISTS idx_poutputs_prod ON production_outputs(production_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_customer ON dispatches(customer_id);
CREATE INDEX IF NOT EXISTS idx_move_plant ON stock_movements(plant_id);
CREATE INDEX IF NOT EXISTS idx_move_loc ON stock_movements(stock_location_id);
CREATE INDEX IF NOT EXISTS idx_products_plant ON products(plant_id);
CREATE INDEX IF NOT EXISTS idx_crates_customer ON customer_rates(customer_id);
CREATE INDEX IF NOT EXISTS idx_customers_token ON customers(share_token);
CREATE INDEX IF NOT EXISTS idx_opening_party ON opening_balances(party_type, party_id);
CREATE INDEX IF NOT EXISTS idx_ratechart_loc ON rate_chart(stock_location_id);
CREATE INDEX IF NOT EXISTS idx_transport_loc ON transport_charges(stock_location_id);
CREATE INDEX IF NOT EXISTS idx_budget_plant ON budgets(plant_id);
CREATE INDEX IF NOT EXISTS idx_ptrans_purchase ON purchase_transporters(purchase_id);
CREATE INDEX IF NOT EXISTS idx_ptrans_transporter ON purchase_transporters(transporter_id);
CREATE INDEX IF NOT EXISTS idx_pmach_purchase ON purchase_machines(purchase_id);
`
