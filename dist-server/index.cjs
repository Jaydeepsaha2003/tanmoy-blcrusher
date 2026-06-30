var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server/index.ts
var import_node_path2 = __toESM(require("node:path"));
var import_express = __toESM(require("express"));
var import_cookie = require("cookie");

// src/main/db/index.ts
var import_node_async_hooks = require("node:async_hooks");

// server/electron-stub.ts
var app = {
  getPath: (_name) => process.env.BL_DB_DIR || process.cwd()
};

// src/main/db/index.ts
var import_node_path = require("node:path");
var import_node_fs = require("node:fs");

// src/main/db/adapters.ts
function isNamed(params) {
  return !!params && typeof params === "object" && !Array.isArray(params);
}
function isSelect(sql) {
  return /^\s*(select|pragma|with|show|explain|describe)/i.test(sql);
}
function createSqliteAdapter(dbFile) {
  let db = null;
  return {
    kind: "sqlite",
    async init() {
      const Database = require("better-sqlite3");
      db = new Database(dbFile);
      db.pragma("journal_mode = WAL");
      db.pragma("foreign_keys = ON");
    },
    async exec(sql, params) {
      const stmt = db.prepare(sql);
      if (isSelect(sql)) {
        const rows = isNamed(params) ? stmt.all(params) : params == null ? stmt.all() : stmt.all(...params);
        return { rows, runResult: { changes: 0, lastInsertRowid: 0 } };
      }
      const info = isNamed(params) ? stmt.run(params) : params == null ? stmt.run() : stmt.run(...params);
      return { rows: [], runResult: { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) } };
    },
    async execRaw(sql) {
      db.exec(sql);
    },
    // better-sqlite3 is synchronous and single-connection; one DB-wide tx is fine.
    async beginTx() {
      db.exec("BEGIN");
      return db;
    },
    async commitTx() {
      db.exec("COMMIT");
    },
    async rollbackTx() {
      db.exec("ROLLBACK");
    },
    releaseTx() {
    }
  };
}
function toNamed(sql) {
  return sql.replace(/@(\w+)/g, ":$1");
}
function createMysqlAdapter() {
  let pool = null;
  return {
    kind: "mysql",
    async init() {
      const mysql = require("mysql2/promise");
      pool = mysql.createPool({
        host: process.env.DB_HOST || "localhost",
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: Number(process.env.DB_POOL) || 5,
        namedPlaceholders: true,
        dateStrings: true
      });
      const corePool = pool.pool ?? pool;
      if (corePool && typeof corePool.on === "function") {
        corePool.on("connection", (conn) => {
          conn.query("SET SESSION sql_mode='STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'", () => {
          });
        });
      }
    },
    async exec(sql, params, conn) {
      const runner = conn ?? pool;
      let res;
      if (isNamed(params)) {
        res = await runner.query({ sql: toNamed(sql), namedPlaceholders: true, values: params });
      } else if (Array.isArray(params)) {
        res = await runner.query(sql, params);
      } else {
        res = await runner.query(sql);
      }
      const rows = res[0];
      if (Array.isArray(rows)) {
        return { rows, runResult: { changes: 0, lastInsertRowid: 0 } };
      }
      return {
        rows: [],
        runResult: {
          changes: Number(rows?.affectedRows ?? 0),
          lastInsertRowid: Number(rows?.insertId ?? 0)
        }
      };
    },
    async execRaw(sql) {
      const statements = sql.split(";").map((s) => s.trim()).filter((s) => s.length > 0 && !/^--/.test(s));
      for (const stmt of statements) {
        await pool.query(stmt);
      }
    },
    async beginTx() {
      const c = await pool.getConnection();
      await c.beginTransaction();
      return c;
    },
    async commitTx(conn) {
      await conn.commit();
    },
    async rollbackTx(conn) {
      await conn.rollback();
    },
    releaseTx(conn) {
      ;
      conn.release();
    }
  };
}

// src/main/db/schema.ts
var SCHEMA = `
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
  from_plant_id     INTEGER,
  linked_dispatch_id INTEGER,
  uom               TEXT NOT NULL DEFAULT 'CM',
  quantity          REAL NOT NULL,
  qty_cm            REAL NOT NULL DEFAULT 0,
  rate              REAL,
  amount            REAL,
  paid_amount       REAL NOT NULL DEFAULT 0,
  payment_status    TEXT NOT NULL DEFAULT 'unpaid',
  challan_no        TEXT NOT NULL DEFAULT '',
  date              TEXT NOT NULL,
  remarks           TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS purchase_transporters (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id    INTEGER NOT NULL REFERENCES purchases(id),
  transporter_id INTEGER NOT NULL REFERENCES transporters(id),
  vehicle_no     TEXT NOT NULL DEFAULT '',
  basis          TEXT NOT NULL DEFAULT 'flat',
  qty            REAL NOT NULL DEFAULT 0,
  rate           REAL NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS dispatch_transporters (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  dispatch_id    INTEGER NOT NULL REFERENCES dispatches(id),
  transporter_id INTEGER NOT NULL REFERENCES transporters(id),
  vehicle_no     TEXT NOT NULL DEFAULT '',
  basis          TEXT NOT NULL DEFAULT 'flat',
  qty            REAL NOT NULL DEFAULT 0,
  rate           REAL NOT NULL DEFAULT 0,
  charge         REAL NOT NULL DEFAULT 0,
  bill_customer  INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS dispatch_machines (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  dispatch_id  INTEGER NOT NULL REFERENCES dispatches(id),
  asset_id     INTEGER NOT NULL REFERENCES assets(id),
  basis        TEXT NOT NULL DEFAULT 'hour',
  qty          REAL NOT NULL DEFAULT 0,
  rate         REAL NOT NULL DEFAULT 0,
  amount       REAL NOT NULL DEFAULT 0,
  outsource_id INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS rack_sale_transporters (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  rack_sale_id   INTEGER NOT NULL REFERENCES rack_sales(id),
  transporter_id INTEGER REFERENCES transporters(id),
  rack_vehicle_id INTEGER REFERENCES rack_vehicles(id),
  vehicle_no     TEXT NOT NULL DEFAULT '',
  basis          TEXT NOT NULL DEFAULT 'flat',
  qty            REAL NOT NULL DEFAULT 0,
  rate           REAL NOT NULL DEFAULT 0,
  charge         REAL NOT NULL DEFAULT 0,
  diesel_litres  REAL,
  diesel_amount  REAL,
  diesel_charged INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS rack_sale_machines (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  rack_sale_id INTEGER NOT NULL REFERENCES rack_sales(id),
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
  uom               TEXT NOT NULL DEFAULT 'CM',
  quantity          REAL NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS spare_parts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  part_no    TEXT NOT NULL DEFAULT '',
  part_type  TEXT NOT NULL DEFAULT 'new',
  unit       TEXT NOT NULL DEFAULT 'PCS',
  plant_id   INTEGER REFERENCES plants(id),
  min_qty    REAL NOT NULL DEFAULT 0,
  rate       REAL,
  remarks    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS spare_part_movements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id       INTEGER NOT NULL REFERENCES spare_parts(id),
  asset_id      INTEGER REFERENCES assets(id),
  movement_type TEXT NOT NULL,
  ref_no        TEXT NOT NULL DEFAULT '',
  quantity      REAL NOT NULL,
  rate          REAL,
  amount        REAL,
  date          TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS finished_goods_opening (
  plant_id       INTEGER NOT NULL REFERENCES plants(id),
  product_name   TEXT NOT NULL,
  opening_qty    REAL NOT NULL DEFAULT 0,
  opening_rate   REAL NOT NULL DEFAULT 0,
  opening_amount REAL NOT NULL DEFAULT 0,
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
  buy_rate        REAL,
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
  to_plant_id     INTEGER,
  linked_purchase_id INTEGER,
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
  plant_id    INTEGER REFERENCES plants(id),
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
  diesel_charged INTEGER NOT NULL DEFAULT 0,
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
  diesel_charged INTEGER NOT NULL DEFAULT 0,
  rack_vehicle_id INTEGER REFERENCES rack_vehicles(id),
  rack_jcb_id    INTEGER REFERENCES rack_jcbs(id),
  work_type      TEXT,
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
  challan_no   TEXT NOT NULL DEFAULT '',
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

CREATE TABLE IF NOT EXISTS machine_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id      INTEGER NOT NULL REFERENCES assets(id),
  date          TEXT NOT NULL,
  work_type     TEXT NOT NULL DEFAULT '',
  opening_meter REAL NOT NULL DEFAULT 0,
  closing_meter REAL NOT NULL DEFAULT 0,
  usage_qty     REAL NOT NULL DEFAULT 0,
  fuel_litres   REAL,
  rate          REAL,
  amount        REAL,
  remarks       TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS asset_documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id    INTEGER NOT NULL REFERENCES assets(id),
  doc_type    TEXT NOT NULL DEFAULT 'other',
  number      TEXT NOT NULL DEFAULT '',
  issue_date  TEXT,
  expiry_date TEXT,
  file_data   TEXT,
  remarks     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS asset_plants (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id  INTEGER NOT NULL REFERENCES assets(id),
  plant_id  INTEGER NOT NULL REFERENCES plants(id)
);

CREATE TABLE IF NOT EXISTS customer_plants (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  plant_id    INTEGER NOT NULL REFERENCES plants(id)
);
CREATE TABLE IF NOT EXISTS supplier_plants (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  plant_id    INTEGER NOT NULL REFERENCES plants(id)
);
CREATE TABLE IF NOT EXISTS transporter_plants (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  transporter_id INTEGER NOT NULL REFERENCES transporters(id),
  plant_id       INTEGER NOT NULL REFERENCES plants(id)
);
CREATE TABLE IF NOT EXISTS company_plants (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  plant_id   INTEGER NOT NULL REFERENCES plants(id)
);
CREATE TABLE IF NOT EXISTS product_plants (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  plant_id   INTEGER NOT NULL REFERENCES plants(id)
);

-- Railway-rack fleet: hired vehicles and JCB loaders, assignable to multiple plants.
CREATE TABLE IF NOT EXISTS rack_vehicles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_no    TEXT NOT NULL,
  owner_name    TEXT NOT NULL DEFAULT '',
  owner_mobile  TEXT NOT NULL DEFAULT '',
  driver_name   TEXT NOT NULL DEFAULT '',
  driver_mobile TEXT NOT NULL DEFAULT '',
  cap_cm        REAL,
  cap_ton       REAL,
  cap_cft       REAL,
  rate_per_trip REAL,
  remarks       TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS rack_jcbs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  owner_name     TEXT NOT NULL DEFAULT '',
  owner_mobile   TEXT NOT NULL DEFAULT '',
  driver_name    TEXT NOT NULL DEFAULT '',
  driver_mobile  TEXT NOT NULL DEFAULT '',
  rate_unloading REAL,
  rate_loading   REAL,
  rate_other     REAL,
  remarks        TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS rack_vehicle_plants (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  rack_vehicle_id INTEGER NOT NULL REFERENCES rack_vehicles(id),
  plant_id        INTEGER NOT NULL REFERENCES plants(id)
);
CREATE TABLE IF NOT EXISTS rack_jcb_plants (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  rack_jcb_id INTEGER NOT NULL REFERENCES rack_jcbs(id),
  plant_id    INTEGER NOT NULL REFERENCES plants(id)
);

-- A transporter's own fleet: vehicles and JCBs, with capacity in every UOM and
-- per-trip / per-unit rates. kind = 'vehicle' | 'jcb'.
CREATE TABLE IF NOT EXISTS transporter_fleet (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  transporter_id INTEGER NOT NULL REFERENCES transporters(id),
  kind           TEXT NOT NULL DEFAULT 'vehicle',
  name           TEXT NOT NULL DEFAULT '',
  driver_name    TEXT NOT NULL DEFAULT '',
  driver_mobile  TEXT NOT NULL DEFAULT '',
  cap_cm         REAL,
  cap_ton        REAL,
  cap_cft        REAL,
  rate_per_trip  REAL,
  rate_per_unit  REAL,
  rate_unit_uom  TEXT NOT NULL DEFAULT 'CM',
  remarks        TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS asset_plant_moves (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id      INTEGER NOT NULL REFERENCES assets(id),
  from_plant_id INTEGER,
  to_plant_id   INTEGER,
  date          TEXT NOT NULL,
  remarks       TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
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
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_no      TEXT NOT NULL UNIQUE,
  plant_id      INTEGER NOT NULL REFERENCES plants(id),
  asset_id      INTEGER REFERENCES assets(id),
  transporter_id INTEGER REFERENCES transporters(id),
  rate          REAL,
  amount        REAL,
  charged       INTEGER NOT NULL DEFAULT 0,
  litres        REAL NOT NULL,
  date          TEXT NOT NULL,
  remarks       TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS opening_balances (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  party_type  TEXT NOT NULL,
  party_id    INTEGER NOT NULL,
  plant_id    INTEGER REFERENCES plants(id),
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
CREATE INDEX IF NOT EXISTS idx_dtrans_dispatch ON dispatch_transporters(dispatch_id);
CREATE INDEX IF NOT EXISTS idx_dtrans_transporter ON dispatch_transporters(transporter_id);
CREATE INDEX IF NOT EXISTS idx_dmach_dispatch ON dispatch_machines(dispatch_id);
CREATE INDEX IF NOT EXISTS idx_rstrans_sale ON rack_sale_transporters(rack_sale_id);
CREATE INDEX IF NOT EXISTS idx_rstrans_transporter ON rack_sale_transporters(transporter_id);
CREATE INDEX IF NOT EXISTS idx_rsmach_sale ON rack_sale_machines(rack_sale_id);
CREATE INDEX IF NOT EXISTS idx_mlog_asset ON machine_logs(asset_id);
CREATE INDEX IF NOT EXISTS idx_adoc_asset ON asset_documents(asset_id);
CREATE INDEX IF NOT EXISTS idx_adoc_expiry ON asset_documents(expiry_date);
CREATE INDEX IF NOT EXISTS idx_aplants_asset ON asset_plants(asset_id);
CREATE INDEX IF NOT EXISTS idx_aplants_plant ON asset_plants(plant_id);
CREATE INDEX IF NOT EXISTS idx_cplants_customer ON customer_plants(customer_id);
CREATE INDEX IF NOT EXISTS idx_splants_supplier ON supplier_plants(supplier_id);
CREATE INDEX IF NOT EXISTS idx_tplants_transporter ON transporter_plants(transporter_id);
CREATE INDEX IF NOT EXISTS idx_coplants_company ON company_plants(company_id);
CREATE INDEX IF NOT EXISTS idx_pplants_product ON product_plants(product_id);
CREATE INDEX IF NOT EXISTS idx_rvplants_vehicle ON rack_vehicle_plants(rack_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_rjplants_jcb ON rack_jcb_plants(rack_jcb_id);
CREATE INDEX IF NOT EXISTS idx_tfleet_transporter ON transporter_fleet(transporter_id);
CREATE INDEX IF NOT EXISTS idx_amoves_asset ON asset_plant_moves(asset_id);
CREATE INDEX IF NOT EXISTS idx_spare_parts_plant ON spare_parts(plant_id);
CREATE INDEX IF NOT EXISTS idx_part_moves_part ON spare_part_movements(part_id);
CREATE INDEX IF NOT EXISTS idx_part_moves_asset ON spare_part_movements(asset_id);
`;

// src/main/crypto.ts
var import_node_crypto = require("node:crypto");
var PREFIX = "scrypt$";
function hashPassword(password) {
  const salt = (0, import_node_crypto.randomBytes)(16);
  const hash = (0, import_node_crypto.scryptSync)(password, salt, 64);
  return `${PREFIX}${salt.toString("hex")}$${hash.toString("hex")}`;
}
function verifyPassword(password, stored) {
  if (!stored) return false;
  if (stored.startsWith(PREFIX)) {
    const [, saltHex, hashHex] = stored.split("$");
    if (!saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, "hex");
    const actual = (0, import_node_crypto.scryptSync)(password, Buffer.from(saltHex, "hex"), expected.length);
    return expected.length === actual.length && (0, import_node_crypto.timingSafeEqual)(expected, actual);
  }
  return stored === password;
}

// src/main/db/migrations.ts
var MYSQL_DDL = `
CREATE TABLE IF NOT EXISTS settings (
  \`key\`  VARCHAR(191) NOT NULL PRIMARY KEY,
  value MEDIUMTEXT
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
  plant_id   INT,
  plant_ref_id INT
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
  share_token VARCHAR(64),
  plant_ref_id INT
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
  purchase_mode     VARCHAR(16) NOT NULL DEFAULT 'purchase',
  product_name      VARCHAR(255) NOT NULL DEFAULT '',
  outsource_id      INT,
  from_plant_id     INT,
  linked_dispatch_id INT,
  quantity          DOUBLE NOT NULL,
  rate              DOUBLE,
  amount            DOUBLE,
  paid_amount       DOUBLE NOT NULL DEFAULT 0,
  payment_status    VARCHAR(32) NOT NULL DEFAULT 'unpaid',
  date              VARCHAR(32) NOT NULL,
  remarks           TEXT,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS purchase_transporters (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  purchase_id    INT NOT NULL,
  transporter_id INT NOT NULL,
  vehicle_no     VARCHAR(64) NOT NULL DEFAULT '',
  basis          VARCHAR(8) NOT NULL DEFAULT 'flat',
  qty            DOUBLE NOT NULL DEFAULT 0,
  rate           DOUBLE NOT NULL DEFAULT 0,
  charge         DOUBLE NOT NULL DEFAULT 0,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS purchase_machines (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  purchase_id  INT NOT NULL,
  asset_id     INT NOT NULL,
  basis        VARCHAR(8) NOT NULL DEFAULT 'hour',
  qty          DOUBLE NOT NULL DEFAULT 0,
  rate         DOUBLE NOT NULL DEFAULT 0,
  amount       DOUBLE NOT NULL DEFAULT 0,
  outsource_id INT,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dispatch_transporters (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  dispatch_id    INT NOT NULL,
  transporter_id INT NOT NULL,
  vehicle_no     VARCHAR(64) NOT NULL DEFAULT '',
  basis          VARCHAR(8) NOT NULL DEFAULT 'flat',
  qty            DOUBLE NOT NULL DEFAULT 0,
  rate           DOUBLE NOT NULL DEFAULT 0,
  charge         DOUBLE NOT NULL DEFAULT 0,
  bill_customer  INT NOT NULL DEFAULT 0,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dispatch_machines (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  dispatch_id  INT NOT NULL,
  asset_id     INT NOT NULL,
  basis        VARCHAR(8) NOT NULL DEFAULT 'hour',
  qty          DOUBLE NOT NULL DEFAULT 0,
  rate         DOUBLE NOT NULL DEFAULT 0,
  amount       DOUBLE NOT NULL DEFAULT 0,
  outsource_id INT,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS rack_sale_transporters (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  rack_sale_id   INT NOT NULL,
  transporter_id INT,
  rack_vehicle_id INT,
  vehicle_no     VARCHAR(64) NOT NULL DEFAULT '',
  basis          VARCHAR(8) NOT NULL DEFAULT 'flat',
  qty            DOUBLE NOT NULL DEFAULT 0,
  rate           DOUBLE NOT NULL DEFAULT 0,
  charge         DOUBLE NOT NULL DEFAULT 0,
  diesel_litres  DOUBLE,
  diesel_amount  DOUBLE,
  diesel_charged INT NOT NULL DEFAULT 0,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS rack_sale_machines (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  rack_sale_id INT NOT NULL,
  asset_id     INT NOT NULL,
  basis        VARCHAR(8) NOT NULL DEFAULT 'hour',
  qty          DOUBLE NOT NULL DEFAULT 0,
  rate         DOUBLE NOT NULL DEFAULT 0,
  amount       DOUBLE NOT NULL DEFAULT 0,
  outsource_id INT,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  uom               VARCHAR(8) NOT NULL DEFAULT 'CM',
  quantity          DOUBLE NOT NULL DEFAULT 0,
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
  plant_id       INT NOT NULL,
  product_name   VARCHAR(191) NOT NULL,
  opening_qty    DOUBLE NOT NULL DEFAULT 0,
  opening_rate   DOUBLE NOT NULL DEFAULT 0,
  opening_amount DOUBLE NOT NULL DEFAULT 0,
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
  to_plant_id      INT,
  linked_purchase_id INT,
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
  diesel_charged INT NOT NULL DEFAULT 0,
  rack_vehicle_id INT,
  rack_jcb_id    INT,
  work_type      VARCHAR(16),
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
  meter_type  VARCHAR(8) NOT NULL DEFAULT 'hour',
  standard_consumption DOUBLE,
  status      VARCHAR(32) NOT NULL DEFAULT 'active',
  remarks     TEXT,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS machine_logs (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  asset_id      INT NOT NULL,
  date          VARCHAR(32) NOT NULL,
  work_type     VARCHAR(64) NOT NULL DEFAULT '',
  opening_meter DOUBLE NOT NULL DEFAULT 0,
  closing_meter DOUBLE NOT NULL DEFAULT 0,
  usage_qty     DOUBLE NOT NULL DEFAULT 0,
  fuel_litres   DOUBLE,
  rate          DOUBLE,
  amount        DOUBLE,
  remarks       TEXT,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS asset_documents (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  asset_id    INT NOT NULL,
  doc_type    VARCHAR(32) NOT NULL DEFAULT 'other',
  number      VARCHAR(128) NOT NULL DEFAULT '',
  issue_date  VARCHAR(32),
  expiry_date VARCHAR(32),
  file_data   MEDIUMTEXT,
  remarks     TEXT,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS asset_plants (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  asset_id  INT NOT NULL,
  plant_id  INT NOT NULL
);
CREATE TABLE IF NOT EXISTS asset_plant_moves (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  asset_id      INT NOT NULL,
  from_plant_id INT,
  to_plant_id   INT,
  date          VARCHAR(32) NOT NULL,
  remarks       TEXT,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
`;
var MYSQL_MIGRATIONS = [
  { id: "001_initial_schema", sql: MYSQL_DDL },
  {
    // Per-module edit access. Existing edit-level users get edit on all their modules.
    id: "002_user_edit_modules",
    sql: `ALTER TABLE users ADD COLUMN edit_modules TEXT;
UPDATE users SET edit_modules = modules WHERE access_level = 'edit'`
  },
  {
    // Multi-UOM purchases. Existing rows were in m³, so qty_cm mirrors quantity.
    id: "003_purchase_uom",
    sql: `ALTER TABLE purchases ADD COLUMN uom VARCHAR(8) NOT NULL DEFAULT 'CM';
ALTER TABLE purchases ADD COLUMN qty_cm DOUBLE NOT NULL DEFAULT 0;
UPDATE purchases SET qty_cm = quantity WHERE qty_cm = 0`
  },
  {
    // Per-plant UOM/density factors, Products master, per-customer rate lists,
    // and a public share token on customers (for the no-login rate page).
    id: "004_products_rates_density",
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
    id: "005_purchase_finished_goods",
    sql: `ALTER TABLE purchases ADD COLUMN material_type VARCHAR(16) NOT NULL DEFAULT 'raw';
ALTER TABLE purchases ADD COLUMN product_name VARCHAR(255) NOT NULL DEFAULT ''`
  },
  {
    // Direct sale: actual quantity (existing 'quantity') vs sale quantity. The
    // bill uses sale_quantity when set, otherwise the actual quantity.
    id: "006_dispatch_sale_quantity",
    sql: `ALTER TABLE dispatches ADD COLUMN sale_quantity DOUBLE`
  },
  {
    // Tag a sale / purchase with the outsource vendor it came from (shows the head).
    id: "007_outsource_on_sale_purchase",
    sql: `ALTER TABLE dispatches ADD COLUMN outsource_id INT;
ALTER TABLE purchases ADD COLUMN outsource_id INT`
  },
  {
    // Per-account opening balances (financial-year carry-forward is computed).
    id: "008_opening_balances",
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
    id: "009_rate_chart_transport",
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
    id: "010_dispatch_status_and_budgets",
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
    id: "011_dispatch_transporter",
    sql: `ALTER TABLE dispatches ADD COLUMN transporter_id INT`
  },
  {
    // Mining mode + multi-transporter / multi-machine lines on a purchase.
    id: "012_purchase_mining_lines",
    sql: `ALTER TABLE purchases ADD COLUMN purchase_mode VARCHAR(16) NOT NULL DEFAULT 'purchase';
CREATE TABLE IF NOT EXISTS purchase_transporters (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  purchase_id    INT NOT NULL,
  transporter_id INT NOT NULL,
  vehicle_no     VARCHAR(64) NOT NULL DEFAULT '',
  charge         DOUBLE NOT NULL DEFAULT 0,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS purchase_machines (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  purchase_id  INT NOT NULL,
  asset_id     INT NOT NULL,
  basis        VARCHAR(8) NOT NULL DEFAULT 'hour',
  qty          DOUBLE NOT NULL DEFAULT 0,
  rate         DOUBLE NOT NULL DEFAULT 0,
  amount       DOUBLE NOT NULL DEFAULT 0,
  outsource_id INT,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_ptrans_purchase ON purchase_transporters(purchase_id);
CREATE INDEX idx_ptrans_transporter ON purchase_transporters(transporter_id);
CREATE INDEX idx_pmach_purchase ON purchase_machines(purchase_id)`
  },
  {
    // Purchase transport lines can be priced flat, per trip, or per UOM unit.
    id: "013_purchase_transport_basis",
    sql: `ALTER TABLE purchase_transporters ADD COLUMN basis VARCHAR(8) NOT NULL DEFAULT 'flat';
ALTER TABLE purchase_transporters ADD COLUMN qty DOUBLE NOT NULL DEFAULT 0;
ALTER TABLE purchase_transporters ADD COLUMN rate DOUBLE NOT NULL DEFAULT 0`
  },
  {
    // Direct-sale transporter + machine cost lines, and inter-plant sale ↔ purchase linkage.
    id: "014_dispatch_lines_interplant",
    sql: `CREATE TABLE IF NOT EXISTS dispatch_transporters (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  dispatch_id    INT NOT NULL,
  transporter_id INT NOT NULL,
  vehicle_no     VARCHAR(64) NOT NULL DEFAULT '',
  basis          VARCHAR(8) NOT NULL DEFAULT 'flat',
  qty            DOUBLE NOT NULL DEFAULT 0,
  rate           DOUBLE NOT NULL DEFAULT 0,
  charge         DOUBLE NOT NULL DEFAULT 0,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS dispatch_machines (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  dispatch_id  INT NOT NULL,
  asset_id     INT NOT NULL,
  basis        VARCHAR(8) NOT NULL DEFAULT 'hour',
  qty          DOUBLE NOT NULL DEFAULT 0,
  rate         DOUBLE NOT NULL DEFAULT 0,
  amount       DOUBLE NOT NULL DEFAULT 0,
  outsource_id INT,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE dispatches ADD COLUMN to_plant_id INT;
ALTER TABLE dispatches ADD COLUMN linked_purchase_id INT;
ALTER TABLE purchases ADD COLUMN from_plant_id INT;
ALTER TABLE purchases ADD COLUMN linked_dispatch_id INT;
ALTER TABLE suppliers ADD COLUMN plant_ref_id INT;
ALTER TABLE customers ADD COLUMN plant_ref_id INT;
CREATE INDEX idx_dtrans_dispatch ON dispatch_transporters(dispatch_id);
CREATE INDEX idx_dtrans_transporter ON dispatch_transporters(transporter_id);
CREATE INDEX idx_dmach_dispatch ON dispatch_machines(dispatch_id)`
  },
  {
    // Transporter + machine cost lines on railway rack sales.
    id: "015_rack_sale_lines",
    sql: `CREATE TABLE IF NOT EXISTS rack_sale_transporters (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  rack_sale_id   INT NOT NULL,
  transporter_id INT NOT NULL,
  vehicle_no     VARCHAR(64) NOT NULL DEFAULT '',
  basis          VARCHAR(8) NOT NULL DEFAULT 'flat',
  qty            DOUBLE NOT NULL DEFAULT 0,
  rate           DOUBLE NOT NULL DEFAULT 0,
  charge         DOUBLE NOT NULL DEFAULT 0,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS rack_sale_machines (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  rack_sale_id INT NOT NULL,
  asset_id     INT NOT NULL,
  basis        VARCHAR(8) NOT NULL DEFAULT 'hour',
  qty          DOUBLE NOT NULL DEFAULT 0,
  rate         DOUBLE NOT NULL DEFAULT 0,
  amount       DOUBLE NOT NULL DEFAULT 0,
  outsource_id INT,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_rstrans_sale ON rack_sale_transporters(rack_sale_id);
CREATE INDEX idx_rstrans_transporter ON rack_sale_transporters(transporter_id);
CREATE INDEX idx_rsmach_sale ON rack_sale_machines(rack_sale_id)`
  },
  {
    // Logo is stored as a data URL in settings — widen the value column to hold it.
    id: "016_settings_value_mediumtext",
    sql: "ALTER TABLE settings MODIFY value MEDIUMTEXT"
  },
  {
    // Multi-plant assets, plant-move log, and logbook rate→income.
    id: "018_machines_multiplant_lograte",
    sql: `ALTER TABLE machine_logs ADD COLUMN rate DOUBLE;
ALTER TABLE machine_logs ADD COLUMN amount DOUBLE;
CREATE TABLE IF NOT EXISTS asset_plants (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  asset_id  INT NOT NULL,
  plant_id  INT NOT NULL
);
CREATE TABLE IF NOT EXISTS asset_plant_moves (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  asset_id      INT NOT NULL,
  from_plant_id INT,
  to_plant_id   INT,
  date          VARCHAR(32) NOT NULL,
  remarks       TEXT,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_aplants_asset ON asset_plants(asset_id);
CREATE INDEX idx_aplants_plant ON asset_plants(plant_id);
CREATE INDEX idx_amoves_asset ON asset_plant_moves(asset_id)`
  },
  {
    // Machine logbook, balance-sheet inputs and document/insurance tracking.
    id: "017_machinery_logs_documents",
    sql: `ALTER TABLE assets ADD COLUMN meter_type VARCHAR(8) NOT NULL DEFAULT 'hour';
ALTER TABLE assets ADD COLUMN standard_consumption DOUBLE;
CREATE TABLE IF NOT EXISTS machine_logs (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  asset_id      INT NOT NULL,
  date          VARCHAR(32) NOT NULL,
  work_type     VARCHAR(64) NOT NULL DEFAULT '',
  opening_meter DOUBLE NOT NULL DEFAULT 0,
  closing_meter DOUBLE NOT NULL DEFAULT 0,
  usage_qty     DOUBLE NOT NULL DEFAULT 0,
  fuel_litres   DOUBLE,
  remarks       TEXT,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS asset_documents (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  asset_id    INT NOT NULL,
  doc_type    VARCHAR(32) NOT NULL DEFAULT 'other',
  number      VARCHAR(128) NOT NULL DEFAULT '',
  issue_date  VARCHAR(32),
  expiry_date VARCHAR(32),
  file_data   MEDIUMTEXT,
  remarks     TEXT,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_mlog_asset ON machine_logs(asset_id);
CREATE INDEX idx_adoc_asset ON asset_documents(asset_id);
CREATE INDEX idx_adoc_expiry ON asset_documents(expiry_date)`
  },
  {
    // Standalone spare-parts inventory under Machines & Vehicles.
    id: "019_spare_parts_stock",
    sql: `CREATE TABLE IF NOT EXISTS spare_parts (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  part_type  VARCHAR(32) NOT NULL DEFAULT 'new',
  unit       VARCHAR(32) NOT NULL DEFAULT 'PCS',
  plant_id   INT,
  min_qty    DOUBLE NOT NULL DEFAULT 0,
  remarks    TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS spare_part_movements (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  part_id       INT NOT NULL,
  asset_id      INT,
  movement_type VARCHAR(32) NOT NULL,
  ref_no        VARCHAR(191) NOT NULL DEFAULT '',
  quantity      DOUBLE NOT NULL,
  date          VARCHAR(32) NOT NULL,
  note          TEXT,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_spare_parts_plant ON spare_parts(plant_id);
CREATE INDEX idx_part_moves_part ON spare_part_movements(part_id);
CREATE INDEX idx_part_moves_asset ON spare_part_movements(asset_id)`
  },
  {
    // Preserve the entered UOM while raw_qty remains normalized to cubic metres.
    id: "020_production_uom",
    sql: `ALTER TABLE productions ADD COLUMN uom VARCHAR(8) NOT NULL DEFAULT 'CM';
ALTER TABLE productions ADD COLUMN quantity DOUBLE NOT NULL DEFAULT 0;
UPDATE productions SET quantity = raw_qty WHERE quantity = 0`
  },
  {
    // Spare parts gain a part number + rate; stock movements record a rate/value;
    // diesel issues can be charged to a transporter.
    id: "021_parts_rate_diesel_transporter",
    sql: `ALTER TABLE spare_parts ADD COLUMN part_no VARCHAR(191) NOT NULL DEFAULT '';
ALTER TABLE spare_parts ADD COLUMN rate DOUBLE;
ALTER TABLE spare_part_movements ADD COLUMN rate DOUBLE;
ALTER TABLE spare_part_movements ADD COLUMN amount DOUBLE;
ALTER TABLE diesel_issues ADD COLUMN transporter_id INT;
ALTER TABLE diesel_issues ADD COLUMN rate DOUBLE;
ALTER TABLE diesel_issues ADD COLUMN amount DOUBLE`
  },
  {
    // Outsource sale: a buy rate so the vendor's payable + the live profit can be derived.
    id: "022_dispatch_buy_rate",
    sql: `ALTER TABLE dispatches ADD COLUMN buy_rate DOUBLE`
  },
  {
    // Multi-plant customers / suppliers / transporters (junction tables).
    id: "023_party_plants",
    sql: `CREATE TABLE IF NOT EXISTS customer_plants (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  plant_id    INT NOT NULL
);
CREATE TABLE IF NOT EXISTS supplier_plants (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT NOT NULL,
  plant_id    INT NOT NULL
);
CREATE TABLE IF NOT EXISTS transporter_plants (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  transporter_id INT NOT NULL,
  plant_id       INT NOT NULL
);
CREATE INDEX idx_cplants_customer ON customer_plants(customer_id);
CREATE INDEX idx_splants_supplier ON supplier_plants(supplier_id);
CREATE INDEX idx_tplants_transporter ON transporter_plants(transporter_id)`
  },
  {
    // Source plant on a railway rack (default plant for its loadings).
    id: "024_rack_plant",
    sql: `ALTER TABLE racks ADD COLUMN plant_id INT`
  },
  {
    // FIFO diesel: a "charged to transporter" flag on every diesel issuance.
    id: "025_diesel_charged",
    sql: `ALTER TABLE diesel_issues ADD COLUMN charged INT NOT NULL DEFAULT 0;
ALTER TABLE rack_loadings ADD COLUMN diesel_charged INT NOT NULL DEFAULT 0;
ALTER TABLE rack_unloadings ADD COLUMN diesel_charged INT NOT NULL DEFAULT 0`
  },
  {
    // Multi-plant companies (junction table).
    id: "026_company_plants",
    sql: `CREATE TABLE IF NOT EXISTS company_plants (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  plant_id   INT NOT NULL
);
CREATE INDEX idx_coplants_company ON company_plants(company_id)`
  },
  {
    // Per-plant opening balances (a plant tag on each opening row).
    id: "027_opening_plant",
    sql: `ALTER TABLE opening_balances ADD COLUMN plant_id INT`
  },
  {
    // Challan no on purchases and rack sales (type or auto-generate).
    id: "028_challan_no",
    sql: `ALTER TABLE purchases ADD COLUMN challan_no VARCHAR(191) NOT NULL DEFAULT '';
ALTER TABLE rack_sales ADD COLUMN challan_no VARCHAR(191) NOT NULL DEFAULT ''`
  },
  {
    // Rack fleet: hired vehicles + JCB loaders, assignable to multiple plants.
    id: "029_rack_fleet",
    sql: `CREATE TABLE IF NOT EXISTS rack_vehicles (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  vehicle_no    VARCHAR(191) NOT NULL,
  owner_name    VARCHAR(191) NOT NULL DEFAULT '',
  owner_mobile  VARCHAR(64) NOT NULL DEFAULT '',
  driver_name   VARCHAR(191) NOT NULL DEFAULT '',
  driver_mobile VARCHAR(64) NOT NULL DEFAULT '',
  cap_cm        DOUBLE,
  cap_ton       DOUBLE,
  cap_cft       DOUBLE,
  rate_per_trip DOUBLE,
  remarks       TEXT,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS rack_jcbs (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(191) NOT NULL,
  owner_name     VARCHAR(191) NOT NULL DEFAULT '',
  owner_mobile   VARCHAR(64) NOT NULL DEFAULT '',
  driver_name    VARCHAR(191) NOT NULL DEFAULT '',
  driver_mobile  VARCHAR(64) NOT NULL DEFAULT '',
  rate_unloading DOUBLE,
  rate_loading   DOUBLE,
  rate_other     DOUBLE,
  remarks        TEXT,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS rack_vehicle_plants (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  rack_vehicle_id INT NOT NULL,
  plant_id        INT NOT NULL
);
CREATE TABLE IF NOT EXISTS rack_jcb_plants (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  rack_jcb_id INT NOT NULL,
  plant_id    INT NOT NULL
);
CREATE INDEX idx_rvplants_vehicle ON rack_vehicle_plants(rack_vehicle_id);
CREATE INDEX idx_rjplants_jcb ON rack_jcb_plants(rack_jcb_id)`
  },
  {
    // Unloadings bind to a fleet vehicle/JCB (their own ledger heads); sale transport
    // can use a fleet vehicle and carry diesel charged to the carrier.
    id: "030_rack_unload_carrier",
    sql: `ALTER TABLE rack_unloadings ADD COLUMN rack_vehicle_id INT;
ALTER TABLE rack_unloadings ADD COLUMN rack_jcb_id INT;
ALTER TABLE rack_unloadings ADD COLUMN work_type VARCHAR(16);
ALTER TABLE rack_sale_transporters ADD COLUMN rack_vehicle_id INT;
ALTER TABLE rack_sale_transporters ADD COLUMN diesel_litres DOUBLE;
ALTER TABLE rack_sale_transporters ADD COLUMN diesel_amount DOUBLE;
ALTER TABLE rack_sale_transporters ADD COLUMN diesel_charged INT NOT NULL DEFAULT 0;
ALTER TABLE rack_sale_transporters MODIFY transporter_id INT NULL;
CREATE INDEX idx_runload_vehicle ON rack_unloadings(rack_vehicle_id);
CREATE INDEX idx_runload_jcb ON rack_unloadings(rack_jcb_id);
CREATE INDEX idx_rstrans_vehicle ON rack_sale_transporters(rack_vehicle_id)`
  },
  {
    // Direct-sale transporter lines can be billed through to the customer (pass-through transport).
    id: "031_dispatch_transporter_bill_customer",
    sql: `ALTER TABLE dispatch_transporters ADD COLUMN bill_customer INT NOT NULL DEFAULT 0`
  },
  {
    // Multi-plant products: assign each product to one or more plants (empty = common to all).
    id: "032_product_plants",
    sql: `CREATE TABLE IF NOT EXISTS product_plants (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  plant_id   INT NOT NULL
);
CREATE INDEX idx_pplants_product ON product_plants(product_id)`
  },
  {
    // Opening finished-goods stock can be valued: a per-m³ rate and the total amount.
    id: "033_finished_opening_value",
    sql: `ALTER TABLE finished_goods_opening ADD COLUMN opening_rate DOUBLE NOT NULL DEFAULT 0;
ALTER TABLE finished_goods_opening ADD COLUMN opening_amount DOUBLE NOT NULL DEFAULT 0`
  },
  {
    // Per-transporter fleet: the vehicles and JCBs a transporter owns/operates,
    // with capacity in all UOMs and per-trip / per-unit rates.
    id: "034_transporter_fleet",
    sql: `CREATE TABLE IF NOT EXISTS transporter_fleet (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  transporter_id INT NOT NULL,
  kind           VARCHAR(16) NOT NULL DEFAULT 'vehicle',
  name           VARCHAR(191) NOT NULL DEFAULT '',
  driver_name    VARCHAR(191) NOT NULL DEFAULT '',
  driver_mobile  VARCHAR(64) NOT NULL DEFAULT '',
  cap_cm         DOUBLE,
  cap_ton        DOUBLE,
  cap_cft        DOUBLE,
  rate_per_trip  DOUBLE,
  rate_per_unit  DOUBLE,
  rate_unit_uom  VARCHAR(8) NOT NULL DEFAULT 'CM',
  remarks        TEXT,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_tfleet_transporter ON transporter_fleet(transporter_id)`
  }
];
async function sqliteLegacyMigrate(adapter2) {
  const addColumn = async (table, col, def) => {
    const cols = (await adapter2.exec(`PRAGMA table_info(${table})`, void 0, null)).rows;
    if (!cols.some((c) => c.name === col)) {
      await adapter2.execRaw(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    }
  };
  for (const table of ["suppliers", "customers", "transporters"]) {
    await addColumn(table, "company_id", "INTEGER");
    await addColumn(table, "plant_id", "INTEGER");
  }
  await addColumn("dispatches", "uom", `TEXT NOT NULL DEFAULT 'CM'`);
  await addColumn("dispatches", "qty_cm", "REAL NOT NULL DEFAULT 0");
  await addColumn("dispatches", "transport_charge", "REAL NOT NULL DEFAULT 0");
  await addColumn("dispatches", "transport_billed", "INTEGER NOT NULL DEFAULT 0");
  await addColumn("dispatches", "other_charge", "REAL NOT NULL DEFAULT 0");
  await addColumn("dispatches", "other_billed", "INTEGER NOT NULL DEFAULT 0");
  await addColumn("dispatches", "vehicle_type", `TEXT NOT NULL DEFAULT 'own'`);
  await addColumn("dispatches", "challan_no", `TEXT NOT NULL DEFAULT ''`);
  await addColumn("dispatches", "payment_status", `TEXT NOT NULL DEFAULT 'unpaid'`);
  await addColumn("dispatches", "paid_amount", "REAL NOT NULL DEFAULT 0");
  await adapter2.execRaw(`UPDATE dispatches SET qty_cm = quantity WHERE qty_cm = 0 AND quantity <> 0`);
  await addColumn("dispatches", "outsourced", "INTEGER NOT NULL DEFAULT 0");
  await addColumn("dispatches", "dispatch_status", `TEXT NOT NULL DEFAULT 'pending'`);
  await addColumn("dispatches", "transporter_id", "INTEGER");
  await addColumn("rack_loadings", "outsourced", "INTEGER NOT NULL DEFAULT 0");
  await addColumn("rack_sales", "truck_no", `TEXT NOT NULL DEFAULT ''`);
  await addColumn("rack_unloadings", "transporter_id", "INTEGER");
  await addColumn("rack_unloadings", "vehicle_no", `TEXT NOT NULL DEFAULT ''`);
  await addColumn("rack_unloadings", "trips", "REAL NOT NULL DEFAULT 0");
  await addColumn("rack_unloadings", "per_trip_cm", "REAL NOT NULL DEFAULT 0");
  await addColumn("rack_unloadings", "total_cm", "REAL NOT NULL DEFAULT 0");
  await addColumn("rack_unloadings", "rate", "REAL");
  await addColumn("rack_unloadings", "amount", "REAL");
  await addColumn("rack_unloadings", "diesel_litres", "REAL");
  await addColumn("rack_unloadings", "diesel_amount", "REAL");
  await adapter2.execRaw(`UPDATE rack_unloadings SET total_cm = qty_cm WHERE total_cm = 0 AND qty_cm <> 0`);
  await addColumn("assets", "business_id", "INTEGER");
  await addColumn("wage_entries", "asset_id", "INTEGER");
  await addColumn("plant_expenses", "outsource_id", "INTEGER");
  await addColumn("sessions", "user_id", "INTEGER");
  await addColumn("users", "edit_modules", `TEXT NOT NULL DEFAULT '[]'`);
  await adapter2.execRaw(`UPDATE users SET edit_modules = modules WHERE access_level = 'edit' AND (edit_modules IS NULL OR edit_modules = '' OR edit_modules = '[]')`);
  await addColumn("purchases", "uom", `TEXT NOT NULL DEFAULT 'CM'`);
  await addColumn("purchases", "qty_cm", "REAL NOT NULL DEFAULT 0");
  await adapter2.execRaw(`UPDATE purchases SET qty_cm = quantity WHERE qty_cm = 0 AND quantity <> 0`);
  await addColumn("plants", "ton_per_cm", "REAL NOT NULL DEFAULT 1.6");
  await addColumn("plants", "cft_per_cm", "REAL NOT NULL DEFAULT 35.31");
  await addColumn("customers", "share_token", "TEXT");
  await addColumn("purchases", "material_type", `TEXT NOT NULL DEFAULT 'raw'`);
  await addColumn("purchases", "product_name", `TEXT NOT NULL DEFAULT ''`);
  await addColumn("dispatches", "sale_quantity", "REAL");
  await addColumn("dispatches", "outsource_id", "INTEGER");
  await addColumn("purchases", "outsource_id", "INTEGER");
  await addColumn("purchases", "purchase_mode", `TEXT NOT NULL DEFAULT 'purchase'`);
  await addColumn("purchase_transporters", "basis", `TEXT NOT NULL DEFAULT 'flat'`);
  await addColumn("purchase_transporters", "qty", "REAL NOT NULL DEFAULT 0");
  await addColumn("purchase_transporters", "rate", "REAL NOT NULL DEFAULT 0");
  await addColumn("dispatches", "to_plant_id", "INTEGER");
  await addColumn("dispatches", "linked_purchase_id", "INTEGER");
  await addColumn("purchases", "from_plant_id", "INTEGER");
  await addColumn("purchases", "linked_dispatch_id", "INTEGER");
  await addColumn("suppliers", "plant_ref_id", "INTEGER");
  await addColumn("customers", "plant_ref_id", "INTEGER");
  await addColumn("assets", "meter_type", `TEXT NOT NULL DEFAULT 'hour'`);
  await addColumn("assets", "standard_consumption", "REAL");
  await addColumn("machine_logs", "rate", "REAL");
  await addColumn("machine_logs", "amount", "REAL");
  await addColumn("productions", "uom", `TEXT NOT NULL DEFAULT 'CM'`);
  await addColumn("productions", "quantity", "REAL NOT NULL DEFAULT 0");
  await adapter2.execRaw(`UPDATE productions SET quantity = raw_qty WHERE quantity = 0`);
  await addColumn("spare_parts", "part_no", `TEXT NOT NULL DEFAULT ''`);
  await addColumn("spare_parts", "rate", "REAL");
  await addColumn("spare_part_movements", "rate", "REAL");
  await addColumn("spare_part_movements", "amount", "REAL");
  await addColumn("diesel_issues", "transporter_id", "INTEGER");
  await addColumn("diesel_issues", "rate", "REAL");
  await addColumn("diesel_issues", "amount", "REAL");
  await addColumn("dispatches", "buy_rate", "REAL");
  await addColumn("racks", "plant_id", "INTEGER");
  await addColumn("opening_balances", "plant_id", "INTEGER");
  await addColumn("diesel_issues", "charged", "INTEGER NOT NULL DEFAULT 0");
  await addColumn("rack_loadings", "diesel_charged", "INTEGER NOT NULL DEFAULT 0");
  await addColumn("rack_unloadings", "diesel_charged", "INTEGER NOT NULL DEFAULT 0");
  await addColumn("purchases", "challan_no", `TEXT NOT NULL DEFAULT ''`);
  await addColumn("rack_sales", "challan_no", `TEXT NOT NULL DEFAULT ''`);
  await addColumn("rack_unloadings", "rack_vehicle_id", "INTEGER");
  await addColumn("rack_unloadings", "rack_jcb_id", "INTEGER");
  await addColumn("rack_unloadings", "work_type", "TEXT");
  await addColumn("rack_sale_transporters", "rack_vehicle_id", "INTEGER");
  await addColumn("rack_sale_transporters", "diesel_litres", "REAL");
  await addColumn("rack_sale_transporters", "diesel_amount", "REAL");
  await addColumn("rack_sale_transporters", "diesel_charged", "INTEGER NOT NULL DEFAULT 0");
  await addColumn("dispatch_transporters", "bill_customer", "INTEGER NOT NULL DEFAULT 0");
  await addColumn("finished_goods_opening", "opening_rate", "REAL NOT NULL DEFAULT 0");
  await addColumn("finished_goods_opening", "opening_amount", "REAL NOT NULL DEFAULT 0");
}
async function importProductsFromSettings(adapter2) {
  const all = (await adapter2.exec(`SELECT id, name FROM products ORDER BY id`, void 0, null)).rows;
  const keep = /* @__PURE__ */ new Map();
  for (const p of all) {
    const key = (p.name || "").trim().toLowerCase();
    if (!key) continue;
    if (!keep.has(key)) keep.set(key, p.id);
    else await adapter2.exec(`DELETE FROM products WHERE id = ?`, [p.id], null);
  }
  const names = (await adapter2.exec(
    `SELECT DISTINCT product_name FROM production_settings`,
    void 0,
    null
  )).rows;
  for (const r of names) {
    const name = (r.product_name || "").trim();
    if (!name) continue;
    if (keep.has(name.toLowerCase())) continue;
    await adapter2.exec(
      `INSERT INTO products (plant_id, name, description, status) VALUES (0, ?, '', 'active')`,
      [name],
      null
    );
    keep.set(name.toLowerCase(), 0);
  }
}
async function uppercaseExistingNames(adapter2, kind) {
  const flag = "names_upper_v1";
  const done = (await adapter2.exec("SELECT value FROM settings WHERE `key` = ?", [flag], null)).rows;
  if (done.length > 0) return;
  const cols = [
    ["companies", "name"],
    ["suppliers", "name"],
    ["customers", "name"],
    ["transporters", "name"],
    ["plants", "name"],
    ["plants", "code"],
    ["businesses", "name"],
    ["outsource", "name"],
    ["outsource", "head"],
    ["products", "name"],
    ["stock_locations", "name"],
    ["employees", "name"],
    ["employees", "designation"],
    ["assets", "name"],
    ["plant_expenses", "title"],
    ["production_settings", "product_name"],
    ["production_outputs", "product_name"],
    ["stock_movements", "product_name"],
    ["dispatches", "product_name"],
    ["purchases", "product_name"],
    ["rack_loadings", "product_name"],
    ["rack_unloadings", "product_name"],
    ["rack_sales", "product_name"],
    ["finished_goods_opening", "product_name"],
    ["customer_rates", "product_name"],
    ["rate_chart", "product_name"],
    ["transport_charges", "vehicle_type"]
  ];
  for (const [t, c] of cols) {
    try {
      await adapter2.exec(`UPDATE ${t} SET ${c} = UPPER(${c})`, void 0, null);
    } catch {
    }
  }
  const ins = kind === "mysql" ? "INSERT INTO settings (`key`, value) VALUES (?, '1') ON DUPLICATE KEY UPDATE value = '1'" : "INSERT INTO settings (`key`, value) VALUES (?, '1') ON CONFLICT(`key`) DO UPDATE SET value = '1'";
  await adapter2.exec(ins, [flag], null);
}
async function backfillAssetPlants(adapter2, kind) {
  const flag = "asset_plants_backfill_v1";
  const done = (await adapter2.exec("SELECT value FROM settings WHERE `key` = ?", [flag], null)).rows;
  if (done.length > 0) return;
  try {
    await adapter2.exec(
      `INSERT INTO asset_plants (asset_id, plant_id)
       SELECT a.id, a.plant_id FROM assets a
       WHERE a.plant_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM asset_plants ap WHERE ap.asset_id = a.id)`,
      void 0,
      null
    );
  } catch {
  }
  const ins = kind === "mysql" ? "INSERT INTO settings (`key`, value) VALUES (?, '1') ON DUPLICATE KEY UPDATE value = '1'" : "INSERT INTO settings (`key`, value) VALUES (?, '1') ON CONFLICT(`key`) DO UPDATE SET value = '1'";
  await adapter2.exec(ins, [flag], null);
}
async function backfillPartyPlants(adapter2, kind) {
  const flag = "party_plants_backfill_v1";
  const done = (await adapter2.exec("SELECT value FROM settings WHERE `key` = ?", [flag], null)).rows;
  if (done.length > 0) return;
  const maps = [
    { junction: "customer_plants", col: "customer_id", src: "customers" },
    { junction: "supplier_plants", col: "supplier_id", src: "suppliers" },
    { junction: "transporter_plants", col: "transporter_id", src: "transporters" }
  ];
  for (const m of maps) {
    try {
      await adapter2.exec(
        `INSERT INTO ${m.junction} (${m.col}, plant_id)
         SELECT s.id, s.plant_id FROM ${m.src} s
         WHERE s.plant_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM ${m.junction} jp WHERE jp.${m.col} = s.id)`,
        void 0,
        null
      );
    } catch {
    }
  }
  const ins = kind === "mysql" ? "INSERT INTO settings (`key`, value) VALUES (?, '1') ON DUPLICATE KEY UPDATE value = '1'" : "INSERT INTO settings (`key`, value) VALUES (?, '1') ON CONFLICT(`key`) DO UPDATE SET value = '1'";
  await adapter2.exec(ins, [flag], null);
}
async function seedDefaults(adapter2) {
  const pwRow = (await adapter2.exec("SELECT value FROM settings WHERE `key` = 'admin_password'", void 0, null)).rows[0];
  if (!pwRow) {
    await adapter2.exec("INSERT INTO settings (`key`, value) VALUES ('admin_password', ?)", ["admin123"], null);
  }
  const cnt = (await adapter2.exec("SELECT COUNT(*) AS n FROM users", void 0, null)).rows[0];
  if (Number(cnt.n) === 0) {
    const stored = (await adapter2.exec("SELECT value FROM settings WHERE `key` = 'admin_password'", void 0, null)).rows[0]?.value || "admin123";
    const hash = stored.startsWith("scrypt$") ? stored : hashPassword(stored);
    await adapter2.exec(
      `INSERT INTO users (username, name, password_hash, role, access_level, modules, active)
       VALUES ('admin', 'Administrator', ?, 'admin', 'edit', '[]', 1)`,
      [hash],
      null
    );
  }
}
async function runMigrations(adapter2, kind) {
  if (kind === "sqlite") {
    await adapter2.execRaw(SCHEMA);
    await sqliteLegacyMigrate(adapter2);
  } else {
    await adapter2.execRaw(
      `CREATE TABLE IF NOT EXISTS schema_migrations (id VARCHAR(191) NOT NULL PRIMARY KEY, applied_at VARCHAR(32))`
    );
    for (const m of MYSQL_MIGRATIONS) {
      const done = (await adapter2.exec("SELECT id FROM schema_migrations WHERE id = ?", [m.id], null)).rows;
      if (done.length > 0) continue;
      const statements = m.sql.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
      for (const stmt of statements) {
        try {
          await adapter2.exec(stmt, void 0, null);
        } catch (e) {
          const msg = String(e?.message || "");
          if (/duplicate column|already exists|duplicate key name|check that column/i.test(msg)) continue;
          throw e;
        }
      }
      await adapter2.exec("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)", [
        m.id,
        (/* @__PURE__ */ new Date()).toISOString()
      ], null);
    }
  }
  await seedDefaults(adapter2);
  await importProductsFromSettings(adapter2);
  await uppercaseExistingNames(adapter2, kind);
  await backfillAssetPlants(adapter2, kind);
  await backfillPartyPlants(adapter2, kind);
}

// src/main/db/index.ts
var KIND = process.env.DB_HOST || process.env.DB_NAME || process.env.DB_CLIENT === "mysql" ? "mysql" : "sqlite";
var adapter = null;
var initPromise = null;
var txStore = new import_node_async_hooks.AsyncLocalStorage();
function sqliteFile() {
  const dir = process.env.BL_DB_DIR || app.getPath("userData");
  if (!(0, import_node_fs.existsSync)(dir)) (0, import_node_fs.mkdirSync)(dir, { recursive: true });
  return (0, import_node_path.join)(dir, "blcrusher.db");
}
async function doInit() {
  adapter = KIND === "mysql" ? createMysqlAdapter() : createSqliteAdapter(sqliteFile());
  await adapter.init();
  await runMigrations(adapter, KIND);
}
function ensureInit() {
  if (!initPromise) initPromise = doInit();
  return initPromise;
}
function initDb() {
  return ensureInit();
}
function dbKind() {
  return KIND;
}
async function exec(sql, params) {
  await ensureInit();
  const conn = txStore.getStore() ?? null;
  return adapter.exec(sql, params, conn);
}
function normalizeArgs(args) {
  if (args.length === 0) return void 0;
  if (args.length === 1 && args[0] && typeof args[0] === "object" && !Array.isArray(args[0])) {
    return args[0];
  }
  return args;
}
var wrapper = {
  async get(sql, params) {
    return (await exec(sql, params)).rows[0];
  },
  async all(sql, params) {
    return (await exec(sql, params)).rows;
  },
  async run(sql, params) {
    return (await exec(sql, params)).runResult;
  },
  prepare(sql) {
    return {
      get: (...p) => wrapper.get(sql, normalizeArgs(p)),
      all: (...p) => wrapper.all(sql, normalizeArgs(p)),
      run: (...p) => wrapper.run(sql, normalizeArgs(p))
    };
  },
  async transaction(fn) {
    await ensureInit();
    if (txStore.getStore()) return fn();
    const conn = await adapter.beginTx();
    try {
      const result = await txStore.run(conn, fn);
      await adapter.commitTx(conn);
      return result;
    } catch (e) {
      try {
        await adapter.rollbackTx(conn);
      } catch {
      }
      throw e;
    } finally {
      adapter.releaseTx(conn);
    }
  }
};
function getDb() {
  return wrapper;
}
async function nextNumber(prefix, counter) {
  const d = getDb();
  const upsert = KIND === "mysql" ? `INSERT INTO counters (name, current) VALUES (?, 0) ON DUPLICATE KEY UPDATE current = current` : `INSERT INTO counters (name, current) VALUES (?, 0) ON CONFLICT(name) DO NOTHING`;
  return d.transaction(async () => {
    await d.run(upsert, [counter]);
    await d.run(`UPDATE counters SET current = current + 1 WHERE name = ?`, [counter]);
    const row = await d.get(`SELECT current FROM counters WHERE name = ?`, [counter]);
    return `${prefix}-${String(row.current).padStart(6, "0")}`;
  });
}

// src/main/context.ts
var import_node_async_hooks2 = require("node:async_hooks");
var store = new import_node_async_hooks2.AsyncLocalStorage();
function runWithUser(user, fn) {
  return store.run(user, fn);
}
function getCurrentUser() {
  return store.getStore() ?? null;
}

// src/shared/types.ts
var TON_PER_CM = 1.6;
var CFT_PER_CM = 35.31;
function tonFactor(f) {
  const v = Number(f?.ton_per_cm);
  return v > 0 ? v : TON_PER_CM;
}
function cftFactor(f) {
  const v = Number(f?.cft_per_cm);
  return v > 0 ? v : CFT_PER_CM;
}
function toCm(qty, uom, f) {
  if (uom === "TON") return qty / tonFactor(f);
  if (uom === "CFT") return qty / cftFactor(f);
  return qty;
}
function properCase(s) {
  if (!s) return "";
  return s.trim().replace(/\s+/g, " ").toUpperCase();
}
function derivePaymentStatus(total, paid) {
  const t = Math.round((Number(total) + Number.EPSILON) * 100) / 100;
  const p = Math.round((Number(paid) + Number.EPSILON) * 100) / 100;
  if (p <= 0) return "unpaid";
  if (p >= t - 0.01) return "paid";
  return "partial";
}

// src/shared/permissions.ts
var MODULES = [
  { key: "dashboard", label: "Dashboard" },
  { key: "purchases", label: "Purchases / Inward" },
  { key: "production", label: "Production" },
  { key: "racks", label: "Railway Racks" },
  { key: "dispatch", label: "Direct Sale & Delivery" },
  { key: "movements", label: "Stock Movements" },
  { key: "plantExpenses", label: "Plant Expenses" },
  { key: "diesel", label: "Diesel" },
  { key: "payroll", label: "Payroll & Employees" },
  { key: "ledgers", label: "Ledgers" },
  { key: "payments", label: "Payment Status" },
  { key: "reports", label: "Reports" },
  { key: "masters", label: "Masters (Plants, Parties, Machinery\u2026)" },
  { key: "settings", label: "Settings", adminOnly: true },
  { key: "users", label: "Users & Activity Log", adminOnly: true }
];
var PUBLIC_METHODS = /* @__PURE__ */ new Set(["auth.login", "auth.me", "auth.logout"]);
var SELF_METHODS = /* @__PURE__ */ new Set(["auth.changePassword"]);
var PREFIX_MODULE = {
  plants: "masters",
  locations: "masters",
  suppliers: "masters",
  customers: "masters",
  products: "masters",
  rates: "masters",
  rateChart: "masters",
  transportCharges: "masters",
  transporters: "masters",
  companies: "masters",
  businesses: "masters",
  outsource: "masters",
  assets: "masters",
  machinery: "masters",
  parts: "masters",
  rackVehicles: "racks",
  rackJcbs: "racks",
  purchases: "purchases",
  productionSettings: "production",
  productions: "production",
  finished: "production",
  dispatches: "dispatch",
  movements: "movements",
  racks: "racks",
  ledgers: "ledgers",
  payments: "payments",
  plantExpenses: "plantExpenses",
  budget: "plantExpenses",
  diesel: "diesel",
  employees: "payroll",
  wages: "payroll",
  dashboard: "dashboard",
  users: "users",
  activity: "users"
};
var METHOD_MODULE = {
  "system.requestDelete": "settings",
  "system.cancelDelete": "settings",
  "system.deleteStatus": "settings",
  "system.setWorkdays": "settings",
  "rates.getBusinessName": "settings",
  "rates.setBusinessName": "settings",
  "system.getWorkdays": "payroll",
  // read by the Payroll page
  "racks.createExpenseType": "settings",
  "racks.deleteExpenseType": "settings"
};
function moduleForMethod(method) {
  if (METHOD_MODULE[method]) return METHOD_MODULE[method];
  const prefix = method.split(".")[0];
  return PREFIX_MODULE[prefix] ?? null;
}
var WRITE_VERBS = [
  "create",
  "update",
  "delete",
  "save",
  "set",
  "add",
  "transfer",
  "stock",
  "wipe",
  "remove",
  "request",
  "cancel",
  "bulk"
];
var WRITE_METHODS = /* @__PURE__ */ new Set(["assets.move"]);
function isWriteMethod(method) {
  if (WRITE_METHODS.has(method)) return true;
  const action = method.split(".")[1] ?? "";
  return WRITE_VERBS.some((v) => action === v || action.startsWith(v));
}
function moduleDef(key) {
  return MODULES.find((m) => m.key === key);
}
function canViewModule(user, key) {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (moduleDef(key)?.adminOnly) return false;
  return user.modules.includes(key);
}
function canEditModule(user, key) {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (moduleDef(key)?.adminOnly) return false;
  return Array.isArray(user.edit_modules) && user.edit_modules.includes(key);
}
function can(user, method) {
  if (!user) return false;
  if (PUBLIC_METHODS.has(method) || SELF_METHODS.has(method)) return true;
  if (user.role === "admin") return true;
  const mod = moduleForMethod(method);
  if (!mod) return false;
  return isWriteMethod(method) ? canEditModule(user, mod) : canViewModule(user, mod);
}
var STAFF_MODULES = MODULES.filter((m) => !m.adminOnly);
var ALL_STAFF = STAFF_MODULES.map((m) => m.key);

// src/main/services/users.ts
var VALID_MODULES = new Set(STAFF_MODULES.map((m) => m.key));
function parseModuleList(raw) {
  try {
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr.filter((m) => VALID_MODULES.has(m)) : [];
  } catch {
    return [];
  }
}
function toUser(row) {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    access_level: row.access_level,
    modules: parseModuleList(row.modules),
    edit_modules: parseModuleList(row.edit_modules),
    active: row.active,
    created_at: row.created_at
  };
}
function sanitizeModules(modules) {
  if (!Array.isArray(modules)) return [];
  return modules.filter((m) => typeof m === "string" && VALID_MODULES.has(m));
}
function buildAccess(role, modules, editModules) {
  if (role === "admin") return { modules: [], editModules: [], accessLevel: "edit" };
  const edit = sanitizeModules(editModules);
  const view = Array.from(/* @__PURE__ */ new Set([...sanitizeModules(modules), ...edit]));
  return { modules: view, editModules: edit, accessLevel: edit.length ? "edit" : "view" };
}
async function activeAdminCount(excludeId) {
  const d = getDb();
  const row = await d.prepare(
    `SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?`
  ).get(excludeId ?? -1);
  return row.n;
}
async function listUsers() {
  const d = getDb();
  const rows = await d.prepare(`SELECT * FROM users ORDER BY (role = 'admin') DESC, username ASC`).all();
  return rows.map(toUser);
}
async function getUserById(id) {
  const d = getDb();
  const row = await d.prepare(`SELECT * FROM users WHERE id = ? AND active = 1`).get(id);
  return row ? toUser(row) : null;
}
async function authenticate(username, password) {
  const d = getDb();
  const uname = (username || "").trim().toLowerCase();
  if (!uname) return null;
  const row = await d.prepare(`SELECT * FROM users WHERE username = ? AND active = 1`).get(uname);
  if (!row || !verifyPassword(password, row.password_hash)) return null;
  return toUser(row);
}
async function createUser(p) {
  const d = getDb();
  const username = (p.username || "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,}$/.test(username)) {
    throw new Error("Username must be at least 3 characters (letters, numbers, . _ - only).");
  }
  if (!p.password || p.password.length < 4) {
    throw new Error("Password must be at least 4 characters.");
  }
  const exists = await d.prepare(`SELECT id FROM users WHERE username = ?`).get(username);
  if (exists) throw new Error("That username is already taken.");
  const role = p.role === "admin" ? "admin" : "staff";
  const access = buildAccess(role, p.modules, p.edit_modules ?? []);
  const info = await d.prepare(
    `INSERT INTO users (username, name, password_hash, role, access_level, modules, edit_modules, active)
       VALUES (@username,@name,@password_hash,@role,@access_level,@modules,@edit_modules,@active)`
  ).run({
    username,
    name: properCase(p.name) || username,
    password_hash: hashPassword(p.password),
    role,
    access_level: access.accessLevel,
    modules: JSON.stringify(access.modules),
    edit_modules: JSON.stringify(access.editModules),
    active: p.active === false ? 0 : 1
  });
  return toUser(await d.prepare(`SELECT * FROM users WHERE id = ?`).get(Number(info.lastInsertRowid)));
}
async function updateUser(p) {
  const d = getDb();
  if (!p.id) throw new Error("Missing user id.");
  const old = await d.prepare(`SELECT * FROM users WHERE id = ?`).get(p.id);
  if (!old) throw new Error("User not found.");
  const username = (p.username || "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,}$/.test(username)) {
    throw new Error("Username must be at least 3 characters (letters, numbers, . _ - only).");
  }
  const clash = await d.prepare(`SELECT id FROM users WHERE username = ? AND id <> ?`).get(username, p.id);
  if (clash) throw new Error("That username is already taken.");
  const role = p.role === "admin" ? "admin" : "staff";
  const active = p.active === false ? 0 : 1;
  const wasActiveAdmin = old.role === "admin" && old.active === 1;
  const stillActiveAdmin = role === "admin" && active === 1;
  if (wasActiveAdmin && !stillActiveAdmin && await activeAdminCount(p.id) === 0) {
    throw new Error("This is the last active admin \u2014 keep at least one admin account.");
  }
  const access = buildAccess(role, p.modules, p.edit_modules ?? []);
  const passwordHash = p.password && p.password.length > 0 ? hashPassword(p.password) : old.password_hash;
  if (p.password && p.password.length > 0 && p.password.length < 4) {
    throw new Error("Password must be at least 4 characters.");
  }
  await d.prepare(
    `UPDATE users SET username=@username, name=@name, password_hash=@password_hash,
       role=@role, access_level=@access_level, modules=@modules, edit_modules=@edit_modules, active=@active WHERE id=@id`
  ).run({
    id: p.id,
    username,
    name: properCase(p.name) || username,
    password_hash: passwordHash,
    role,
    access_level: access.accessLevel,
    modules: JSON.stringify(access.modules),
    edit_modules: JSON.stringify(access.editModules),
    active
  });
  return toUser(await d.prepare(`SELECT * FROM users WHERE id = ?`).get(p.id));
}
async function deleteUser(payload) {
  const d = getDb();
  const me = getCurrentUser();
  if (me && me.id === payload.id) return { ok: false, error: "You cannot delete your own account." };
  const row = await d.prepare(`SELECT * FROM users WHERE id = ?`).get(payload.id);
  if (!row) return { ok: false, error: "User not found." };
  if (row.role === "admin" && row.active === 1 && await activeAdminCount(payload.id) === 0) {
    return { ok: false, error: "This is the last active admin \u2014 cannot delete it." };
  }
  await d.prepare(`DELETE FROM users WHERE id = ?`).run(payload.id);
  return { ok: true };
}
async function changeOwnPassword(payload) {
  const d = getDb();
  const me = getCurrentUser();
  if (!me) return { ok: false, error: "Not signed in." };
  const row = await d.prepare(`SELECT * FROM users WHERE id = ?`).get(me.id);
  if (!row || !verifyPassword(payload.current, row.password_hash)) {
    return { ok: false, error: "Current password is incorrect." };
  }
  if (!payload.next || payload.next.length < 4) {
    return { ok: false, error: "New password must be at least 4 characters." };
  }
  await d.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hashPassword(payload.next), me.id);
  return { ok: true };
}

// src/main/services/auth.ts
async function login(payload) {
  const user = await authenticate(payload.username || "admin", payload.password);
  return user ? { ok: true, user } : { ok: false };
}
async function changePassword(payload) {
  return changeOwnPassword(payload);
}

// src/main/services/movements.ts
async function addMovement(d, m) {
  await d.prepare(
    `INSERT INTO stock_movements
       (type, material_type, ref_no, plant_id, stock_location_id, product_name, change_qty, date, note)
     VALUES (@type, @material_type, @ref_no, @plant_id, @stock_location_id, @product_name, @change_qty, @date, @note)`
  ).run({
    type: m.type,
    material_type: m.material_type,
    ref_no: m.ref_no ?? "",
    plant_id: m.plant_id,
    stock_location_id: m.stock_location_id ?? null,
    product_name: m.product_name ?? null,
    change_qty: m.change_qty,
    date: m.date,
    note: m.note ?? ""
  });
}
async function rawLocationBalance(d, locationId) {
  const r = await d.prepare(
    `SELECT COALESCE(SUM(change_qty),0) AS q FROM stock_movements
       WHERE material_type='raw' AND stock_location_id = ?`
  ).get(locationId);
  return round(r.q);
}
async function finishedBalance(d, plantId, productName) {
  const r = await d.prepare(
    `SELECT COALESCE(SUM(change_qty),0) AS q FROM stock_movements
       WHERE material_type='finished' AND plant_id = ? AND product_name = ?`
  ).get(plantId, productName);
  return round(r.q);
}
async function setLocationOpening(d, locationId, plantId, qty, date) {
  const existing = await d.prepare(
    `SELECT id FROM stock_movements
       WHERE type='opening' AND material_type='raw' AND stock_location_id = ?`
  ).get(locationId);
  if (qty > 0) {
    if (existing) {
      await d.prepare(`UPDATE stock_movements SET change_qty = ?, plant_id = ?, date = ? WHERE id = ?`).run(
        qty,
        plantId,
        date,
        existing.id
      );
    } else {
      await addMovement(d, {
        type: "opening",
        material_type: "raw",
        plant_id: plantId,
        stock_location_id: locationId,
        change_qty: qty,
        date,
        note: "Opening stock"
      });
    }
  } else if (existing) {
    await d.prepare(`DELETE FROM stock_movements WHERE id = ?`).run(existing.id);
  }
}
async function setFinishedOpening(d, plantId, productName, qty, date) {
  const existing = await d.prepare(
    `SELECT id FROM stock_movements
       WHERE type='opening' AND material_type='finished' AND plant_id = ? AND product_name = ?`
  ).get(plantId, productName);
  if (qty > 0) {
    if (existing) {
      await d.prepare(`UPDATE stock_movements SET change_qty = ?, date = ? WHERE id = ?`).run(
        qty,
        date,
        existing.id
      );
    } else {
      await addMovement(d, {
        type: "opening",
        material_type: "finished",
        plant_id: plantId,
        product_name: productName,
        change_qty: qty,
        date,
        note: "Opening finished goods"
      });
    }
  } else if (existing) {
    await d.prepare(`DELETE FROM stock_movements WHERE id = ?`).run(existing.id);
  }
}
function round(n) {
  return Math.round((n + Number.EPSILON) * 1e3) / 1e3;
}
async function listMovements(filter = {}) {
  const d = getDb();
  const where = [];
  const params = {};
  if (filter.plant_id) {
    where.push("m.plant_id = @plant_id");
    params.plant_id = filter.plant_id;
  }
  if (filter.stock_location_id) {
    where.push("m.stock_location_id = @stock_location_id");
    params.stock_location_id = filter.stock_location_id;
  }
  if (filter.product_name) {
    where.push("m.product_name = @product_name");
    params.product_name = filter.product_name;
  }
  if (filter.material_type) {
    where.push("m.material_type = @material_type");
    params.material_type = filter.material_type;
  }
  if (filter.type) {
    where.push("m.type = @type");
    params.type = filter.type;
  }
  if (filter.from) {
    where.push("m.date >= @from");
    params.from = filter.from;
  }
  if (filter.to) {
    where.push("m.date <= @to");
    params.to = filter.to;
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return await d.prepare(
    `SELECT m.*, p.name AS plant_name, l.name AS stock_location_name
       FROM stock_movements m
       LEFT JOIN plants p ON p.id = m.plant_id
       LEFT JOIN stock_locations l ON l.id = m.stock_location_id
       ${clause}
       ORDER BY m.date DESC, m.id DESC`
  ).all(params);
}
async function transferStock(p) {
  const d = getDb();
  if (!p.from_location_id || !p.to_location_id) throw new Error("Select both locations.");
  if (p.from_location_id === p.to_location_id)
    throw new Error("Source and destination must be different locations.");
  if (!(Number(p.quantity) > 0)) throw new Error("Quantity must be greater than 0.");
  const loc = async (id) => await d.prepare(`SELECT id, name, plant_id FROM stock_locations WHERE id = ?`).get(id);
  const from = await loc(p.from_location_id);
  const to = await loc(p.to_location_id);
  if (!from || !to) throw new Error("Location not found.");
  const qty = round(Number(p.quantity));
  const available = await rawLocationBalance(d, from.id);
  if (qty > available)
    throw new Error(`Not enough stock at ${from.name}. Available: ${available} m\xB3, requested: ${qty} m\xB3.`);
  await d.transaction(async () => {
    const ref = await nextNumber("TRF", "transfer");
    await addMovement(d, {
      type: "transfer",
      material_type: "raw",
      ref_no: ref,
      plant_id: from.plant_id,
      stock_location_id: from.id,
      change_qty: -qty,
      date: p.date,
      note: p.note?.trim() || `Transfer to ${to.name}`
    });
    await addMovement(d, {
      type: "transfer",
      material_type: "raw",
      ref_no: ref,
      plant_id: to.plant_id,
      stock_location_id: to.id,
      change_qty: qty,
      date: p.date,
      note: p.note?.trim() || `Transfer from ${from.name}`
    });
    if (await rawLocationBalance(d, from.id) < 0) throw new Error("Stock cannot go negative.");
  });
  return { ok: true };
}
async function deleteTransfer(payload) {
  const d = getDb();
  const legs = await d.prepare(`SELECT DISTINCT stock_location_id FROM stock_movements WHERE ref_no = ? AND type = 'transfer'`).all(payload.ref_no);
  try {
    await d.transaction(async () => {
      await d.prepare(`DELETE FROM stock_movements WHERE ref_no = ? AND type = 'transfer'`).run(payload.ref_no);
      for (const l of legs) {
        if (l.stock_location_id != null && await rawLocationBalance(d, l.stock_location_id) < 0)
          throw new Error("Cannot delete: stock from this transfer has already been used at the destination.");
      }
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// src/main/services/names.ts
async function ensureUniqueName(table, name, opts = {}) {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return;
  const conds = ["UPPER(name) = UPPER(?)"];
  const params = [trimmed];
  if (opts.id) {
    conds.push("id <> ?");
    params.push(opts.id);
  }
  if (opts.scopeColumn) {
    if (opts.scopeValue == null) {
      conds.push(`${opts.scopeColumn} IS NULL`);
    } else if (typeof opts.scopeValue === "string") {
      conds.push(`UPPER(${opts.scopeColumn}) = UPPER(?)`);
      params.push(opts.scopeValue);
    } else {
      conds.push(`${opts.scopeColumn} = ?`);
      params.push(opts.scopeValue);
    }
  }
  const row = await getDb().prepare(`SELECT id FROM ${table} WHERE ${conds.join(" AND ")} LIMIT 1`).get(...params);
  if (row) throw new Error(`${opts.label ?? "A record"} named "${trimmed}" already exists.`);
}

// src/main/services/stockLocations.ts
function today() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
async function listStockLocations(payload = {}) {
  const d = getDb();
  const where = payload.plant_id ? "WHERE l.plant_id = @plant_id" : "";
  const rows = await d.prepare(
    `SELECT l.*, p.name AS plant_name FROM stock_locations l
       JOIN plants p ON p.id = l.plant_id ${where} ORDER BY p.name, l.name`
  ).all(payload);
  for (const r of rows) {
    const purchased = await d.prepare(
      `SELECT COALESCE(SUM(change_qty),0) AS q FROM stock_movements
         WHERE stock_location_id = ? AND type='purchase'`
    ).get(r.id);
    const consumed = await d.prepare(
      `SELECT COALESCE(SUM(-change_qty),0) AS q FROM stock_movements
         WHERE stock_location_id = ? AND type='production_consume'`
    ).get(r.id);
    r.purchased_qty = round2(purchased.q);
    r.consumed_qty = round2(consumed.q);
    r.balance_qty = await rawLocationBalance(d, r.id);
  }
  return rows;
}
async function createStockLocation(p) {
  const d = getDb();
  await ensureUniqueName("stock_locations", p.name, { scopeColumn: "plant_id", scopeValue: p.plant_id, label: "A location in this plant" });
  const id = await d.transaction(async () => {
    const info = await d.prepare(
      `INSERT INTO stock_locations (plant_id, name, opening_qty, remarks) VALUES (?, ?, ?, ?)`
    ).run(p.plant_id, properCase(p.name), p.opening_qty || 0, p.remarks ?? "");
    const id2 = Number(info.lastInsertRowid);
    await setLocationOpening(d, id2, p.plant_id, p.opening_qty || 0, today());
    return id2;
  });
  return await d.prepare(`SELECT * FROM stock_locations WHERE id = ?`).get(id);
}
async function ensureDefaultLocation(plantId) {
  const d = getDb();
  const existing = await d.prepare(`SELECT id FROM stock_locations WHERE plant_id = ? ORDER BY id LIMIT 1`).get(plantId);
  if (existing) return existing.id;
  const plant = await d.prepare(`SELECT name FROM plants WHERE id = ?`).get(plantId);
  const info = await d.prepare(`INSERT INTO stock_locations (plant_id, name, opening_qty, remarks) VALUES (?, ?, 0, ?)`).run(plantId, plant?.name ?? "Main", "Default location");
  return Number(info.lastInsertRowid);
}
async function updateStockLocation(p) {
  const d = getDb();
  await ensureUniqueName("stock_locations", p.name, { id: p.id, scopeColumn: "plant_id", scopeValue: p.plant_id, label: "A location in this plant" });
  await d.transaction(async () => {
    await d.prepare(`UPDATE stock_locations SET name=?, opening_qty=?, remarks=? WHERE id=?`).run(
      properCase(p.name),
      p.opening_qty || 0,
      p.remarks ?? "",
      p.id
    );
    await setLocationOpening(d, p.id, p.plant_id, p.opening_qty || 0, today());
  });
  return await d.prepare(`SELECT * FROM stock_locations WHERE id = ?`).get(p.id);
}
async function deleteStockLocation(payload) {
  const d = getDb();
  const used = await d.prepare(
    `SELECT COUNT(*) AS c FROM stock_movements
       WHERE stock_location_id = ? AND type <> 'opening'`
  ).get(payload.id);
  if (used.c > 0) {
    return { ok: false, error: "Cannot delete: this location has purchase/production movements." };
  }
  await d.prepare(`DELETE FROM stock_movements WHERE stock_location_id = ?`).run(payload.id);
  await d.prepare(`DELETE FROM stock_locations WHERE id = ?`).run(payload.id);
  return { ok: true };
}
function round2(n) {
  return Math.round((n + Number.EPSILON) * 1e3) / 1e3;
}

// src/main/services/plants.ts
async function listPlants() {
  return await getDb().prepare(`SELECT * FROM plants ORDER BY name`).all();
}
function posOr(value, fallback) {
  const n = Number(value);
  return n > 0 ? n : fallback;
}
async function createPlant(p) {
  const d = getDb();
  await ensureUniqueName("plants", p.name, { label: "A plant" });
  const info = await d.prepare(
    `INSERT INTO plants (name, code, location, status, ton_per_cm, cft_per_cm) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    p.name.trim().toUpperCase(),
    p.code.trim().toUpperCase(),
    properCase(p.location),
    p.status ?? "active",
    posOr(p.ton_per_cm, TON_PER_CM),
    posOr(p.cft_per_cm, CFT_PER_CM)
  );
  const plantId = Number(info.lastInsertRowid);
  await ensureDefaultLocation(plantId);
  return await d.prepare(`SELECT * FROM plants WHERE id = ?`).get(plantId);
}
async function updatePlant(p) {
  const d = getDb();
  await ensureUniqueName("plants", p.name, { id: p.id, label: "A plant" });
  await d.prepare(
    `UPDATE plants SET name=?, code=?, location=?, status=?,
         ton_per_cm=COALESCE(?, ton_per_cm), cft_per_cm=COALESCE(?, cft_per_cm) WHERE id=?`
  ).run(
    p.name.trim().toUpperCase(),
    p.code.trim().toUpperCase(),
    properCase(p.location),
    p.status ?? "active",
    p.ton_per_cm != null && Number(p.ton_per_cm) > 0 ? Number(p.ton_per_cm) : null,
    p.cft_per_cm != null && Number(p.cft_per_cm) > 0 ? Number(p.cft_per_cm) : null,
    p.id
  );
  return await d.prepare(`SELECT * FROM plants WHERE id = ?`).get(p.id);
}
async function plantUomFactors(plantId) {
  if (!plantId) return { ton_per_cm: TON_PER_CM, cft_per_cm: CFT_PER_CM };
  const row = await getDb().prepare(`SELECT ton_per_cm, cft_per_cm FROM plants WHERE id = ?`).get(plantId);
  return {
    ton_per_cm: posOr(row?.ton_per_cm, TON_PER_CM),
    cft_per_cm: posOr(row?.cft_per_cm, CFT_PER_CM)
  };
}
async function deletePlant(payload) {
  const d = getDb();
  const used = await d.prepare(`SELECT COUNT(*) AS c FROM stock_movements WHERE plant_id = ?`).get(payload.id);
  if (used.c > 0) {
    return { ok: false, error: "Cannot delete: this plant has stock movements / transactions." };
  }
  await d.transaction(async () => {
    await d.prepare(`DELETE FROM production_settings WHERE plant_id = ?`).run(payload.id);
    await d.prepare(`DELETE FROM stock_locations WHERE plant_id = ?`).run(payload.id);
    for (const t of ["customer_plants", "supplier_plants", "transporter_plants", "company_plants", "asset_plants", "rack_vehicle_plants", "rack_jcb_plants"]) {
      await d.prepare(`DELETE FROM ${t} WHERE plant_id = ?`).run(payload.id);
    }
    await d.prepare(`DELETE FROM plants WHERE id = ?`).run(payload.id);
  });
  return { ok: true };
}

// src/main/services/partyPlants.ts
var PARTY_PLANT_TABLE = {
  customer: { junction: "customer_plants", col: "customer_id" },
  supplier: { junction: "supplier_plants", col: "supplier_id" },
  transporter: { junction: "transporter_plants", col: "transporter_id" },
  company: { junction: "company_plants", col: "company_id" },
  rack_vehicle: { junction: "rack_vehicle_plants", col: "rack_vehicle_id" },
  rack_jcb: { junction: "rack_jcb_plants", col: "rack_jcb_id" },
  product: { junction: "product_plants", col: "product_id" }
};
function plantIdSet(p) {
  if (Array.isArray(p.plant_ids)) return [...new Set(p.plant_ids.map(Number).filter((n) => n > 0))];
  return p.plant_id ? [Number(p.plant_id)] : [];
}
async function writePartyPlants(d, partyType, partyId, plantIds) {
  const m = PARTY_PLANT_TABLE[partyType];
  if (!m) return;
  await d.prepare(`DELETE FROM ${m.junction} WHERE ${m.col} = ?`).run(partyId);
  const stmt = d.prepare(`INSERT INTO ${m.junction} (${m.col}, plant_id) VALUES (?, ?)`);
  for (const pid of plantIds) await stmt.run(partyId, pid);
}
async function attachPartyPlants(d, partyType, rows) {
  const m = PARTY_PLANT_TABLE[partyType];
  if (!m || rows.length === 0) return rows;
  const jrows = await d.prepare(
    `SELECT jp.${m.col} AS party_id, jp.plant_id, p.name AS plant_name
       FROM ${m.junction} jp JOIN plants p ON p.id = jp.plant_id ORDER BY p.name`
  ).all();
  const by = /* @__PURE__ */ new Map();
  for (const r of jrows) {
    const e = by.get(r.party_id) ?? { ids: [], names: [] };
    e.ids.push(r.plant_id);
    e.names.push(r.plant_name);
    by.set(r.party_id, e);
  }
  for (const row of rows) {
    const e = by.get(row.id);
    row.plant_ids = e?.ids ?? [];
    row.plant_names = e?.names ?? [];
  }
  return rows;
}
function plantScopeSql(alias, partyType, plantParam = "@plant_id") {
  const m = PARTY_PLANT_TABLE[partyType];
  if (!m) return "1=1";
  return `(EXISTS (SELECT 1 FROM ${m.junction} jp WHERE jp.${m.col} = ${alias}.id AND jp.plant_id = ${plantParam})
    OR NOT EXISTS (SELECT 1 FROM ${m.junction} jp2 WHERE jp2.${m.col} = ${alias}.id))`;
}

// src/main/services/suppliers.ts
async function listSuppliers(payload = {}) {
  const d = getDb();
  const clause = payload.plant_id ? `WHERE ${plantScopeSql("s", "supplier")}` : "";
  const rows = await d.prepare(
    `SELECT s.*, co.name AS company_name, pl.name AS plant_name
       FROM suppliers s
       LEFT JOIN companies co ON co.id = s.company_id
       LEFT JOIN plants pl ON pl.id = s.plant_id
       ${clause}
       ORDER BY s.name`
  ).all(payload);
  await attachPartyPlants(d, "supplier", rows);
  for (const s of rows) {
    const agg = await d.prepare(
      `SELECT
           COALESCE(SUM(quantity),0) AS qty,
           COALESCE(SUM(amount),0) AS amt,
           COALESCE(SUM(paid_amount),0) AS paid
         FROM purchases WHERE supplier_id = ?`
    ).get(s.id);
    s.total_purchased = round3(agg.qty);
    s.total_amount = round3(agg.amt);
    s.paid_amount = round3(agg.paid);
    s.unpaid_amount = round3(agg.amt - agg.paid);
  }
  return rows;
}
async function createSupplier(p) {
  const d = getDb();
  await ensureUniqueName("suppliers", p.name, { label: "A supplier" });
  const plants = plantIdSet(p);
  const id = await d.transaction(async () => {
    const info = await d.prepare(
      `INSERT INTO suppliers (name, contact, address, remarks, company_id, plant_id) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      properCase(p.name),
      p.contact ?? "",
      p.address ?? "",
      p.remarks ?? "",
      p.company_id ?? null,
      plants[0] ?? null
    );
    const sid = Number(info.lastInsertRowid);
    await writePartyPlants(d, "supplier", sid, plants);
    return sid;
  });
  const row = await d.prepare(`SELECT * FROM suppliers WHERE id = ?`).get(id);
  await attachPartyPlants(d, "supplier", [row]);
  return row;
}
async function updateSupplier(p) {
  const d = getDb();
  await ensureUniqueName("suppliers", p.name, { id: p.id, label: "A supplier" });
  const plants = plantIdSet(p);
  await d.transaction(async () => {
    await d.prepare(
      `UPDATE suppliers SET name=?, contact=?, address=?, remarks=?, company_id=?, plant_id=? WHERE id=?`
    ).run(
      properCase(p.name),
      p.contact ?? "",
      p.address ?? "",
      p.remarks ?? "",
      p.company_id ?? null,
      plants[0] ?? null,
      p.id
    );
    await writePartyPlants(d, "supplier", p.id, plants);
  });
  const row = await d.prepare(`SELECT * FROM suppliers WHERE id = ?`).get(p.id);
  await attachPartyPlants(d, "supplier", [row]);
  return row;
}
async function deleteSupplier(payload) {
  const d = getDb();
  const used = await d.prepare(`SELECT COUNT(*) AS c FROM purchases WHERE supplier_id = ?`).get(payload.id);
  if (used.c > 0) {
    return { ok: false, error: "Cannot delete: this supplier has purchase records." };
  }
  const dieselUsed = await d.prepare(`SELECT COUNT(*) AS c FROM diesel_purchases WHERE supplier_id = ?`).get(payload.id);
  if (dieselUsed.c > 0) {
    return { ok: false, error: "Cannot delete: this supplier has diesel purchase records." };
  }
  const paid = await d.prepare(`SELECT COUNT(*) AS c FROM payments WHERE party_type = ? AND party_id = ?`).get("supplier", payload.id);
  if (paid.c > 0) {
    return { ok: false, error: "Cannot delete: this supplier has payment records." };
  }
  await d.transaction(async () => {
    await d.prepare(`DELETE FROM opening_balances WHERE party_type = ? AND party_id = ?`).run("supplier", payload.id);
    await d.prepare(`DELETE FROM supplier_plants WHERE supplier_id = ?`).run(payload.id);
    await d.prepare(`DELETE FROM suppliers WHERE id = ?`).run(payload.id);
  });
  return { ok: true };
}
function round3(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// src/main/services/customers.ts
async function listCustomers(payload = {}) {
  const d = getDb();
  const clause = payload.plant_id ? `WHERE ${plantScopeSql("c", "customer")}` : "";
  const rows = await d.prepare(
    `SELECT c.*, co.name AS company_name, pl.name AS plant_name
       FROM customers c
       LEFT JOIN companies co ON co.id = c.company_id
       LEFT JOIN plants pl ON pl.id = c.plant_id
       ${clause}
       ORDER BY c.name`
  ).all(payload);
  await attachPartyPlants(d, "customer", rows);
  for (const c of rows) {
    const agg = await d.prepare(
      `SELECT COALESCE(SUM(quantity),0) AS qty FROM dispatches WHERE customer_id = @id`
    ).get({ id: c.id });
    const rackAgg = await d.prepare(`SELECT COALESCE(SUM(qty_cm),0) AS qty FROM rack_sales WHERE customer_id = @id`).get({ id: c.id });
    c.total_dispatched = Math.round((agg.qty + rackAgg.qty + Number.EPSILON) * 1e3) / 1e3;
  }
  return rows;
}
async function createCustomer(p) {
  const d = getDb();
  await ensureUniqueName("customers", p.name, { label: "A customer" });
  const plants = plantIdSet(p);
  const id = await d.transaction(async () => {
    const info = await d.prepare(
      `INSERT INTO customers (name, contact, address, remarks, company_id, plant_id) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      properCase(p.name),
      p.contact ?? "",
      p.address ?? "",
      p.remarks ?? "",
      p.company_id ?? null,
      plants[0] ?? null
    );
    const cid = Number(info.lastInsertRowid);
    await writePartyPlants(d, "customer", cid, plants);
    return cid;
  });
  const row = await d.prepare(`SELECT * FROM customers WHERE id = ?`).get(id);
  await attachPartyPlants(d, "customer", [row]);
  return row;
}
async function updateCustomer(p) {
  const d = getDb();
  await ensureUniqueName("customers", p.name, { id: p.id, label: "A customer" });
  const plants = plantIdSet(p);
  await d.transaction(async () => {
    await d.prepare(
      `UPDATE customers SET name=?, contact=?, address=?, remarks=?, company_id=?, plant_id=? WHERE id=?`
    ).run(
      properCase(p.name),
      p.contact ?? "",
      p.address ?? "",
      p.remarks ?? "",
      p.company_id ?? null,
      plants[0] ?? null,
      p.id
    );
    await writePartyPlants(d, "customer", p.id, plants);
  });
  const row = await d.prepare(`SELECT * FROM customers WHERE id = ?`).get(p.id);
  await attachPartyPlants(d, "customer", [row]);
  return row;
}
async function deleteCustomer(payload) {
  const d = getDb();
  const used = await d.prepare(`SELECT COUNT(*) AS c FROM dispatches WHERE customer_id = ?`).get(payload.id);
  const rackUsed = await d.prepare(`SELECT COUNT(*) AS c FROM rack_sales WHERE customer_id = ?`).get(payload.id);
  if (used.c > 0 || rackUsed.c > 0) {
    return { ok: false, error: "Cannot delete: this customer has sales/dispatch records." };
  }
  const paid = await d.prepare(`SELECT COUNT(*) AS c FROM payments WHERE party_type = ? AND party_id = ?`).get("customer", payload.id);
  if (paid.c > 0) {
    return { ok: false, error: "Cannot delete: this customer has payment records." };
  }
  await d.transaction(async () => {
    await d.prepare(`DELETE FROM customer_rates WHERE customer_id = ?`).run(payload.id);
    await d.prepare(`DELETE FROM opening_balances WHERE party_type = ? AND party_id = ?`).run("customer", payload.id);
    await d.prepare(`DELETE FROM customer_plants WHERE customer_id = ?`).run(payload.id);
    await d.prepare(`DELETE FROM customers WHERE id = ?`).run(payload.id);
  });
  return { ok: true };
}

// src/main/services/products.ts
async function listProducts(payload = {}) {
  const d = getDb();
  const clause = payload.plant_id ? `WHERE ${plantScopeSql("p", "product")}` : "";
  const rows = await d.prepare(`SELECT p.id, p.name, p.description, p.status, p.created_at FROM products p ${clause} ORDER BY p.name`).all(payload);
  await attachPartyPlants(d, "product", rows);
  return rows;
}
async function createProduct(p) {
  const d = getDb();
  const name = properCase(p.name);
  if (!name) throw new Error("Product name is required.");
  const dup = await d.prepare(`SELECT id FROM products WHERE LOWER(name) = LOWER(?)`).get(name);
  if (dup) throw new Error("A product with this name already exists.");
  const plants = plantIdSet(p);
  const id = await d.transaction(async () => {
    const info = await d.prepare(`INSERT INTO products (plant_id, name, description, status) VALUES (0, ?, ?, ?)`).run(name, p.description ?? "", p.status ?? "active");
    const pid = Number(info.lastInsertRowid);
    await writePartyPlants(d, "product", pid, plants);
    return pid;
  });
  const row = await d.prepare(`SELECT * FROM products WHERE id = ?`).get(id);
  await attachPartyPlants(d, "product", [row]);
  return row;
}
async function updateProduct(p) {
  const d = getDb();
  const name = properCase(p.name);
  if (!name) throw new Error("Product name is required.");
  const dup = await d.prepare(`SELECT id FROM products WHERE LOWER(name) = LOWER(?) AND id <> ?`).get(name, p.id);
  if (dup) throw new Error("A product with this name already exists.");
  const plants = plantIdSet(p);
  await d.transaction(async () => {
    await d.prepare(`UPDATE products SET name=?, description=?, status=? WHERE id=?`).run(name, p.description ?? "", p.status ?? "active", p.id);
    await writePartyPlants(d, "product", p.id, plants);
  });
  const row = await d.prepare(`SELECT * FROM products WHERE id = ?`).get(p.id);
  await attachPartyPlants(d, "product", [row]);
  return row;
}
async function deleteProduct(payload) {
  const d = getDb();
  const prod = await d.prepare(`SELECT * FROM products WHERE id = ?`).get(payload.id);
  if (!prod) return { ok: false, error: "Product not found." };
  const used = await d.prepare(`SELECT COUNT(*) AS c FROM production_settings WHERE LOWER(product_name) = LOWER(?)`).get(prod.name);
  if (used.c > 0) {
    return { ok: false, error: "Cannot delete: this product is used in Production Settings." };
  }
  await d.transaction(async () => {
    await d.prepare(`DELETE FROM product_plants WHERE product_id = ?`).run(payload.id);
    await d.prepare(`DELETE FROM products WHERE id = ?`).run(payload.id);
  });
  return { ok: true };
}

// src/main/services/rates.ts
var import_node_crypto2 = require("node:crypto");
var VALID_UOM = ["CM", "TON", "CFT"];
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
async function listCustomerRates(payload) {
  if (!payload.customer_id) return [];
  return await getDb().prepare(
    `SELECT id, customer_id, product_name, uom, rate, updated_at
       FROM customer_rates
       WHERE customer_id = ?
       ORDER BY product_name, uom`
  ).all(payload.customer_id);
}
async function saveCustomerRates(payload) {
  const d = getDb();
  if (!payload.customer_id) return { ok: false, error: "Select a customer." };
  const items = (payload.items ?? []).map((i) => ({
    product_name: properCase(i.product_name),
    uom: VALID_UOM.includes(i.uom) ? i.uom : "CM",
    rate: Number(i.rate) || 0
  })).filter((i) => i.product_name);
  const seen = /* @__PURE__ */ new Set();
  for (const i of items) {
    const key = `${i.product_name.toLowerCase()}|${i.uom}`;
    if (seen.has(key)) {
      return { ok: false, error: `Duplicate rate for ${i.product_name} (${i.uom}).` };
    }
    seen.add(key);
  }
  const ts = nowIso();
  await d.transaction(async () => {
    await d.prepare(`DELETE FROM customer_rates WHERE customer_id = ?`).run(payload.customer_id);
    const stmt = d.prepare(
      `INSERT INTO customer_rates (customer_id, plant_id, product_name, uom, rate, updated_at)
       VALUES (?, 0, ?, ?, ?, ?)`
    );
    for (const i of items) {
      await stmt.run(payload.customer_id, i.product_name, i.uom, i.rate, ts);
    }
  });
  return { ok: true };
}
async function customerShareLink(payload) {
  const d = getDb();
  const row = await d.prepare(`SELECT share_token FROM customers WHERE id = ?`).get(payload.customer_id);
  if (!row) throw new Error("Customer not found.");
  let token = row.share_token;
  if (!token) {
    token = (0, import_node_crypto2.randomBytes)(16).toString("hex");
    await d.prepare(`UPDATE customers SET share_token = ? WHERE id = ?`).run(token, payload.customer_id);
  }
  return { token, path: `/rates/${token}` };
}
async function revokeShareLink(payload) {
  await getDb().prepare(`UPDATE customers SET share_token = NULL WHERE id = ?`).run(payload.customer_id);
  return { ok: true };
}
async function getBusinessNameInternal() {
  const row = await getDb().prepare("SELECT value FROM settings WHERE `key` = ?").get("business_name");
  return (row?.value || "").trim() || "BL Crushing";
}
async function getBusinessName() {
  return { business_name: await getBusinessNameInternal() };
}
async function setBusinessName(payload) {
  await putSetting("business_name", (payload.business_name ?? "").trim());
  return { ok: true };
}
async function putSetting(key, value) {
  const sql = dbKind() === "mysql" ? "INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)" : "INSERT INTO settings (`key`, value) VALUES (?, ?) ON CONFLICT(`key`) DO UPDATE SET value = excluded.value";
  await getDb().prepare(sql).run(key, value);
}
async function getSettingValue(key) {
  const row = await getDb().prepare("SELECT value FROM settings WHERE `key` = ?").get(key);
  return row?.value || "";
}
async function getBranding() {
  return { business_name: await getBusinessNameInternal(), logo: await getSettingValue("logo_data") };
}
async function setLogo(payload) {
  const logo = (payload.logo ?? "").trim();
  if (logo && !logo.startsWith("data:image/")) return { ok: false, error: "Logo must be an image." };
  if (logo.length > 4e6) return { ok: false, error: "Logo is too large \u2014 use a smaller image." };
  await putSetting("logo_data", logo);
  return { ok: true };
}
async function publicRateList(payload) {
  const token = (payload.token ?? "").trim();
  if (!token) return null;
  const d = getDb();
  const customer = await d.prepare(`SELECT id, name FROM customers WHERE share_token = ?`).get(token);
  if (!customer) return null;
  const rows = await d.prepare(
    `SELECT product_name, uom, rate, updated_at
       FROM customer_rates
       WHERE customer_id = ?
       ORDER BY product_name, uom`
  ).all(customer.id);
  let updated = null;
  for (const r of rows) {
    if (r.updated_at && (!updated || r.updated_at > updated)) updated = r.updated_at;
  }
  return {
    customer_name: customer.name,
    business_name: await getBusinessNameInternal(),
    updated_at: updated,
    rates: rows.map((r) => ({ product_name: r.product_name, uom: r.uom, rate: r.rate }))
  };
}

// src/main/services/rateChart.ts
var VALID_UOM2 = ["CM", "TON", "CFT"];
var VALID_BASIS = ["trip", "cm", "ton"];
function nowIso2() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function money(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round((v + Number.EPSILON) * 100) / 100 : 0;
}
async function listRateChart(payload = {}) {
  const d = getDb();
  const clause = payload.plant_id ? "WHERE l.plant_id = @plant_id" : "";
  return await d.prepare(
    `SELECT rc.*, l.name AS stock_location_name, p.name AS plant_name
       FROM rate_chart rc
       JOIN stock_locations l ON l.id = rc.stock_location_id
       JOIN plants p ON p.id = l.plant_id
       ${clause}
       ORDER BY p.name, l.name, rc.product_name, rc.uom`
  ).all(payload);
}
async function createRateChart(p) {
  const d = getDb();
  const name = properCase(p.product_name);
  if (!name) throw new Error("Select a product.");
  if (!p.stock_location_id) throw new Error("Select a location.");
  const uom = VALID_UOM2.includes(p.uom) ? p.uom : "CM";
  const dup = await d.prepare(
    `SELECT id FROM rate_chart WHERE stock_location_id = ? AND LOWER(product_name) = LOWER(?) AND uom = ?`
  ).get(p.stock_location_id, name, uom);
  if (dup) throw new Error("A rate row already exists for this product, location and unit.");
  const info = await d.prepare(
    `INSERT INTO rate_chart (product_name, stock_location_id, uom, rate_wholesale, rate_retail, rate_customer, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(name, p.stock_location_id, uom, money(p.rate_wholesale), money(p.rate_retail), money(p.rate_customer), nowIso2());
  return await d.prepare(`SELECT * FROM rate_chart WHERE id = ?`).get(info.lastInsertRowid);
}
async function updateRateChart(p) {
  const d = getDb();
  if (!p.id) throw new Error("Missing rate row id.");
  const name = properCase(p.product_name);
  const uom = VALID_UOM2.includes(p.uom) ? p.uom : "CM";
  const dup = await d.prepare(
    `SELECT id FROM rate_chart WHERE stock_location_id = ? AND LOWER(product_name) = LOWER(?) AND uom = ? AND id <> ?`
  ).get(p.stock_location_id, name, uom, p.id);
  if (dup) throw new Error("A rate row already exists for this product, location and unit.");
  await d.prepare(
    `UPDATE rate_chart SET product_name=?, stock_location_id=?, uom=?, rate_wholesale=?, rate_retail=?, rate_customer=?, updated_at=?
       WHERE id=?`
  ).run(name, p.stock_location_id, uom, money(p.rate_wholesale), money(p.rate_retail), money(p.rate_customer), nowIso2(), p.id);
  return await d.prepare(`SELECT * FROM rate_chart WHERE id = ?`).get(p.id);
}
async function deleteRateChart(payload) {
  await getDb().prepare(`DELETE FROM rate_chart WHERE id = ?`).run(payload.id);
  return { ok: true };
}
async function listTransportCharges(payload = {}) {
  const d = getDb();
  const clause = payload.plant_id ? "WHERE l.plant_id = @plant_id" : "";
  return await d.prepare(
    `SELECT tc.*, l.name AS stock_location_name, p.name AS plant_name
       FROM transport_charges tc
       JOIN stock_locations l ON l.id = tc.stock_location_id
       JOIN plants p ON p.id = l.plant_id
       ${clause}
       ORDER BY p.name, l.name, tc.vehicle_type`
  ).all(payload);
}
async function createTransportCharge(p) {
  const d = getDb();
  const vehicle = properCase(p.vehicle_type);
  if (!vehicle) throw new Error("Enter a vehicle / lorry type.");
  if (!p.stock_location_id) throw new Error("Select a location.");
  const basis = VALID_BASIS.includes(p.basis) ? p.basis : "trip";
  const info = await d.prepare(
    `INSERT INTO transport_charges (vehicle_type, stock_location_id, basis, charge, updated_at)
       VALUES (?, ?, ?, ?, ?)`
  ).run(vehicle, p.stock_location_id, basis, money(p.charge), nowIso2());
  return await d.prepare(`SELECT * FROM transport_charges WHERE id = ?`).get(info.lastInsertRowid);
}
async function updateTransportCharge(p) {
  const d = getDb();
  if (!p.id) throw new Error("Missing transport charge id.");
  const vehicle = properCase(p.vehicle_type);
  if (!vehicle) throw new Error("Enter a vehicle / lorry type.");
  const basis = VALID_BASIS.includes(p.basis) ? p.basis : "trip";
  await d.prepare(
    `UPDATE transport_charges SET vehicle_type=?, stock_location_id=?, basis=?, charge=?, updated_at=? WHERE id=?`
  ).run(vehicle, p.stock_location_id, basis, money(p.charge), nowIso2(), p.id);
  return await d.prepare(`SELECT * FROM transport_charges WHERE id = ?`).get(p.id);
}
async function deleteTransportCharge(payload) {
  await getDb().prepare(`DELETE FROM transport_charges WHERE id = ?`).run(payload.id);
  return { ok: true };
}

// src/main/services/purchases.ts
function round22(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
async function writeChildLines(d, purchaseId, transporters, machines) {
  await d.prepare(`DELETE FROM purchase_transporters WHERE purchase_id = ?`).run(purchaseId);
  await d.prepare(`DELETE FROM purchase_machines WHERE purchase_id = ?`).run(purchaseId);
  const tStmt = d.prepare(
    `INSERT INTO purchase_transporters (purchase_id, transporter_id, vehicle_no, basis, qty, rate, charge) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const t of transporters ?? []) {
    if (!t.transporter_id) continue;
    const basis = t.basis === "trip" || t.basis === "uom" ? t.basis : "flat";
    const qty = basis === "flat" ? 0 : Number(t.qty) || 0;
    const rate = basis === "flat" ? 0 : Number(t.rate) || 0;
    const charge = basis === "flat" ? round22(Number(t.charge) || 0) : round22(qty * rate);
    await tStmt.run(purchaseId, t.transporter_id, properCase(t.vehicle_no || ""), basis, qty, rate, charge);
  }
  const mStmt = d.prepare(
    `INSERT INTO purchase_machines (purchase_id, asset_id, basis, qty, rate, amount, outsource_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const m of machines ?? []) {
    if (!m.asset_id) continue;
    const basis = m.basis === "cm" ? "cm" : "hour";
    const qty = Number(m.qty) || 0;
    const rate = Number(m.rate) || 0;
    await mStmt.run(purchaseId, m.asset_id, basis, qty, rate, round22(qty * rate), m.outsource_id ?? null);
  }
}
async function getPurchaseDetail(payload) {
  const d = getDb();
  const pu = await d.prepare(`SELECT * FROM purchases WHERE id = ?`).get(payload.id);
  if (!pu) return null;
  pu.transporters = await d.prepare(
    `SELECT pt.*, t.name AS transporter_name FROM purchase_transporters pt
       JOIN transporters t ON t.id = pt.transporter_id WHERE pt.purchase_id = ? ORDER BY pt.id`
  ).all(payload.id);
  pu.machines = await d.prepare(
    `SELECT pm.*, a.name AS asset_name, o.name AS outsource_name FROM purchase_machines pm
       JOIN assets a ON a.id = pm.asset_id
       LEFT JOIN outsource o ON o.id = pm.outsource_id WHERE pm.purchase_id = ? ORDER BY pm.id`
  ).all(payload.id);
  return pu;
}
async function listPurchases(filter = {}) {
  const d = getDb();
  const where = [];
  const params = {};
  if (filter.supplier_id) {
    where.push("pu.supplier_id = @supplier_id");
    params.supplier_id = filter.supplier_id;
  }
  if (filter.plant_id) {
    where.push("pu.plant_id = @plant_id");
    params.plant_id = filter.plant_id;
  }
  if (filter.payment_status) {
    where.push("pu.payment_status = @payment_status");
    params.payment_status = filter.payment_status;
  }
  if (filter.from) {
    where.push("pu.date >= @from");
    params.from = filter.from;
  }
  if (filter.to) {
    where.push("pu.date <= @to");
    params.to = filter.to;
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return await d.prepare(
    `SELECT pu.*, s.name AS supplier_name, p.name AS plant_name, l.name AS stock_location_name,
        o.name AS outsource_name, o.head AS outsource_head, fp.name AS from_plant_name,
        (SELECT COALESCE(SUM(charge),0) FROM purchase_transporters pt WHERE pt.purchase_id = pu.id) AS transport_total,
        (SELECT COALESCE(SUM(amount),0) FROM purchase_machines pm WHERE pm.purchase_id = pu.id) AS machine_total
       FROM purchases pu
       JOIN suppliers s ON s.id = pu.supplier_id
       JOIN plants p ON p.id = pu.plant_id
       JOIN stock_locations l ON l.id = pu.stock_location_id
       LEFT JOIN outsource o ON o.id = pu.outsource_id
       LEFT JOIN plants fp ON fp.id = pu.from_plant_id
       ${clause}
       ORDER BY pu.date DESC, pu.id DESC`
  ).all(params);
}
function computeAmount(rate, qty) {
  if (rate == null || isNaN(rate)) return null;
  return Math.round((rate * qty + Number.EPSILON) * 100) / 100;
}
function roundQty(n) {
  return Math.round((n + Number.EPSILON) * 1e3) / 1e3;
}
async function createPurchase(p) {
  const d = getDb();
  if (!(p.quantity > 0)) throw new Error("Quantity must be greater than 0.");
  const mode = p.purchase_mode === "mining" ? "mining" : "purchase";
  const kind = mode === "purchase" && p.material_type === "finished" ? "finished" : "raw";
  const product = kind === "finished" ? properCase(p.product_name || "") : "";
  if (kind === "finished" && !product) throw new Error("Select a product to purchase.");
  const locId = p.stock_location_id || await ensureDefaultLocation(p.plant_id);
  const uom = ["CM", "TON", "CFT"].includes(p.uom) ? p.uom : "CM";
  const qtyCm = roundQty(toCm(p.quantity, uom, await plantUomFactors(p.plant_id)));
  const amount = computeAmount(p.rate, p.quantity);
  const id = await d.transaction(async () => {
    const no = await nextNumber("PUR", "purchase");
    const challan = (p.challan_no ?? "").trim() || await nextNumber("CHN", "challan");
    const info = await d.prepare(
      `INSERT INTO purchases
          (purchase_no, supplier_id, plant_id, stock_location_id, material_type, purchase_mode, product_name, outsource_id, from_plant_id, linked_dispatch_id, uom, quantity, qty_cm, rate, amount, paid_amount, payment_status, challan_no, date, remarks)
         VALUES (@purchase_no,@supplier_id,@plant_id,@stock_location_id,@material_type,@purchase_mode,@product_name,@outsource_id,@from_plant_id,@linked_dispatch_id,@uom,@quantity,@qty_cm,@rate,@amount,@paid_amount,@payment_status,@challan_no,@date,@remarks)`
    ).run({
      purchase_no: no,
      challan_no: challan,
      supplier_id: p.supplier_id,
      plant_id: p.plant_id,
      stock_location_id: locId,
      material_type: kind,
      purchase_mode: mode,
      product_name: product,
      outsource_id: p.outsource_id ?? null,
      from_plant_id: p.from_plant_id ?? null,
      linked_dispatch_id: p.linked_dispatch_id ?? null,
      uom,
      quantity: p.quantity,
      qty_cm: qtyCm,
      rate: p.rate,
      amount,
      paid_amount: p.paid_amount || 0,
      payment_status: derivePaymentStatus(amount ?? 0, p.paid_amount || 0),
      date: p.date,
      remarks: p.remarks ?? ""
    });
    await writeChildLines(d, Number(info.lastInsertRowid), p.transporters, p.machines);
    if (kind === "finished") {
      await addMovement(d, {
        type: "purchase",
        material_type: "finished",
        ref_no: no,
        plant_id: p.plant_id,
        product_name: product,
        change_qty: qtyCm,
        date: p.date,
        note: "Finished goods purchased"
      });
    } else {
      await addMovement(d, {
        type: "purchase",
        material_type: "raw",
        ref_no: no,
        plant_id: p.plant_id,
        stock_location_id: locId,
        change_qty: qtyCm,
        date: p.date,
        note: "Raw material received"
      });
    }
    return Number(info.lastInsertRowid);
  });
  return await d.prepare(`SELECT * FROM purchases WHERE id = ?`).get(id);
}
async function updatePurchase(p) {
  const d = getDb();
  if (!p.id) throw new Error("Missing purchase id.");
  if (!(p.quantity > 0)) throw new Error("Quantity must be greater than 0.");
  const old = await d.prepare(`SELECT * FROM purchases WHERE id = ?`).get(p.id);
  if (!old) throw new Error("Purchase not found.");
  if (old.linked_dispatch_id)
    throw new Error("This purchase was created by an inter-plant sale \u2014 edit that sale instead.");
  const mode = p.purchase_mode === "mining" ? "mining" : "purchase";
  const kind = mode === "purchase" && p.material_type === "finished" ? "finished" : "raw";
  const product = kind === "finished" ? properCase(p.product_name || "") : "";
  if (kind === "finished" && !product) throw new Error("Select a product to purchase.");
  const locId = p.stock_location_id || old.stock_location_id || await ensureDefaultLocation(p.plant_id);
  const uom = ["CM", "TON", "CFT"].includes(p.uom) ? p.uom : "CM";
  const qtyCm = roundQty(toCm(p.quantity, uom, await plantUomFactors(p.plant_id)));
  const amount = computeAmount(p.rate, p.quantity);
  await d.transaction(async () => {
    const challan = (p.challan_no ?? "").trim() || old.challan_no || await nextNumber("CHN", "challan");
    await d.prepare(
      `UPDATE purchases SET supplier_id=@supplier_id, plant_id=@plant_id, stock_location_id=@stock_location_id,
         material_type=@material_type, purchase_mode=@purchase_mode, product_name=@product_name, outsource_id=@outsource_id,
         uom=@uom, quantity=@quantity, qty_cm=@qty_cm, rate=@rate, amount=@amount, paid_amount=@paid_amount,
         payment_status=@payment_status, challan_no=@challan_no, date=@date, remarks=@remarks WHERE id=@id`
    ).run({
      id: p.id,
      challan_no: challan,
      supplier_id: p.supplier_id,
      plant_id: p.plant_id,
      stock_location_id: locId,
      material_type: kind,
      purchase_mode: mode,
      product_name: product,
      outsource_id: p.outsource_id ?? null,
      uom,
      quantity: p.quantity,
      qty_cm: qtyCm,
      rate: p.rate,
      amount,
      paid_amount: p.paid_amount || 0,
      payment_status: derivePaymentStatus(amount ?? 0, p.paid_amount || 0),
      date: p.date,
      remarks: p.remarks ?? ""
    });
    await writeChildLines(d, p.id, p.transporters, p.machines);
    await d.prepare(`DELETE FROM stock_movements WHERE ref_no=? AND type='purchase'`).run(old.purchase_no);
    if (kind === "finished") {
      await addMovement(d, {
        type: "purchase",
        material_type: "finished",
        ref_no: old.purchase_no,
        plant_id: p.plant_id,
        product_name: product,
        change_qty: qtyCm,
        date: p.date,
        note: "Finished goods purchased"
      });
    } else {
      await addMovement(d, {
        type: "purchase",
        material_type: "raw",
        ref_no: old.purchase_no,
        plant_id: p.plant_id,
        stock_location_id: locId,
        change_qty: qtyCm,
        date: p.date,
        note: "Raw material received"
      });
    }
    if (await rawLocationBalance(d, old.stock_location_id) < 0)
      throw new Error("Edit would make the original location stock negative.");
    if (kind === "raw" && await rawLocationBalance(d, locId) < 0)
      throw new Error("Edit would make the location stock negative.");
    if (old.material_type === "finished" && old.product_name && await finishedBalance(d, old.plant_id, old.product_name) < 0)
      throw new Error("Edit would make the original finished-goods stock negative.");
    if (kind === "finished" && await finishedBalance(d, p.plant_id, product) < 0)
      throw new Error("Edit would make the finished-goods stock negative.");
  });
  return await d.prepare(`SELECT * FROM purchases WHERE id = ?`).get(p.id);
}
async function deletePurchase(payload) {
  const d = getDb();
  const old = await d.prepare(`SELECT * FROM purchases WHERE id = ?`).get(payload.id);
  if (!old) return { ok: false, error: "Purchase not found." };
  if (old.linked_dispatch_id)
    return { ok: false, error: "This purchase was created by an inter-plant sale \u2014 delete that sale instead." };
  try {
    await d.transaction(async () => {
      await d.prepare(`DELETE FROM stock_movements WHERE ref_no=? AND type='purchase'`).run(
        old.purchase_no
      );
      if (old.material_type === "finished") {
        if (old.product_name && await finishedBalance(d, old.plant_id, old.product_name) < 0)
          throw new Error("Cannot delete: these finished goods have already been dispatched or sold.");
      } else if (await rawLocationBalance(d, old.stock_location_id) < 0) {
        throw new Error("Cannot delete: this material has already been consumed in production.");
      }
      await d.prepare(`DELETE FROM purchase_transporters WHERE purchase_id = ?`).run(payload.id);
      await d.prepare(`DELETE FROM purchase_machines WHERE purchase_id = ?`).run(payload.id);
      await d.prepare(`DELETE FROM purchases WHERE id = ?`).run(payload.id);
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
async function removeLinkedPurchase(id) {
  const d = getDb();
  const old = await d.prepare(`SELECT * FROM purchases WHERE id = ?`).get(id);
  if (!old) return;
  await d.prepare(`DELETE FROM stock_movements WHERE ref_no=? AND type='purchase'`).run(old.purchase_no);
  if (old.material_type === "finished" && old.product_name && await finishedBalance(d, old.plant_id, old.product_name) < 0)
    throw new Error("Cannot reverse: the received goods have already been sold/dispatched at the destination plant.");
  await d.prepare(`DELETE FROM purchase_transporters WHERE purchase_id = ?`).run(id);
  await d.prepare(`DELETE FROM purchase_machines WHERE purchase_id = ?`).run(id);
  await d.prepare(`DELETE FROM purchases WHERE id = ?`).run(id);
}
async function setPurchasePayment(payload) {
  const d = getDb();
  const row = await d.prepare(`SELECT amount FROM purchases WHERE id = ?`).get(payload.id);
  if (!row) throw new Error("Purchase not found.");
  const paid = Number(payload.paid_amount) || 0;
  await d.prepare(`UPDATE purchases SET paid_amount=?, payment_status=? WHERE id=?`).run(
    paid,
    derivePaymentStatus(Number(row.amount) || 0, paid),
    payload.id
  );
  return await d.prepare(`SELECT * FROM purchases WHERE id = ?`).get(payload.id);
}

// src/main/services/productionSettings.ts
async function listProductionSettings(payload) {
  return await getDb().prepare(`SELECT * FROM production_settings WHERE plant_id = ? ORDER BY id`).all(payload.plant_id);
}
async function saveProductionSettings(payload) {
  const d = getDb();
  const items = payload.items.map((i) => ({
    product_name: properCase(i.product_name),
    output_percentage: Number(i.output_percentage) || 0
  })).filter((i) => i.product_name !== "");
  if (items.length === 0) return { ok: false, error: "Add at least one product." };
  const names = items.map((i) => i.product_name.toLowerCase());
  if (new Set(names).size !== names.length)
    return { ok: false, error: "Duplicate product names are not allowed." };
  const total = items.reduce((s, i) => s + i.output_percentage, 0);
  if (Math.abs(total - 100) > 1e-3)
    return { ok: false, error: `Total output must equal 100%. Current total is ${round4(total)}%.` };
  await d.transaction(async () => {
    await d.prepare(`DELETE FROM production_settings WHERE plant_id = ?`).run(payload.plant_id);
    const stmt = d.prepare(
      `INSERT INTO production_settings (plant_id, product_name, output_percentage) VALUES (?, ?, ?)`
    );
    for (const i of items) await stmt.run(payload.plant_id, i.product_name, i.output_percentage);
  });
  return { ok: true };
}
function round4(n) {
  return Math.round((n + Number.EPSILON) * 1e3) / 1e3;
}

// src/main/services/productions.ts
async function listProductions(filter = {}) {
  const d = getDb();
  const where = [];
  const params = {};
  if (filter.plant_id) {
    where.push("pr.plant_id = @plant_id");
    params.plant_id = filter.plant_id;
  }
  if (filter.from) {
    where.push("pr.date >= @from");
    params.from = filter.from;
  }
  if (filter.to) {
    where.push("pr.date <= @to");
    params.to = filter.to;
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await d.prepare(
    `SELECT pr.*, p.name AS plant_name, l.name AS stock_location_name
       FROM productions pr
       JOIN plants p ON p.id = pr.plant_id
       JOIN stock_locations l ON l.id = pr.stock_location_id
       ${clause}
       ORDER BY pr.date DESC, pr.id DESC`
  ).all(params);
  for (const r of rows) {
    r.outputs = await d.prepare(`SELECT * FROM production_outputs WHERE production_id = ? ORDER BY id`).all(r.id);
  }
  return rows;
}
async function previewProduction(payload) {
  const d = getDb();
  const settings = await d.prepare(`SELECT * FROM production_settings WHERE plant_id = ? ORDER BY id`).all(payload.plant_id);
  return settings.map((s) => ({
    product_name: s.product_name,
    percentage: s.output_percentage,
    quantity: round5(payload.raw_qty * s.output_percentage / 100)
  }));
}
async function createProduction(p) {
  const d = getDb();
  const uom = ["CM", "TON", "CFT"].includes(p.uom) ? p.uom : "CM";
  const quantity = Number(p.quantity ?? p.raw_qty) || 0;
  if (!(quantity > 0)) throw new Error("Raw material quantity must be greater than 0.");
  const rawQty = round5(toCm(quantity, uom, await plantUomFactors(p.plant_id)));
  const locId = p.stock_location_id || await ensureDefaultLocation(p.plant_id);
  const settings = await d.prepare(`SELECT * FROM production_settings WHERE plant_id = ? ORDER BY id`).all(p.plant_id);
  if (settings.length === 0)
    throw new Error("No production settings defined for this plant. Set them up first.");
  const available = await rawLocationBalance(d, locId);
  if (rawQty > available)
    throw new Error(
      `Not enough raw material. Available: ${available} m\xB3, requested: ${rawQty} m\xB3.`
    );
  const id = await d.transaction(async () => {
    const no = await nextNumber("PROD", "production");
    const info = await d.prepare(
      `INSERT INTO productions (production_no, plant_id, stock_location_id, uom, quantity, raw_qty, date, remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(no, p.plant_id, locId, uom, quantity, rawQty, p.date, p.remarks ?? "");
    const productionId = Number(info.lastInsertRowid);
    await addMovement(d, {
      type: "production_consume",
      material_type: "raw",
      ref_no: no,
      plant_id: p.plant_id,
      stock_location_id: locId,
      change_qty: -rawQty,
      date: p.date,
      note: "Raw material consumed in production"
    });
    const outStmt = d.prepare(
      `INSERT INTO production_outputs (production_id, product_name, percentage, quantity)
       VALUES (?, ?, ?, ?)`
    );
    for (const s of settings) {
      const qty = round5(rawQty * s.output_percentage / 100);
      await outStmt.run(productionId, s.product_name, s.output_percentage, qty);
      if (qty > 0) {
        await addMovement(d, {
          type: "production_output",
          material_type: "finished",
          ref_no: no,
          plant_id: p.plant_id,
          product_name: s.product_name,
          change_qty: qty,
          date: p.date,
          note: "Finished goods produced"
        });
      }
    }
    if (await rawLocationBalance(d, locId) < 0)
      throw new Error("Stock cannot go negative.");
    return productionId;
  });
  return (await listProductions()).find((x) => x.id === id);
}
async function deleteProduction(payload) {
  const d = getDb();
  const prod = await d.prepare(`SELECT * FROM productions WHERE id = ?`).get(payload.id);
  if (!prod) return { ok: false, error: "Production not found." };
  try {
    await d.transaction(async () => {
      const outputs = await d.prepare(`SELECT * FROM production_outputs WHERE production_id = ?`).all(payload.id);
      await d.prepare(`DELETE FROM stock_movements WHERE ref_no=? AND type='production_output'`).run(
        prod.production_no
      );
      for (const o of outputs) {
        if (await finishedBalance(d, prod.plant_id, o.product_name) < 0)
          throw new Error(
            `Cannot delete: ${o.product_name} produced here has already been dispatched.`
          );
      }
      await d.prepare(`DELETE FROM stock_movements WHERE ref_no=? AND type='production_consume'`).run(
        prod.production_no
      );
      await d.prepare(`DELETE FROM production_outputs WHERE production_id = ?`).run(payload.id);
      await d.prepare(`DELETE FROM productions WHERE id = ?`).run(payload.id);
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
function round5(n) {
  return Math.round((n + Number.EPSILON) * 1e3) / 1e3;
}

// src/main/services/finishedGoods.ts
async function listFinishedGoods(filter = {}) {
  const d = getDb();
  const where = [`m.material_type = 'finished'`];
  const params = {};
  if (filter.plant_id) {
    where.push("m.plant_id = @plant_id");
    params.plant_id = filter.plant_id;
  }
  if (filter.product_name) {
    where.push("m.product_name = @product_name");
    params.product_name = filter.product_name;
  }
  const dateProd = filter.from || filter.to ? buildDateClause(filter, params, "prodd") : "";
  const datePurch = filter.from || filter.to ? buildDateClause(filter, params, "purd") : "";
  const dateDisp = filter.from || filter.to ? buildDateClause(filter, params, "dispd") : "";
  const dateLoad = filter.from || filter.to ? buildDateClause(filter, params, "loadd") : "";
  const rows = await d.prepare(
    `SELECT m.plant_id, p.name AS plant_name, m.product_name,
        COALESCE(SUM(CASE WHEN m.type='opening' THEN m.change_qty ELSE 0 END),0) AS opening_qty,
        COALESCE(SUM(CASE WHEN m.type='production_output' ${dateProd} THEN m.change_qty ELSE 0 END),0) AS produced_qty,
        COALESCE(SUM(CASE WHEN m.type='purchase' ${datePurch} THEN m.change_qty ELSE 0 END),0) AS purchased_qty,
        COALESCE(SUM(CASE WHEN m.type='dispatch' ${dateDisp} THEN -m.change_qty ELSE 0 END),0) AS dispatched_qty,
        COALESCE(SUM(CASE WHEN m.type='rack_load' ${dateLoad} THEN -m.change_qty ELSE 0 END),0) AS loaded_qty,
        COALESCE(SUM(m.change_qty),0) AS balance_qty,
        COALESCE(MAX(fgo.opening_rate),0) AS opening_rate,
        COALESCE(MAX(fgo.opening_amount),0) AS opening_amount
       FROM stock_movements m
       JOIN plants p ON p.id = m.plant_id
       LEFT JOIN finished_goods_opening fgo
         ON fgo.plant_id = m.plant_id AND fgo.product_name = m.product_name
       WHERE ${where.join(" AND ")}
       GROUP BY m.plant_id, m.product_name
       ORDER BY p.name, m.product_name`
  ).all(params);
  return rows.map((r) => ({
    ...r,
    opening_qty: round6(r.opening_qty),
    produced_qty: round6(r.produced_qty),
    purchased_qty: round6(r.purchased_qty),
    dispatched_qty: round6(r.dispatched_qty),
    loaded_qty: round6(r.loaded_qty),
    balance_qty: round6(r.balance_qty),
    opening_rate: round6(r.opening_rate ?? 0),
    opening_amount: round6(r.opening_amount ?? 0)
  }));
}
function buildDateClause(filter, params, prefix) {
  let c = "";
  if (filter.from) {
    c += ` AND m.date >= @${prefix}_from`;
    params[`${prefix}_from`] = filter.from;
  }
  if (filter.to) {
    c += ` AND m.date <= @${prefix}_to`;
    params[`${prefix}_to`] = filter.to;
  }
  return c;
}
async function availableProducts(payload) {
  return (await listFinishedGoods({ plant_id: payload.plant_id })).filter((f) => f.balance_qty > 0).map((f) => ({ product_name: f.product_name, balance_qty: f.balance_qty }));
}
async function setOpening(payload) {
  const d = getDb();
  const date = payload.date || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const product = properCase(payload.product_name);
  const qty = payload.opening_qty || 0;
  let amount = Number(payload.opening_amount) || 0;
  let rate = Number(payload.opening_rate) || 0;
  if (amount === 0 && rate > 0) amount = rate * qty;
  if (rate === 0 && amount > 0 && qty > 0) rate = amount / qty;
  await d.transaction(async () => {
    await d.prepare(
      dbKind() === "mysql" ? `INSERT INTO finished_goods_opening (plant_id, product_name, opening_qty, opening_rate, opening_amount)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE opening_qty = VALUES(opening_qty),
             opening_rate = VALUES(opening_rate), opening_amount = VALUES(opening_amount)` : `INSERT INTO finished_goods_opening (plant_id, product_name, opening_qty, opening_rate, opening_amount)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(plant_id, product_name) DO UPDATE SET opening_qty = excluded.opening_qty,
             opening_rate = excluded.opening_rate, opening_amount = excluded.opening_amount`
    ).run(payload.plant_id, product, qty, rate, amount);
    await setFinishedOpening(d, payload.plant_id, product, qty, date);
  });
  return { ok: true };
}
function round6(n) {
  return Math.round((n + Number.EPSILON) * 1e3) / 1e3;
}

// src/main/services/dispatches.ts
var BILLED_TOTAL_SQL = `(COALESCE(di.amount,0)
  + CASE WHEN di.transport_billed = 1 THEN di.transport_charge ELSE 0 END
  + CASE WHEN di.other_billed = 1 THEN di.other_charge ELSE 0 END)`;
function round23(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
async function resolveInvoiceNo(d, provided) {
  const wanted = (provided ?? "").trim();
  if (!wanted) return nextNumber("SALE", "dispatch");
  const dupe = await d.prepare(`SELECT id FROM dispatches WHERE dispatch_no = ?`).get(wanted);
  if (dupe) throw new Error(`Invoice number "${wanted}" is already used by another sale.`);
  return wanted;
}
async function writeDispatchChildLines(d, dispatchId, transporters, machines) {
  await d.prepare(`DELETE FROM dispatch_transporters WHERE dispatch_id = ?`).run(dispatchId);
  await d.prepare(`DELETE FROM dispatch_machines WHERE dispatch_id = ?`).run(dispatchId);
  const tStmt = d.prepare(
    `INSERT INTO dispatch_transporters (dispatch_id, transporter_id, vehicle_no, basis, qty, rate, charge, bill_customer) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  let billedTransport = 0;
  let firstVehicle = "";
  for (const t of transporters ?? []) {
    if (!t.transporter_id) continue;
    const basis = t.basis === "trip" || t.basis === "uom" ? t.basis : "flat";
    const qty = basis === "flat" ? 0 : Number(t.qty) || 0;
    const rate = basis === "flat" ? 0 : Number(t.rate) || 0;
    const charge = basis === "flat" ? round23(Number(t.charge) || 0) : round23(qty * rate);
    const billCustomer = t.bill_customer ? 1 : 0;
    const veh = properCase(t.vehicle_no || "");
    if (billCustomer) billedTransport = round23(billedTransport + charge);
    if (!firstVehicle && veh) firstVehicle = veh;
    await tStmt.run(dispatchId, t.transporter_id, veh, basis, qty, rate, charge, billCustomer);
  }
  const mStmt = d.prepare(
    `INSERT INTO dispatch_machines (dispatch_id, asset_id, basis, qty, rate, amount, outsource_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const m of machines ?? []) {
    if (!m.asset_id) continue;
    const basis = m.basis === "cm" ? "cm" : "hour";
    const qty = Number(m.qty) || 0;
    const rate = Number(m.rate) || 0;
    await mStmt.run(dispatchId, m.asset_id, basis, qty, rate, round23(qty * rate), m.outsource_id ?? null);
  }
  return { billedTransport, firstVehicle };
}
async function getDispatchDetail(payload) {
  const d = getDb();
  const di = await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(payload.id);
  if (!di) return null;
  di.transporters = await d.prepare(
    `SELECT dt.*, t.name AS transporter_name FROM dispatch_transporters dt
       JOIN transporters t ON t.id = dt.transporter_id WHERE dt.dispatch_id = ? ORDER BY dt.id`
  ).all(payload.id);
  di.machines = await d.prepare(
    `SELECT dm.*, a.name AS asset_name, o.name AS outsource_name FROM dispatch_machines dm
       JOIN assets a ON a.id = dm.asset_id
       LEFT JOIN outsource o ON o.id = dm.outsource_id WHERE dm.dispatch_id = ? ORDER BY dm.id`
  ).all(payload.id);
  return di;
}
async function plantName(plantId) {
  const r = await getDb().prepare(`SELECT name FROM plants WHERE id = ?`).get(plantId);
  return r?.name ?? `Plant ${plantId}`;
}
async function ensureInternalCustomer(refPlantId) {
  const d = getDb();
  const ex = await d.prepare(`SELECT id FROM customers WHERE plant_ref_id = ?`).get(refPlantId);
  if (ex) return ex.id;
  const info = await d.prepare(
    `INSERT INTO customers (name, contact, address, remarks, plant_ref_id) VALUES (?, '', '', 'Internal \u2014 inter-plant', ?)`
  ).run(properCase(await plantName(refPlantId)), refPlantId);
  return Number(info.lastInsertRowid);
}
async function ensureInternalSupplier(refPlantId) {
  const d = getDb();
  const ex = await d.prepare(`SELECT id FROM suppliers WHERE plant_ref_id = ?`).get(refPlantId);
  if (ex) return ex.id;
  const info = await d.prepare(
    `INSERT INTO suppliers (name, contact, address, remarks, plant_ref_id) VALUES (?, '', '', 'Internal \u2014 inter-plant', ?)`
  ).run(properCase(await plantName(refPlantId)), refPlantId);
  return Number(info.lastInsertRowid);
}
async function listDispatches(filter = {}) {
  const d = getDb();
  const where = [];
  const params = {};
  if (filter.customer_id) {
    where.push("di.customer_id = @customer_id");
    params.customer_id = filter.customer_id;
  }
  if (filter.plant_id) {
    where.push("di.plant_id = @plant_id");
    params.plant_id = filter.plant_id;
  }
  if (filter.product_name) {
    where.push("di.product_name = @product_name");
    params.product_name = filter.product_name;
  }
  if (filter.delivery_status) {
    where.push("di.delivery_status = @delivery_status");
    params.delivery_status = filter.delivery_status;
  }
  if (filter.dispatch_status) {
    where.push("di.dispatch_status = @dispatch_status");
    params.dispatch_status = filter.dispatch_status;
  }
  if (filter.payment_status) {
    where.push("di.payment_status = @payment_status");
    params.payment_status = filter.payment_status;
  }
  if (filter.rate_pending) {
    where.push("di.rate IS NULL");
  }
  if (filter.from) {
    where.push("di.date >= @from");
    params.from = filter.from;
  }
  if (filter.to) {
    where.push("di.date <= @to");
    params.to = filter.to;
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return await d.prepare(
    `SELECT di.*, c.name AS customer_name, p.name AS plant_name,
        o.name AS outsource_name, o.head AS outsource_head, t.name AS transporter_name,
        tp.name AS to_plant_name,
        ${BILLED_TOTAL_SQL} AS billed_total,
        (SELECT COALESCE(SUM(charge),0) FROM dispatch_transporters dt WHERE dt.dispatch_id = di.id) AS transport_total,
        (SELECT COALESCE(SUM(amount),0) FROM dispatch_machines dm WHERE dm.dispatch_id = di.id) AS machine_total
       FROM dispatches di
       JOIN customers c ON c.id = di.customer_id
       JOIN plants p ON p.id = di.plant_id
       LEFT JOIN outsource o ON o.id = di.outsource_id
       LEFT JOIN transporters t ON t.id = di.transporter_id
       LEFT JOIN plants tp ON tp.id = di.to_plant_id
       ${clause}
       ORDER BY di.date DESC, di.id DESC`
  ).all(params);
}
function computeAmount2(rate, qty) {
  if (rate == null || isNaN(rate)) return null;
  return Math.round((rate * qty + Number.EPSILON) * 100) / 100;
}
function roundQty2(n) {
  return Math.round((n + Number.EPSILON) * 1e3) / 1e3;
}
function normalize(p, factors) {
  if (!["CM", "TON", "CFT"].includes(p.uom)) throw new Error("Invalid unit of measure.");
  const product = properCase(p.product_name);
  const outsourcedFlag = !!p.outsourced;
  const saleQty = p.sale_quantity == null || p.sale_quantity === "" ? null : Number(p.sale_quantity);
  if (saleQty != null && saleQty < 0) throw new Error("Sale quantity cannot be negative.");
  const rawActual = Number(p.quantity);
  const actualQty = rawActual > 0 ? rawActual : outsourcedFlag && saleQty != null && saleQty > 0 ? saleQty : rawActual;
  if (!(actualQty > 0)) throw new Error("Actual quantity must be greater than 0.");
  const billableQty = saleQty != null ? saleQty : actualQty;
  const qtyCm = roundQty2(toCm(actualQty, p.uom, factors));
  const amount = computeAmount2(p.rate, billableQty);
  const transport = Number(p.transport_charge) || 0;
  const other = Number(p.other_charge) || 0;
  const billed = (amount ?? 0) + (p.transport_billed ? transport : 0) + (p.other_billed ? other : 0);
  const paid = Number(p.paid_amount) || 0;
  const outsourced = outsourcedFlag;
  const buyRate = outsourced && p.buy_rate != null && p.buy_rate !== "" ? Number(p.buy_rate) : null;
  return {
    product,
    qtyCm,
    amount,
    outsourced,
    fields: {
      customer_id: p.customer_id,
      plant_id: p.plant_id,
      product_name: product,
      uom: p.uom,
      quantity: actualQty,
      qty_cm: qtyCm,
      sale_quantity: saleQty,
      rate: p.rate,
      buy_rate: buyRate,
      amount,
      transport_charge: transport,
      transport_billed: p.transport_billed ? 1 : 0,
      other_charge: other,
      other_billed: p.other_billed ? 1 : 0,
      vehicle_no: p.vehicle_no ?? "",
      vehicle_type: p.vehicle_type || "own",
      transporter_id: p.transporter_id ?? null,
      driver: properCase(p.driver),
      challan_no: (p.challan_no ?? "").trim(),
      outsourced: outsourced ? 1 : 0,
      outsource_id: outsourced ? p.outsource_id ?? null : null,
      delivery_status: p.delivery_status,
      payment_status: derivePaymentStatus(billed, paid),
      paid_amount: paid,
      date: p.date,
      remarks: p.remarks ?? ""
    }
  };
}
async function createMirrorPurchase(sourcePlantId, destPlantId, dispatchId, product, qtyCm, amount, date) {
  const supplierId = await ensureInternalSupplier(sourcePlantId);
  const ratePerCm = amount != null && qtyCm > 0 ? round23(amount / qtyCm) : null;
  const mirror = await createPurchase({
    supplier_id: supplierId,
    plant_id: destPlantId,
    material_type: "finished",
    product_name: product,
    purchase_mode: "purchase",
    from_plant_id: sourcePlantId,
    linked_dispatch_id: dispatchId,
    uom: "CM",
    quantity: qtyCm,
    rate: ratePerCm,
    paid_amount: 0,
    payment_status: "unpaid",
    date,
    remarks: `Inter-plant \u2014 received from ${await plantName(sourcePlantId)}`
  });
  return mirror.id;
}
async function createDispatch(p) {
  const d = getDb();
  const interPlant = p.to_plant_id != null && Number(p.to_plant_id) > 0 && Number(p.to_plant_id) !== Number(p.plant_id);
  const { product, qtyCm, amount, outsourced, fields } = normalize(p, await plantUomFactors(p.plant_id));
  if (!outsourced) {
    const available = await finishedBalance(d, p.plant_id, product);
    if (qtyCm > available)
      throw new Error(
        `Not enough finished goods. Available ${product}: ${available} m\xB3, requested: ${qtyCm} m\xB3.`
      );
  }
  const id = await d.transaction(async () => {
    const toPlantId = interPlant ? Number(p.to_plant_id) : null;
    const customerId = interPlant ? await ensureInternalCustomer(toPlantId) : p.customer_id;
    const no = await resolveInvoiceNo(d, p.dispatch_no);
    const info = await d.prepare(
      `INSERT INTO dispatches
          (dispatch_no, customer_id, plant_id, product_name, uom, quantity, qty_cm, sale_quantity, rate, buy_rate, amount,
           transport_charge, transport_billed, other_charge, other_billed,
           vehicle_no, vehicle_type, transporter_id, driver, challan_no, outsourced, outsource_id,
           delivery_status, dispatch_status, payment_status, paid_amount, to_plant_id, linked_purchase_id, date, remarks)
         VALUES (@dispatch_no,@customer_id,@plant_id,@product_name,@uom,@quantity,@qty_cm,@sale_quantity,@rate,@buy_rate,@amount,
           @transport_charge,@transport_billed,@other_charge,@other_billed,
           @vehicle_no,@vehicle_type,@transporter_id,@driver,@challan_no,@outsourced,@outsource_id,
           @delivery_status,@dispatch_status,@payment_status,@paid_amount,@to_plant_id,@linked_purchase_id,@date,@remarks)`
    ).run({
      dispatch_no: no,
      dispatch_status: "pending",
      ...fields,
      customer_id: customerId,
      to_plant_id: toPlantId,
      linked_purchase_id: null
    });
    const dispatchId = Number(info.lastInsertRowid);
    const child = await writeDispatchChildLines(d, dispatchId, p.transporters, p.machines);
    await d.prepare(`UPDATE dispatches SET transport_charge=?, transport_billed=?, vehicle_no=CASE WHEN vehicle_no='' THEN ? ELSE vehicle_no END WHERE id=?`).run(child.billedTransport, child.billedTransport > 0 ? 1 : 0, child.firstVehicle, dispatchId);
    if (!outsourced) {
      await addMovement(d, {
        type: "dispatch",
        material_type: "finished",
        ref_no: no,
        plant_id: p.plant_id,
        product_name: product,
        change_qty: -qtyCm,
        date: p.date,
        note: interPlant ? `Inter-plant sale to ${await plantName(toPlantId)}` : "Direct sale to customer"
      });
      if (await finishedBalance(d, p.plant_id, product) < 0) throw new Error("Stock cannot go negative.");
    }
    if (interPlant) {
      const purchaseId = await createMirrorPurchase(p.plant_id, toPlantId, dispatchId, product, qtyCm, amount, p.date);
      await d.prepare(`UPDATE dispatches SET linked_purchase_id=? WHERE id=?`).run(purchaseId, dispatchId);
    }
    return dispatchId;
  });
  return await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(id);
}
async function updateDispatch(p) {
  const d = getDb();
  if (!p.id) throw new Error("Missing dispatch id.");
  const old = await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(p.id);
  if (!old) throw new Error("Dispatch not found.");
  const interPlant = p.to_plant_id != null && Number(p.to_plant_id) > 0 && Number(p.to_plant_id) !== Number(p.plant_id);
  const { product, qtyCm, amount, outsourced, fields } = normalize(p, await plantUomFactors(p.plant_id));
  await d.transaction(async () => {
    if (old.linked_purchase_id) await removeLinkedPurchase(old.linked_purchase_id);
    const toPlantId = interPlant ? Number(p.to_plant_id) : null;
    const customerId = interPlant ? await ensureInternalCustomer(toPlantId) : p.customer_id;
    const wantedNo = (p.dispatch_no ?? "").trim();
    let newNo = old.dispatch_no;
    if (wantedNo && wantedNo !== old.dispatch_no) {
      const dupe = await d.prepare(`SELECT id FROM dispatches WHERE dispatch_no = ? AND id <> ?`).get(wantedNo, p.id);
      if (dupe) throw new Error(`Invoice number "${wantedNo}" is already used by another sale.`);
      newNo = wantedNo;
    }
    await d.prepare(
      `UPDATE dispatches SET dispatch_no=@dispatch_no, customer_id=@customer_id, plant_id=@plant_id, product_name=@product_name,
        uom=@uom, quantity=@quantity, qty_cm=@qty_cm, sale_quantity=@sale_quantity, rate=@rate, buy_rate=@buy_rate, amount=@amount,
        transport_charge=@transport_charge, transport_billed=@transport_billed,
        other_charge=@other_charge, other_billed=@other_billed,
        vehicle_no=@vehicle_no, vehicle_type=@vehicle_type, transporter_id=@transporter_id, driver=@driver, challan_no=@challan_no,
        outsourced=@outsourced, outsource_id=@outsource_id, delivery_status=@delivery_status, payment_status=@payment_status, paid_amount=@paid_amount,
        to_plant_id=@to_plant_id, linked_purchase_id=NULL, date=@date, remarks=@remarks WHERE id=@id`
    ).run({ id: p.id, ...fields, dispatch_no: newNo, customer_id: customerId, to_plant_id: toPlantId });
    const child = await writeDispatchChildLines(d, p.id, p.transporters, p.machines);
    await d.prepare(`UPDATE dispatches SET transport_charge=?, transport_billed=?, vehicle_no=CASE WHEN vehicle_no='' THEN ? ELSE vehicle_no END WHERE id=?`).run(child.billedTransport, child.billedTransport > 0 ? 1 : 0, child.firstVehicle, p.id);
    await d.prepare(`DELETE FROM stock_movements WHERE ref_no=? AND type='dispatch'`).run(old.dispatch_no);
    if (!outsourced) {
      await addMovement(d, {
        type: "dispatch",
        material_type: "finished",
        ref_no: newNo,
        plant_id: p.plant_id,
        product_name: product,
        change_qty: -qtyCm,
        date: p.date,
        note: interPlant ? `Inter-plant sale to ${await plantName(toPlantId)}` : "Direct sale to customer"
      });
      if (await finishedBalance(d, old.plant_id, old.product_name) < 0)
        throw new Error("Edit would make finished goods stock negative.");
      if (await finishedBalance(d, p.plant_id, product) < 0)
        throw new Error("Edit would make finished goods stock negative.");
    }
    if (interPlant) {
      const purchaseId = await createMirrorPurchase(p.plant_id, toPlantId, p.id, product, qtyCm, amount, p.date);
      await d.prepare(`UPDATE dispatches SET linked_purchase_id=? WHERE id=?`).run(purchaseId, p.id);
    }
  });
  return await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(p.id);
}
async function setRate(payload) {
  const d = getDb();
  const row = await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(payload.id);
  const billableQty = row.sale_quantity != null ? row.sale_quantity : row.quantity;
  const amount = computeAmount2(payload.rate, billableQty);
  const billed = (amount ?? 0) + (row.transport_billed ? Number(row.transport_charge) || 0 : 0) + (row.other_billed ? Number(row.other_charge) || 0 : 0);
  const status = derivePaymentStatus(billed, Number(row.paid_amount) || 0);
  await d.transaction(async () => {
    await d.prepare(`UPDATE dispatches SET rate=?, amount=?, payment_status=? WHERE id=?`).run(payload.rate, amount, status, payload.id);
    if (row.linked_purchase_id && amount != null && row.qty_cm > 0) {
      const ratePerCm = round23(amount / row.qty_cm);
      await d.prepare(`UPDATE purchases SET rate=?, amount=? WHERE id=?`).run(ratePerCm, amount, row.linked_purchase_id);
    }
  });
  return await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(payload.id);
}
async function setDelivery(payload) {
  const d = getDb();
  await d.prepare(`UPDATE dispatches SET delivery_status=? WHERE id=?`).run(
    payload.delivery_status,
    payload.id
  );
  return await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(payload.id);
}
async function setDispatch(payload) {
  const d = getDb();
  const status = payload.dispatch_status === "dispatched" ? "dispatched" : "pending";
  await d.prepare(`UPDATE dispatches SET dispatch_status=? WHERE id=?`).run(status, payload.id);
  return await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(payload.id);
}
async function setPayment(payload) {
  const d = getDb();
  const row = await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(payload.id);
  if (!row) throw new Error("Sale not found.");
  const billed = (row.amount ?? 0) + (row.transport_billed ? Number(row.transport_charge) || 0 : 0) + (row.other_billed ? Number(row.other_charge) || 0 : 0);
  const paid = Number(payload.paid_amount) || 0;
  await d.prepare(`UPDATE dispatches SET paid_amount=?, payment_status=? WHERE id=?`).run(
    paid,
    derivePaymentStatus(billed, paid),
    payload.id
  );
  return await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(payload.id);
}
async function deleteDispatch(payload) {
  const d = getDb();
  const old = await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(payload.id);
  if (!old) return { ok: false, error: "Sale not found." };
  try {
    await d.transaction(async () => {
      if (old.linked_purchase_id) await removeLinkedPurchase(old.linked_purchase_id);
      await d.prepare(`DELETE FROM stock_movements WHERE ref_no=? AND type='dispatch'`).run(old.dispatch_no);
      await d.prepare(`DELETE FROM dispatch_transporters WHERE dispatch_id = ?`).run(payload.id);
      await d.prepare(`DELETE FROM dispatch_machines WHERE dispatch_id = ?`).run(payload.id);
      await d.prepare(`DELETE FROM dispatches WHERE id = ?`).run(payload.id);
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// src/main/services/transporters.ts
async function listTransporters(payload = {}) {
  const d = getDb();
  const clause = payload.plant_id ? `WHERE ${plantScopeSql("t", "transporter")}` : "";
  const rows = await d.prepare(
    `SELECT t.*, co.name AS company_name, pl.name AS plant_name
       FROM transporters t
       LEFT JOIN companies co ON co.id = t.company_id
       LEFT JOIN plants pl ON pl.id = t.plant_id
       ${clause}
       ORDER BY t.name`
  ).all(payload);
  await attachPartyPlants(d, "transporter", rows);
  for (const t of rows) {
    const agg = await d.prepare(
      `SELECT
           COALESCE(SUM(trips),0) AS trips,
           COALESCE(SUM(total_cm),0) AS cm,
           COALESCE(SUM(amount),0) AS amt,
           COALESCE(SUM(diesel_amount),0) AS diesel
         FROM (
           SELECT trips, total_cm, amount, diesel_amount FROM rack_loadings WHERE transporter_id = @id
           UNION ALL
           SELECT trips, total_cm, amount, diesel_amount FROM rack_unloadings WHERE transporter_id = @id
         ) AS u`
    ).get({ id: t.id });
    const pay = await d.prepare(
      `SELECT
           COALESCE(SUM(CASE WHEN direction='out' THEN amount ELSE 0 END),0) AS paid,
           COALESCE(SUM(CASE WHEN direction='in' THEN amount ELSE 0 END),0) AS recvd
         FROM payments WHERE party_type='transporter' AND party_id = ?`
    ).get(t.id);
    t.total_trips = round7(agg.trips);
    t.total_cm = round7(agg.cm);
    t.total_amount = round7(agg.amt);
    t.diesel_amount = round7(agg.diesel);
    t.paid_amount = round7(pay.paid);
    t.balance_amount = round7(agg.amt - agg.diesel - pay.paid + pay.recvd);
  }
  return rows;
}
async function createTransporter(p) {
  const d = getDb();
  await ensureUniqueName("transporters", p.name, { label: "A transporter" });
  const plants = plantIdSet(p);
  const id = await d.transaction(async () => {
    const info = await d.prepare(
      `INSERT INTO transporters (name, contact, address, remarks, company_id, plant_id) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      properCase(p.name),
      p.contact ?? "",
      p.address ?? "",
      p.remarks ?? "",
      p.company_id ?? null,
      plants[0] ?? null
    );
    const tid = Number(info.lastInsertRowid);
    await writePartyPlants(d, "transporter", tid, plants);
    return tid;
  });
  const row = await d.prepare(`SELECT * FROM transporters WHERE id = ?`).get(id);
  await attachPartyPlants(d, "transporter", [row]);
  return row;
}
async function updateTransporter(p) {
  const d = getDb();
  await ensureUniqueName("transporters", p.name, { id: p.id, label: "A transporter" });
  const plants = plantIdSet(p);
  await d.transaction(async () => {
    await d.prepare(
      `UPDATE transporters SET name=?, contact=?, address=?, remarks=?, company_id=?, plant_id=? WHERE id=?`
    ).run(
      properCase(p.name),
      p.contact ?? "",
      p.address ?? "",
      p.remarks ?? "",
      p.company_id ?? null,
      plants[0] ?? null,
      p.id
    );
    await writePartyPlants(d, "transporter", p.id, plants);
  });
  const row = await d.prepare(`SELECT * FROM transporters WHERE id = ?`).get(p.id);
  await attachPartyPlants(d, "transporter", [row]);
  return row;
}
async function deleteTransporter(payload) {
  const d = getDb();
  const used = await d.prepare(
    `SELECT
        (SELECT COUNT(*) FROM rack_loadings WHERE transporter_id = @id) +
        (SELECT COUNT(*) FROM rack_unloadings WHERE transporter_id = @id) AS c`
  ).get({ id: payload.id });
  if (used.c > 0) {
    return { ok: false, error: "Cannot delete: this transporter has rack loading/unloading records." };
  }
  const paid = await d.prepare(`SELECT COUNT(*) AS c FROM payments WHERE party_type='transporter' AND party_id = ?`).get(payload.id);
  if (paid.c > 0) {
    return { ok: false, error: "Cannot delete: this transporter has payment records." };
  }
  await d.transaction(async () => {
    await d.prepare(`DELETE FROM transporter_plants WHERE transporter_id = ?`).run(payload.id);
    await d.prepare(`DELETE FROM transporters WHERE id = ?`).run(payload.id);
  });
  return { ok: true };
}
function round7(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// src/main/services/transporterFleet.ts
function numOrNull(v) {
  const n = Number(v);
  return v == null || v === "" || isNaN(n) ? null : n;
}
function uomOf(v) {
  return v === "TON" || v === "CFT" ? v : "CM";
}
async function listTransporterFleet(payload) {
  const d = getDb();
  const where = ["transporter_id = @transporter_id"];
  if (payload.kind) where.push("kind = @kind");
  return await d.prepare(`SELECT * FROM transporter_fleet WHERE ${where.join(" AND ")} ORDER BY kind, name`).all(payload);
}
async function createTransporterFleet(p) {
  const d = getDb();
  if (!p.transporter_id) throw new Error("Missing transporter.");
  const kind = p.kind === "jcb" ? "jcb" : "vehicle";
  const name = properCase(p.name || "");
  if (!name) throw new Error(kind === "jcb" ? "JCB name / no. is required." : "Vehicle no. is required.");
  const info = await d.prepare(
    `INSERT INTO transporter_fleet
        (transporter_id, kind, name, driver_name, driver_mobile, cap_cm, cap_ton, cap_cft, rate_per_trip, rate_per_unit, rate_unit_uom, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    p.transporter_id,
    kind,
    name,
    properCase(p.driver_name || ""),
    (p.driver_mobile || "").trim(),
    numOrNull(p.cap_cm),
    numOrNull(p.cap_ton),
    numOrNull(p.cap_cft),
    numOrNull(p.rate_per_trip),
    numOrNull(p.rate_per_unit),
    uomOf(p.rate_unit_uom),
    p.remarks ?? ""
  );
  return await d.prepare(`SELECT * FROM transporter_fleet WHERE id = ?`).get(info.lastInsertRowid);
}
async function updateTransporterFleet(p) {
  const d = getDb();
  if (!p.id) throw new Error("Missing fleet item id.");
  const name = properCase(p.name || "");
  if (!name) throw new Error("Name / no. is required.");
  await d.prepare(
    `UPDATE transporter_fleet SET
         name=?, driver_name=?, driver_mobile=?, cap_cm=?, cap_ton=?, cap_cft=?,
         rate_per_trip=?, rate_per_unit=?, rate_unit_uom=?, remarks=?
       WHERE id=?`
  ).run(
    name,
    properCase(p.driver_name || ""),
    (p.driver_mobile || "").trim(),
    numOrNull(p.cap_cm),
    numOrNull(p.cap_ton),
    numOrNull(p.cap_cft),
    numOrNull(p.rate_per_trip),
    numOrNull(p.rate_per_unit),
    uomOf(p.rate_unit_uom),
    p.remarks ?? "",
    p.id
  );
  return await d.prepare(`SELECT * FROM transporter_fleet WHERE id = ?`).get(p.id);
}
async function deleteTransporterFleet(payload) {
  await getDb().prepare(`DELETE FROM transporter_fleet WHERE id = ?`).run(payload.id);
  return { ok: true };
}

// src/main/services/companies.ts
var ROLE_DELETE = {
  suppliers: deleteSupplier,
  customers: deleteCustomer,
  transporters: deleteTransporter
};
var ROLE_PTYPE = {
  suppliers: "supplier",
  customers: "customer",
  transporters: "transporter"
};
async function ensureRoleParty(d, table, companyId, name, contact, address, plants) {
  const exist = await d.prepare(`SELECT id, company_id FROM ${table} WHERE name = ?`).get(name);
  if (exist) {
    if (exist.company_id == null) {
      await d.prepare(`UPDATE ${table} SET company_id = ? WHERE id = ?`).run(companyId, exist.id);
      await writePartyPlants(d, ROLE_PTYPE[table], exist.id, plants);
    }
    return;
  }
  const r = await d.prepare(`INSERT INTO ${table} (name, contact, address, remarks, company_id, plant_id) VALUES (?, ?, ?, '', ?, ?)`).run(name, contact, address, companyId, plants[0] ?? null);
  await writePartyPlants(d, ROLE_PTYPE[table], Number(r.lastInsertRowid), plants);
}
async function syncRole(d, companyId, table, flag, name, contact, address, plants) {
  if (flag === void 0) return;
  const existing = await d.prepare(`SELECT id FROM ${table} WHERE company_id = ?`).all(companyId);
  if (flag) {
    if (existing.length === 0) await ensureRoleParty(d, table, companyId, name, contact, address, plants);
  } else {
    for (const e of existing) await ROLE_DELETE[table]({ id: e.id });
  }
}
async function listCompanies() {
  const d = getDb();
  const rows = await d.prepare(`SELECT * FROM companies ORDER BY name`).all();
  await attachPartyPlants(d, "company", rows);
  for (const c of rows) {
    const roles = [];
    const asCustomer = await d.prepare(`SELECT COUNT(*) AS n FROM customers WHERE company_id = ?`).get(c.id);
    const asSupplier = await d.prepare(`SELECT COUNT(*) AS n FROM suppliers WHERE company_id = ?`).get(c.id);
    const asTransporter = await d.prepare(`SELECT COUNT(*) AS n FROM transporters WHERE company_id = ?`).get(c.id);
    if (asCustomer.n) roles.push("Customer");
    if (asSupplier.n) roles.push("Supplier");
    if (asTransporter.n) roles.push("Transporter");
    c.roles = roles;
  }
  return rows;
}
async function createCompany(p) {
  const d = getDb();
  if (!p.name?.trim()) throw new Error("Company name is required.");
  await ensureUniqueName("companies", p.name, { label: "A company" });
  const name = properCase(p.name);
  const contact = p.contact ?? "";
  const address = p.address ?? "";
  const plants = plantIdSet(p);
  const id = await d.transaction(async () => {
    const info = await d.prepare(`INSERT INTO companies (name, contact, address, remarks) VALUES (?, ?, ?, ?)`).run(name, contact, address, p.remarks ?? "");
    const companyId = Number(info.lastInsertRowid);
    await writePartyPlants(d, "company", companyId, plants);
    if (p.as_supplier !== false) await ensureRoleParty(d, "suppliers", companyId, name, contact, address, plants);
    if (p.as_customer !== false) await ensureRoleParty(d, "customers", companyId, name, contact, address, plants);
    if (p.as_transporter !== false) await ensureRoleParty(d, "transporters", companyId, name, contact, address, plants);
    return companyId;
  });
  const row = await d.prepare(`SELECT * FROM companies WHERE id = ?`).get(id);
  await attachPartyPlants(d, "company", [row]);
  return row;
}
async function updateCompany(p) {
  const d = getDb();
  if (!p.name?.trim()) throw new Error("Company name is required.");
  await ensureUniqueName("companies", p.name, { id: p.id, label: "A company" });
  const name = properCase(p.name);
  const contact = p.contact ?? "";
  const address = p.address ?? "";
  const plants = plantIdSet(p);
  await d.transaction(async () => {
    await d.prepare(`UPDATE companies SET name=?, contact=?, address=?, remarks=? WHERE id=?`).run(
      name,
      contact,
      address,
      p.remarks ?? "",
      p.id
    );
    await writePartyPlants(d, "company", p.id, plants);
    await syncRole(d, p.id, "suppliers", p.as_supplier, name, contact, address, plants);
    await syncRole(d, p.id, "customers", p.as_customer, name, contact, address, plants);
    await syncRole(d, p.id, "transporters", p.as_transporter, name, contact, address, plants);
  });
  const row = await d.prepare(`SELECT * FROM companies WHERE id = ?`).get(p.id);
  await attachPartyPlants(d, "company", [row]);
  return row;
}
async function deleteCompany(payload) {
  const d = getDb();
  await d.transaction(async () => {
    await d.prepare(`UPDATE customers SET company_id = NULL WHERE company_id = ?`).run(payload.id);
    await d.prepare(`UPDATE suppliers SET company_id = NULL WHERE company_id = ?`).run(payload.id);
    await d.prepare(`UPDATE transporters SET company_id = NULL WHERE company_id = ?`).run(payload.id);
    await d.prepare(`DELETE FROM company_plants WHERE company_id = ?`).run(payload.id);
    await d.prepare(`DELETE FROM companies WHERE id = ?`).run(payload.id);
  });
  return { ok: true };
}

// src/main/services/diesel.ts
function money2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function litres(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
async function dieselStock(payload = {}) {
  return stockOf(getDb(), payload.plant_id);
}
async function avgDieselRate() {
  const r = await getDb().prepare(
    `SELECT COALESCE(SUM(amount),0) AS amt, COALESCE(SUM(litres),0) AS lit
       FROM diesel_purchases WHERE amount IS NOT NULL`
  ).get();
  return r.lit > 0 ? r.amt / r.lit : 0;
}
async function issuedLitres(d, plantId, exclude) {
  const pid = plantId;
  const ex = (src, col = "id") => exclude && exclude.src === src ? ` AND ${col} <> ${Number(exclude.id)}` : "";
  const issuesWhere = pid ? "WHERE plant_id = @pid" : "WHERE 1=1";
  const a = await d.prepare(`SELECT COALESCE(SUM(litres),0) AS q FROM diesel_issues ${issuesWhere}${ex("issue")}`).get({ pid });
  const b = await d.prepare(`SELECT COALESCE(SUM(diesel_litres),0) AS q FROM rack_loadings ${issuesWhere}${ex("loading")}`).get({ pid });
  const uWhere = pid ? "WHERE r.plant_id = @pid" : "WHERE 1=1";
  const c = await d.prepare(`SELECT COALESCE(SUM(ru.diesel_litres),0) AS q FROM rack_unloadings ru JOIN racks r ON r.id = ru.rack_id ${uWhere}${ex("unloading", "ru.id")}`).get({ pid });
  const e = await d.prepare(
    `SELECT COALESCE(SUM(rst.diesel_litres),0) AS q FROM rack_sale_transporters rst
         JOIN rack_sales rs ON rs.id = rst.rack_sale_id JOIN racks r ON r.id = rs.rack_id ${uWhere}${ex("sale_transport", "rst.id")}`
  ).get({ pid });
  return litres((a.q || 0) + (b.q || 0) + (c.q || 0) + (e.q || 0));
}
async function stockOf(d, plantId) {
  const pAnd = plantId ? " WHERE plant_id = @pid" : "";
  const p = (await d.prepare(`SELECT COALESCE(SUM(litres),0) AS q FROM diesel_purchases${pAnd}`).get({ pid: plantId })).q;
  const i = await issuedLitres(d, plantId);
  return { purchased: litres(p), issued: litres(i), balance: litres(p - i) };
}
async function dieselFifoCost(d, plantId, qty, exclude) {
  const q = litres(Number(qty) || 0);
  const purchased = (await d.prepare(`SELECT COALESCE(SUM(litres),0) AS q FROM diesel_purchases WHERE plant_id = @pid`).get({ pid: plantId })).q;
  const prior = await issuedLitres(d, plantId, exclude);
  const available = litres(purchased - prior);
  if (q <= 0) return { amount: 0, rate: 0, available };
  if (q > available + 1e-3)
    throw new Error(`Not enough diesel in stock for this plant. Available: ${available} L, requested: ${q} L.`);
  const layers = await d.prepare(`SELECT litres, rate FROM diesel_purchases WHERE plant_id = @pid ORDER BY date, id`).all({ pid: plantId });
  let skip = prior;
  let need = q;
  let cost = 0;
  for (const layer of layers) {
    let avail = Number(layer.litres) || 0;
    if (skip > 0) {
      const s = Math.min(skip, avail);
      skip -= s;
      avail -= s;
    }
    if (avail <= 0 || need <= 0) continue;
    const take = Math.min(avail, need);
    cost += take * (layer.rate ?? 0);
    need -= take;
  }
  const amount = money2(cost);
  return { amount, rate: q > 0 ? money2(amount / q) : 0, available };
}
async function dieselFifoQuote(payload) {
  if (!payload.plant_id) return { amount: 0, rate: 0, available: 0 };
  try {
    return await dieselFifoCost(getDb(), Number(payload.plant_id), Number(payload.litres) || 0, payload.exclude);
  } catch {
    const d = getDb();
    const purchased = (await d.prepare(`SELECT COALESCE(SUM(litres),0) AS q FROM diesel_purchases WHERE plant_id=@pid`).get({ pid: payload.plant_id })).q;
    const prior = await issuedLitres(d, Number(payload.plant_id), payload.exclude);
    return { amount: 0, rate: 0, available: litres(purchased - prior) };
  }
}
async function listDieselPurchases(filter = {}) {
  const d = getDb();
  const where = [];
  const params = {};
  if (filter.plant_id) {
    where.push("dp.plant_id = @plant_id");
    params.plant_id = filter.plant_id;
  }
  if (filter.supplier_id) {
    where.push("dp.supplier_id = @supplier_id");
    params.supplier_id = filter.supplier_id;
  }
  if (filter.from) {
    where.push("dp.date >= @from");
    params.from = filter.from;
  }
  if (filter.to) {
    where.push("dp.date <= @to");
    params.to = filter.to;
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return await d.prepare(
    `SELECT dp.*, s.name AS supplier_name, p.name AS plant_name
       FROM diesel_purchases dp
       JOIN suppliers s ON s.id = dp.supplier_id
       JOIN plants p ON p.id = dp.plant_id
       ${clause}
       ORDER BY dp.date DESC, dp.id DESC`
  ).all(params);
}
function purchaseFields(p) {
  if (!(Number(p.litres) > 0)) throw new Error("Litres must be greater than 0.");
  const rate = p.rate == null || p.rate === "" ? null : Number(p.rate);
  const amount = rate == null ? null : money2(Number(p.litres) * rate);
  const paid = money2(Number(p.paid_amount) || 0);
  return {
    supplier_id: p.supplier_id,
    plant_id: p.plant_id,
    litres: litres(Number(p.litres)),
    rate,
    amount,
    payment_status: derivePaymentStatus(amount ?? 0, paid),
    paid_amount: paid,
    date: p.date,
    remarks: p.remarks ?? ""
  };
}
async function createDieselPurchase(p) {
  const d = getDb();
  const fields = purchaseFields(p);
  const no = await nextNumber("DSL", "diesel_purchase");
  const info = await d.prepare(
    `INSERT INTO diesel_purchases
        (purchase_no, supplier_id, plant_id, litres, rate, amount, payment_status, paid_amount, date, remarks)
       VALUES (@purchase_no,@supplier_id,@plant_id,@litres,@rate,@amount,@payment_status,@paid_amount,@date,@remarks)`
  ).run({ purchase_no: no, ...fields });
  return await d.prepare(`SELECT * FROM diesel_purchases WHERE id = ?`).get(info.lastInsertRowid);
}
async function updateDieselPurchase(p) {
  const d = getDb();
  if (!p.id) throw new Error("Missing purchase id.");
  const fields = purchaseFields(p);
  await d.transaction(async () => {
    await d.prepare(
      `UPDATE diesel_purchases SET supplier_id=@supplier_id, plant_id=@plant_id, litres=@litres, rate=@rate,
         amount=@amount, payment_status=@payment_status, paid_amount=@paid_amount, date=@date, remarks=@remarks
       WHERE id=@id`
    ).run({ id: p.id, ...fields });
    if ((await stockOf(d, Number(fields.plant_id))).balance < 0)
      throw new Error("Edit would make diesel stock negative (more issued than purchased).");
  });
  return await d.prepare(`SELECT * FROM diesel_purchases WHERE id = ?`).get(p.id);
}
async function deleteDieselPurchase(payload) {
  const d = getDb();
  const old = await d.prepare(`SELECT * FROM diesel_purchases WHERE id = ?`).get(payload.id);
  if (!old) return { ok: false, error: "Purchase not found." };
  try {
    await d.transaction(async () => {
      await d.prepare(`DELETE FROM diesel_purchases WHERE id = ?`).run(payload.id);
      if ((await stockOf(d, old.plant_id)).balance < 0)
        throw new Error("Cannot delete: diesel from this purchase has already been issued.");
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
async function listDieselIssues(filter = {}) {
  const d = getDb();
  const where = [];
  const params = {};
  if (filter.plant_id) {
    where.push("di.plant_id = @plant_id");
    params.plant_id = filter.plant_id;
  }
  if (filter.asset_id) {
    where.push("di.asset_id = @asset_id");
    params.asset_id = filter.asset_id;
  }
  if (filter.from) {
    where.push("di.date >= @from");
    params.from = filter.from;
  }
  if (filter.to) {
    where.push("di.date <= @to");
    params.to = filter.to;
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return await d.prepare(
    `SELECT di.*, p.name AS plant_name, a.name AS asset_name, t.name AS transporter_name
       FROM diesel_issues di
       JOIN plants p ON p.id = di.plant_id
       LEFT JOIN assets a ON a.id = di.asset_id
       LEFT JOIN transporters t ON t.id = di.transporter_id
       ${clause}
       ORDER BY di.date DESC, di.id DESC`
  ).all(params);
}
async function createDieselIssue(p) {
  const d = getDb();
  if (!(Number(p.litres) > 0)) throw new Error("Litres must be greater than 0.");
  return d.transaction(async () => {
    const fifo = await dieselFifoCost(d, Number(p.plant_id), Number(p.litres));
    const transporter_id = p.transporter_id ? Number(p.transporter_id) : null;
    const charged = transporter_id && p.charged ? 1 : 0;
    const no = await nextNumber("DIS", "diesel_issue");
    const info = await d.prepare(
      `INSERT INTO diesel_issues (issue_no, plant_id, asset_id, transporter_id, litres, rate, amount, charged, date, remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(no, p.plant_id, p.asset_id ?? null, transporter_id, litres(Number(p.litres)), fifo.rate, fifo.amount, charged, p.date, p.remarks ?? "");
    return await d.prepare(`SELECT * FROM diesel_issues WHERE id = ?`).get(info.lastInsertRowid);
  });
}
async function updateDieselIssue(p) {
  const d = getDb();
  if (!p.id) throw new Error("Missing issue id.");
  if (!(Number(p.litres) > 0)) throw new Error("Litres must be greater than 0.");
  await d.transaction(async () => {
    const fifo = await dieselFifoCost(d, Number(p.plant_id), Number(p.litres), { src: "issue", id: p.id });
    const transporter_id = p.transporter_id ? Number(p.transporter_id) : null;
    const charged = transporter_id && p.charged ? 1 : 0;
    await d.prepare(
      `UPDATE diesel_issues SET plant_id=?, asset_id=?, transporter_id=?, litres=?, rate=?, amount=?, charged=?, date=?, remarks=? WHERE id=?`
    ).run(
      p.plant_id,
      p.asset_id ?? null,
      transporter_id,
      litres(Number(p.litres)),
      fifo.rate,
      fifo.amount,
      charged,
      p.date,
      p.remarks ?? "",
      p.id
    );
  });
  return await d.prepare(`SELECT * FROM diesel_issues WHERE id = ?`).get(p.id);
}
async function deleteDieselIssue(payload) {
  const d = getDb();
  await d.prepare(`DELETE FROM diesel_issues WHERE id = ?`).run(payload.id);
  return { ok: true };
}
async function listDieselIssuesAll(payload = {}) {
  const d = getDb();
  const pid = payload.plant_id ? Number(payload.plant_id) : 0;
  const dateWhere = (alias) => `${payload.from ? ` AND ${alias}.date >= @from` : ""}${payload.to ? ` AND ${alias}.date <= @to` : ""}`;
  const params = {};
  if (pid) params.pid = pid;
  if (payload.from) params.from = payload.from;
  if (payload.to) params.to = payload.to;
  const rows = [];
  const di = await d.prepare(
    `SELECT di.id, di.issue_no, di.date, di.plant_id, p.name AS plant_name, di.litres,
              di.amount, di.charged, a.name AS asset_name, t.name AS transporter_name
       FROM diesel_issues di
       JOIN plants p ON p.id = di.plant_id
       LEFT JOIN assets a ON a.id = di.asset_id
       LEFT JOIN transporters t ON t.id = di.transporter_id
       WHERE 1=1 ${pid ? "AND di.plant_id = @pid" : ""}${dateWhere("di")} AND COALESCE(di.litres,0) > 0`
  ).all(params);
  for (const x of di)
    rows.push({
      source: "issue",
      source_label: "Issue",
      id: Number(x.id),
      ref_no: String(x.issue_no),
      date: String(x.date),
      plant_id: Number(x.plant_id),
      plant_name: x.plant_name ?? null,
      recipient: x.asset_name || x.transporter_name || "Unassigned",
      context: "",
      litres: Number(x.litres) || 0,
      amount: x.amount == null ? null : Number(x.amount),
      charged_to: x.charged ? x.transporter_name ?? null : null,
      editable: true
    });
  const rl = await d.prepare(
    `SELECT rl.id, rl.loading_no, rl.date, rl.plant_id, p.name AS plant_name, rl.diesel_litres AS litres,
              rl.diesel_amount AS amount, rl.diesel_charged, rl.vehicle_no, t.name AS transporter_name, r.rack_no
       FROM rack_loadings rl
       JOIN plants p ON p.id = rl.plant_id
       JOIN racks r ON r.id = rl.rack_id
       LEFT JOIN transporters t ON t.id = rl.transporter_id
       WHERE COALESCE(rl.diesel_litres,0) > 0 ${pid ? "AND rl.plant_id = @pid" : ""}${dateWhere("rl")}`
  ).all(params);
  for (const x of rl)
    rows.push({
      source: "rack_loading",
      source_label: "Rack Loading",
      id: Number(x.id),
      ref_no: String(x.loading_no),
      date: String(x.date),
      plant_id: Number(x.plant_id),
      plant_name: x.plant_name ?? null,
      recipient: x.transporter_name || x.vehicle_no || "\u2014",
      context: `Rack ${x.rack_no} \xB7 loading`,
      litres: Number(x.litres) || 0,
      amount: x.amount == null ? null : Number(x.amount),
      charged_to: x.diesel_charged ? x.transporter_name ?? null : null,
      editable: false
    });
  const ru = await d.prepare(
    `SELECT ru.id, ru.unloading_no, ru.date, r.plant_id, p.name AS plant_name, ru.diesel_litres AS litres,
              ru.diesel_amount AS amount, ru.diesel_charged, r.rack_no,
              COALESCE(rv.vehicle_no, rj.name, t.name) AS carrier
       FROM rack_unloadings ru
       JOIN racks r ON r.id = ru.rack_id
       LEFT JOIN plants p ON p.id = r.plant_id
       LEFT JOIN rack_vehicles rv ON rv.id = ru.rack_vehicle_id
       LEFT JOIN rack_jcbs rj ON rj.id = ru.rack_jcb_id
       LEFT JOIN transporters t ON t.id = ru.transporter_id
       WHERE COALESCE(ru.diesel_litres,0) > 0 ${pid ? "AND r.plant_id = @pid" : ""}${dateWhere("ru")}`
  ).all(params);
  for (const x of ru)
    rows.push({
      source: "rack_unloading",
      source_label: "Rack Unloading",
      id: Number(x.id),
      ref_no: String(x.unloading_no),
      date: String(x.date),
      plant_id: x.plant_id == null ? null : Number(x.plant_id),
      plant_name: x.plant_name ?? null,
      recipient: x.carrier || "\u2014",
      context: `Rack ${x.rack_no} \xB7 unloading`,
      litres: Number(x.litres) || 0,
      amount: x.amount == null ? null : Number(x.amount),
      charged_to: x.diesel_charged ? x.carrier ?? null : null,
      editable: false
    });
  const rst = await d.prepare(
    `SELECT rst.id, rs.sale_no, rs.date, r.plant_id, p.name AS plant_name, rst.diesel_litres AS litres,
              rst.diesel_amount AS amount, rst.diesel_charged, r.rack_no,
              COALESCE(t.name, rv.vehicle_no) AS carrier
       FROM rack_sale_transporters rst
       JOIN rack_sales rs ON rs.id = rst.rack_sale_id
       JOIN racks r ON r.id = rs.rack_id
       LEFT JOIN plants p ON p.id = r.plant_id
       LEFT JOIN transporters t ON t.id = rst.transporter_id
       LEFT JOIN rack_vehicles rv ON rv.id = rst.rack_vehicle_id
       WHERE COALESCE(rst.diesel_litres,0) > 0 ${pid ? "AND r.plant_id = @pid" : ""}${dateWhere("rs")}`
  ).all(params);
  for (const x of rst)
    rows.push({
      source: "rack_sale",
      source_label: "Rack Sale",
      id: Number(x.id),
      ref_no: String(x.sale_no),
      date: String(x.date),
      plant_id: x.plant_id == null ? null : Number(x.plant_id),
      plant_name: x.plant_name ?? null,
      recipient: x.carrier || "\u2014",
      context: `Rack ${x.rack_no} \xB7 sale`,
      litres: Number(x.litres) || 0,
      amount: x.amount == null ? null : Number(x.amount),
      charged_to: x.diesel_charged ? x.carrier ?? null : null,
      editable: false
    });
  rows.sort((a, b) => a.date === b.date ? b.ref_no.localeCompare(a.ref_no) : b.date.localeCompare(a.date));
  return rows;
}
async function issuesByAsset(payload = {}) {
  const d = getDb();
  const clause = payload.plant_id ? "WHERE di.plant_id = @plant_id" : "";
  return await d.prepare(
    `SELECT di.asset_id, COALESCE(a.name, 'Unassigned') AS asset_name,
        ROUND(COALESCE(SUM(di.litres),0),2) AS litres
       FROM diesel_issues di LEFT JOIN assets a ON a.id = di.asset_id
       ${clause}
       GROUP BY di.asset_id, a.name ORDER BY litres DESC`
  ).all(payload);
}

// src/main/services/racks.ts
async function rackDiesel(d, plantId, dieselLitres, exclude) {
  const dl = dieselLitres == null || dieselLitres === "" ? null : Number(dieselLitres);
  if (!dl || !(dl > 0)) return { litres: null, amount: null };
  if (!plantId) throw new Error("Set the source plant before issuing diesel (so it can draw from that plant\u2019s stock).");
  const f = await dieselFifoCost(d, Number(plantId), dl, exclude);
  return { litres: roundQty3(dl), amount: f.amount };
}
async function rackPlantFactors(d, rackId) {
  const row = await d.prepare(`SELECT plant_id FROM rack_loadings WHERE rack_id = ? ORDER BY id LIMIT 1`).get(rackId);
  return plantUomFactors(row?.plant_id);
}
var RACK_STATUSES = ["loading", "in_transit", "reached", "closed"];
function roundQty3(n) {
  return Math.round((n + Number.EPSILON) * 1e3) / 1e3;
}
function roundMoney(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function computeAmount3(rate, qty) {
  if (rate == null || isNaN(rate)) return null;
  return roundMoney(rate * qty);
}
var RACK_AGG = `
  COALESCE((SELECT SUM(total_cm) FROM rack_loadings WHERE rack_id = r.id),0) AS loaded_cm,
  COALESCE((SELECT SUM(qty_cm) FROM rack_unloadings WHERE rack_id = r.id),0) AS unloaded_cm,
  COALESCE((SELECT SUM(amount) FROM rack_loadings WHERE rack_id = r.id),0)
    + COALESCE((SELECT SUM(amount) FROM rack_unloadings WHERE rack_id = r.id),0)
    + COALESCE((SELECT SUM(rst.charge) FROM rack_sale_transporters rst
         JOIN rack_sales rs ON rs.id = rst.rack_sale_id WHERE rs.rack_id = r.id),0) AS transport_cost,
  COALESCE((SELECT SUM(amount) FROM rack_expenses WHERE rack_id = r.id),0)
    + COALESCE((SELECT SUM(rsm.amount) FROM rack_sale_machines rsm
         JOIN rack_sales rs ON rs.id = rsm.rack_sale_id WHERE rs.rack_id = r.id),0) AS expense_total,
  COALESCE((SELECT SUM(qty_cm) FROM rack_sales WHERE rack_id = r.id),0) AS sold_cm,
  COALESCE((SELECT SUM(amount) FROM rack_sales WHERE rack_id = r.id),0) AS sales_amount,
  (SELECT name FROM plants WHERE id = r.plant_id) AS plant_name`;
function decorate(r) {
  r.loaded_cm = roundQty3(r.loaded_cm ?? 0);
  r.unloaded_cm = roundQty3(r.unloaded_cm ?? 0);
  r.sold_cm = roundQty3(r.sold_cm ?? 0);
  r.balance_cm = roundQty3(r.loaded_cm - r.sold_cm);
  r.transit_shortage_cm = roundQty3(r.loaded_cm - r.unloaded_cm);
  r.shortage_cm = r.status === "closed" ? r.balance_cm : 0;
  r.transport_cost = roundMoney(r.transport_cost ?? 0);
  r.expense_total = roundMoney(r.expense_total ?? 0);
  r.sales_amount = roundMoney(r.sales_amount ?? 0);
  r.profit = roundMoney(r.sales_amount - r.transport_cost - r.expense_total);
  return r;
}
async function listRacks(filter = {}) {
  const d = getDb();
  const where = [];
  const params = {};
  if (filter.status) {
    where.push("r.status = @status");
    params.status = filter.status;
  }
  if (filter.from) {
    where.push("r.date >= @from");
    params.from = filter.from;
  }
  if (filter.to) {
    where.push("r.date <= @to");
    params.to = filter.to;
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await d.prepare(`SELECT r.*, ${RACK_AGG} FROM racks r ${clause} ORDER BY r.date DESC, r.id DESC`).all(params);
  return rows.map(decorate);
}
async function getRack(d, id) {
  const row = await d.prepare(`SELECT r.*, ${RACK_AGG} FROM racks r WHERE r.id = ?`).get(id);
  if (!row) throw new Error("Rack not found.");
  return decorate(row);
}
async function createRack(p) {
  const d = getDb();
  const no = (p.rack_no || "").trim();
  if (!no) throw new Error("Railway rack no. is required.");
  const dup = await d.prepare(`SELECT id FROM racks WHERE rack_no = ?`).get(no);
  if (dup) throw new Error(`Rack "${no}" already exists.`);
  const info = await d.prepare(`INSERT INTO racks (rack_no, destination, plant_id, date, remarks) VALUES (?, ?, ?, ?, ?)`).run(no, properCase(p.destination), p.plant_id ?? null, p.date, p.remarks ?? "");
  return getRack(d, Number(info.lastInsertRowid));
}
async function updateRack(p) {
  const d = getDb();
  const no = (p.rack_no || "").trim();
  if (!no) throw new Error("Railway rack no. is required.");
  const dup = await d.prepare(`SELECT id FROM racks WHERE rack_no = ? AND id <> ?`).get(no, p.id);
  if (dup) throw new Error(`Rack "${no}" already exists.`);
  const old = await d.prepare(`SELECT * FROM racks WHERE id = ?`).get(p.id);
  if (!old) throw new Error("Rack not found.");
  await d.transaction(async () => {
    await d.prepare(`UPDATE racks SET rack_no=?, destination=?, plant_id=?, date=?, remarks=? WHERE id=?`).run(
      no,
      properCase(p.destination),
      p.plant_id ?? null,
      p.date,
      p.remarks ?? "",
      p.id
    );
    if (old.rack_no !== no) {
      await d.prepare(
        `UPDATE stock_movements SET note = ? WHERE type='rack_load' AND ref_no IN
           (SELECT loading_no FROM rack_loadings WHERE rack_id = ?)`
      ).run(`Loaded to rack ${no}`, p.id);
    }
  });
  return getRack(d, p.id);
}
async function setRackStatus(p) {
  const d = getDb();
  if (!RACK_STATUSES.includes(p.status)) throw new Error("Invalid rack status.");
  await d.prepare(`UPDATE racks SET status=? WHERE id=?`).run(p.status, p.id);
  return getRack(d, p.id);
}
async function deleteRack(payload) {
  const d = getDb();
  const counts = await d.prepare(
    `SELECT
        (SELECT COUNT(*) FROM rack_loadings WHERE rack_id = @id) AS l,
        (SELECT COUNT(*) FROM rack_expenses WHERE rack_id = @id) AS e,
        (SELECT COUNT(*) FROM rack_sales WHERE rack_id = @id) AS s`
  ).get({ id: payload.id });
  if (counts.l || counts.e || counts.s) {
    return {
      ok: false,
      error: "Cannot delete: rack has loadings, expenses or sales. Remove them first."
    };
  }
  await d.prepare(`DELETE FROM racks WHERE id = ?`).run(payload.id);
  return { ok: true };
}
async function getRackDetail(payload) {
  const d = getDb();
  const rack = await getRack(d, payload.id);
  const loadings = await d.prepare(
    `SELECT rl.*, p.name AS plant_name, t.name AS transporter_name, r.rack_no
       FROM rack_loadings rl
       JOIN plants p ON p.id = rl.plant_id
       JOIN transporters t ON t.id = rl.transporter_id
       JOIN racks r ON r.id = rl.rack_id
       WHERE rl.rack_id = ?
       ORDER BY rl.date DESC, rl.id DESC`
  ).all(payload.id);
  const unloadings = await d.prepare(
    `SELECT ru.*, r.rack_no, t.name AS transporter_name,
              rv.vehicle_no AS vehicle_name, rj.name AS jcb_name,
              COALESCE(rv.vehicle_no, rj.name, t.name) AS resource_name,
              CASE WHEN ru.rack_vehicle_id IS NOT NULL THEN 'vehicle'
                   WHEN ru.rack_jcb_id IS NOT NULL THEN 'jcb' ELSE NULL END AS resource_type
       FROM rack_unloadings ru
       JOIN racks r ON r.id = ru.rack_id
       LEFT JOIN transporters t ON t.id = ru.transporter_id
       LEFT JOIN rack_vehicles rv ON rv.id = ru.rack_vehicle_id
       LEFT JOIN rack_jcbs rj ON rj.id = ru.rack_jcb_id
       WHERE ru.rack_id = ?
       ORDER BY ru.date DESC, ru.id DESC`
  ).all(payload.id);
  const expenses = await d.prepare(`SELECT * FROM rack_expenses WHERE rack_id = ? ORDER BY date DESC, id DESC`).all(payload.id);
  const sales = await d.prepare(
    `SELECT rs.*, c.name AS customer_name, r.rack_no,
        (SELECT COALESCE(SUM(charge),0) FROM rack_sale_transporters rst WHERE rst.rack_sale_id = rs.id) AS transport_total,
        (SELECT COALESCE(SUM(amount),0) FROM rack_sale_machines rsm WHERE rsm.rack_sale_id = rs.id) AS machine_total
       FROM rack_sales rs
       JOIN customers c ON c.id = rs.customer_id
       JOIN racks r ON r.id = rs.rack_id
       WHERE rs.rack_id = ?
       ORDER BY rs.date DESC, rs.id DESC`
  ).all(payload.id);
  const products = await d.prepare(
    `SELECT product_name,
        ROUND(COALESCE(SUM(loaded),0),3) AS loaded_cm,
        ROUND(COALESCE(SUM(unloaded),0),3) AS unloaded_cm,
        ROUND(COALESCE(SUM(sold),0),3) AS sold_cm,
        ROUND(COALESCE(SUM(loaded),0) - COALESCE(SUM(unloaded),0),3) AS transit_shortage_cm,
        ROUND(COALESCE(SUM(unloaded),0) - COALESCE(SUM(sold),0),3) AS balance_cm
       FROM (
         SELECT product_name, total_cm AS loaded, 0 AS unloaded, 0 AS sold FROM rack_loadings WHERE rack_id = @id
         UNION ALL
         SELECT product_name, 0 AS loaded, qty_cm AS unloaded, 0 AS sold FROM rack_unloadings WHERE rack_id = @id
         UNION ALL
         SELECT product_name, 0 AS loaded, 0 AS unloaded, qty_cm AS sold FROM rack_sales WHERE rack_id = @id
       ) AS m
       GROUP BY product_name ORDER BY product_name`
  ).all({ id: payload.id });
  return { rack, loadings, unloadings, expenses, sales, products };
}
async function loadedOf(d, rackId, productName) {
  return (await d.prepare(
    `SELECT COALESCE(SUM(total_cm),0) AS q FROM rack_loadings WHERE rack_id=? AND product_name=?`
  ).get(rackId, productName)).q;
}
async function unloadedOf(d, rackId, productName, excludeId) {
  return (await d.prepare(
    `SELECT COALESCE(SUM(qty_cm),0) AS q FROM rack_unloadings
         WHERE rack_id=? AND product_name=? ${excludeId ? "AND id <> ?" : ""}`
  ).get(...excludeId ? [rackId, productName, excludeId] : [rackId, productName])).q;
}
async function soldOf(d, rackId, productName, excludeId) {
  return (await d.prepare(
    `SELECT COALESCE(SUM(qty_cm),0) AS q FROM rack_sales
         WHERE rack_id=? AND product_name=? ${excludeId ? "AND id <> ?" : ""}`
  ).get(...excludeId ? [rackId, productName, excludeId] : [rackId, productName])).q;
}
async function rackSellable(d, rackId, productName, excludeSaleId) {
  return roundQty3(
    await unloadedOf(d, rackId, productName) - await soldOf(d, rackId, productName, excludeSaleId)
  );
}
async function rackUnloadable(d, rackId, productName, excludeUnloadId) {
  return roundQty3(
    await loadedOf(d, rackId, productName) - await unloadedOf(d, rackId, productName, excludeUnloadId)
  );
}
function resolveLoading(p) {
  let total = Number(p.total_cm) || 0;
  if (!(total > 0)) total = roundQty3((Number(p.trips) || 0) * (Number(p.per_trip_cm) || 0));
  if (!(total > 0)) throw new Error("Total quantity must be greater than 0 (trips \xD7 per-trip m\xB3).");
  return { total: roundQty3(total), amount: computeAmount3(p.rate, total) };
}
async function addLoading(p) {
  const d = getDb();
  const rack = await d.prepare(`SELECT * FROM racks WHERE id = ?`).get(p.rack_id);
  if (!rack) throw new Error("Rack not found.");
  if (rack.status === "closed") throw new Error("Rack is closed. Re-open it to add loadings.");
  if (!p.product_name?.trim()) throw new Error("Product is required.");
  const { total, amount } = resolveLoading(p);
  const outsourced = !!p.outsourced;
  if (!outsourced) {
    const available = await finishedBalance(d, p.plant_id, p.product_name);
    if (total > available)
      throw new Error(
        `Not enough finished goods. Available ${p.product_name}: ${available} m\xB3, requested: ${total} m\xB3.`
      );
  }
  const diesel = await rackDiesel(d, p.plant_id, p.diesel_litres);
  const diesel_charged = diesel.litres && p.transporter_id && p.diesel_charged ? 1 : 0;
  const id = await d.transaction(async () => {
    const no = await nextNumber("RKL", "rack_loading");
    const info = await d.prepare(
      `INSERT INTO rack_loadings
          (loading_no, rack_id, plant_id, product_name, transporter_id, vehicle_no, trips, per_trip_cm,
           total_cm, rate, amount, diesel_litres, diesel_amount, diesel_charged, outsourced, date, remarks)
         VALUES (@loading_no,@rack_id,@plant_id,@product_name,@transporter_id,@vehicle_no,@trips,@per_trip_cm,
           @total_cm,@rate,@amount,@diesel_litres,@diesel_amount,@diesel_charged,@outsourced,@date,@remarks)`
    ).run({
      loading_no: no,
      rack_id: p.rack_id,
      plant_id: p.plant_id,
      product_name: p.product_name.trim(),
      transporter_id: p.transporter_id,
      vehicle_no: p.vehicle_no ?? "",
      trips: Number(p.trips) || 0,
      per_trip_cm: Number(p.per_trip_cm) || 0,
      total_cm: total,
      rate: p.rate,
      amount,
      diesel_litres: diesel.litres,
      diesel_amount: diesel.amount,
      diesel_charged,
      outsourced: outsourced ? 1 : 0,
      date: p.date,
      remarks: p.remarks ?? ""
    });
    if (!outsourced) {
      await addMovement(d, {
        type: "rack_load",
        material_type: "finished",
        ref_no: no,
        plant_id: p.plant_id,
        product_name: p.product_name.trim(),
        change_qty: -total,
        date: p.date,
        note: `Loaded to rack ${rack.rack_no}`
      });
      if (await finishedBalance(d, p.plant_id, p.product_name) < 0)
        throw new Error("Stock cannot go negative.");
    }
    return Number(info.lastInsertRowid);
  });
  return await d.prepare(`SELECT * FROM rack_loadings WHERE id = ?`).get(id);
}
async function updateLoading(p) {
  const d = getDb();
  if (!p.id) throw new Error("Missing loading id.");
  const old = await d.prepare(`SELECT * FROM rack_loadings WHERE id = ?`).get(p.id);
  if (!old) throw new Error("Loading not found.");
  if (!p.product_name?.trim()) throw new Error("Product is required.");
  const { total, amount } = resolveLoading(p);
  const outsourced = !!p.outsourced;
  const diesel = await rackDiesel(d, p.plant_id, p.diesel_litres, { src: "loading", id: p.id });
  const diesel_charged = diesel.litres && p.transporter_id && p.diesel_charged ? 1 : 0;
  await d.transaction(async () => {
    await d.prepare(
      `UPDATE rack_loadings SET plant_id=@plant_id, product_name=@product_name, transporter_id=@transporter_id,
         vehicle_no=@vehicle_no, trips=@trips, per_trip_cm=@per_trip_cm, total_cm=@total_cm,
         rate=@rate, amount=@amount, diesel_litres=@diesel_litres, diesel_amount=@diesel_amount,
         diesel_charged=@diesel_charged, outsourced=@outsourced, date=@date, remarks=@remarks WHERE id=@id`
    ).run({
      id: p.id,
      plant_id: p.plant_id,
      product_name: p.product_name.trim(),
      transporter_id: p.transporter_id,
      vehicle_no: p.vehicle_no ?? "",
      trips: Number(p.trips) || 0,
      per_trip_cm: Number(p.per_trip_cm) || 0,
      total_cm: total,
      rate: p.rate,
      amount,
      diesel_litres: diesel.litres,
      diesel_amount: diesel.amount,
      diesel_charged,
      outsourced: outsourced ? 1 : 0,
      date: p.date,
      remarks: p.remarks ?? ""
    });
    await d.prepare(`DELETE FROM stock_movements WHERE ref_no=? AND type='rack_load'`).run(old.loading_no);
    if (!outsourced) {
      await addMovement(d, {
        type: "rack_load",
        material_type: "finished",
        ref_no: old.loading_no,
        plant_id: p.plant_id,
        product_name: p.product_name.trim(),
        change_qty: -total,
        date: p.date,
        note: `Loaded to rack`
      });
      if (await finishedBalance(d, old.plant_id, old.product_name) < 0)
        throw new Error("Edit would make finished goods stock negative.");
      if (await finishedBalance(d, p.plant_id, p.product_name) < 0)
        throw new Error("Edit would make finished goods stock negative.");
    }
    if (await rackUnloadable(d, old.rack_id, old.product_name) < 0)
      throw new Error("Edit would leave more unloaded than loaded for this product.");
    if (await rackUnloadable(d, old.rack_id, p.product_name.trim()) < 0)
      throw new Error("Edit would leave more unloaded than loaded for this product.");
  });
  return await d.prepare(`SELECT * FROM rack_loadings WHERE id = ?`).get(p.id);
}
async function deleteLoading(payload) {
  const d = getDb();
  const old = await d.prepare(`SELECT * FROM rack_loadings WHERE id = ?`).get(payload.id);
  if (!old) return { ok: false, error: "Loading not found." };
  try {
    await d.transaction(async () => {
      await d.prepare(`DELETE FROM stock_movements WHERE ref_no=? AND type='rack_load'`).run(
        old.loading_no
      );
      await d.prepare(`DELETE FROM rack_loadings WHERE id = ?`).run(payload.id);
      if (await rackUnloadable(d, old.rack_id, old.product_name) < 0)
        throw new Error("Cannot delete: this material has already been unloaded at the destination.");
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
function resolveUnloading(p) {
  let total = Number(p.total_cm) || 0;
  if (!(total > 0)) total = roundQty3((Number(p.trips) || 0) * (Number(p.per_trip_cm) || 0));
  const count = Number(p.trips) || 0;
  if (!(count > 0) && !(total > 0))
    throw new Error("Enter the work count (trips / wagons / hours) and/or the m\xB3 unloaded.");
  return { total: roundQty3(total), amount: computeAmount3(p.rate, count) };
}
function unloadingFields(p, total, amount, diesel, dieselCharged) {
  const vehId = p.rack_vehicle_id ? Number(p.rack_vehicle_id) : null;
  const jcbId = p.rack_jcb_id ? Number(p.rack_jcb_id) : null;
  return {
    rack_id: p.rack_id,
    product_name: p.product_name.trim(),
    transporter_id: p.transporter_id ?? null,
    rack_vehicle_id: vehId,
    rack_jcb_id: jcbId,
    work_type: jcbId ? p.work_type || "unloading" : null,
    vehicle_no: p.vehicle_no ?? "",
    trips: Number(p.trips) || 0,
    per_trip_cm: Number(p.per_trip_cm) || 0,
    total_cm: total,
    uom: "CM",
    quantity: total,
    qty_cm: total,
    rate: p.rate,
    amount,
    diesel_litres: diesel.litres,
    diesel_amount: diesel.amount,
    diesel_charged: dieselCharged,
    date: p.date,
    remarks: p.remarks ?? ""
  };
}
function unloadingHasCarrier(p) {
  return !!(p.rack_vehicle_id || p.rack_jcb_id || p.transporter_id);
}
async function addUnloading(p) {
  const d = getDb();
  const rack = await d.prepare(`SELECT * FROM racks WHERE id = ?`).get(p.rack_id);
  if (!rack) throw new Error("Rack not found.");
  if (rack.status === "closed") throw new Error("Rack is closed. Re-open it to add unloadings.");
  if (!p.product_name?.trim()) throw new Error("Product is required.");
  const { total, amount } = resolveUnloading(p);
  const onRake = await rackUnloadable(d, p.rack_id, p.product_name.trim());
  if (total > onRake)
    throw new Error(
      `Cannot unload more than was loaded. On rake \u2014 ${p.product_name}: ${onRake} m\xB3, requested: ${total} m\xB3.`
    );
  const diesel = await rackDiesel(d, rack.plant_id, p.diesel_litres);
  const diesel_charged = diesel.litres && unloadingHasCarrier(p) && p.diesel_charged ? 1 : 0;
  const no = await nextNumber("RKU", "rack_unloading");
  const info = await d.prepare(
    `INSERT INTO rack_unloadings
        (unloading_no, rack_id, product_name, transporter_id, rack_vehicle_id, rack_jcb_id, work_type,
         vehicle_no, trips, per_trip_cm, total_cm,
         uom, quantity, qty_cm, rate, amount, diesel_litres, diesel_amount, diesel_charged, date, remarks)
       VALUES (@unloading_no,@rack_id,@product_name,@transporter_id,@rack_vehicle_id,@rack_jcb_id,@work_type,
         @vehicle_no,@trips,@per_trip_cm,@total_cm,
         @uom,@quantity,@qty_cm,@rate,@amount,@diesel_litres,@diesel_amount,@diesel_charged,@date,@remarks)`
  ).run({ unloading_no: no, ...unloadingFields(p, total, amount, diesel, diesel_charged) });
  return await d.prepare(`SELECT * FROM rack_unloadings WHERE id = ?`).get(info.lastInsertRowid);
}
async function updateUnloading(p) {
  const d = getDb();
  if (!p.id) throw new Error("Missing unloading id.");
  const old = await d.prepare(`SELECT * FROM rack_unloadings WHERE id = ?`).get(p.id);
  if (!old) throw new Error("Unloading not found.");
  if (!p.product_name?.trim()) throw new Error("Product is required.");
  const { total, amount } = resolveUnloading(p);
  const rackRow = await d.prepare(`SELECT plant_id FROM racks WHERE id = ?`).get(old.rack_id);
  const diesel = await rackDiesel(d, rackRow?.plant_id ?? null, p.diesel_litres, { src: "unloading", id: p.id });
  const diesel_charged = diesel.litres && unloadingHasCarrier(p) && p.diesel_charged ? 1 : 0;
  await d.transaction(async () => {
    await d.prepare(
      `UPDATE rack_unloadings SET product_name=@product_name, transporter_id=@transporter_id,
         rack_vehicle_id=@rack_vehicle_id, rack_jcb_id=@rack_jcb_id, work_type=@work_type,
         vehicle_no=@vehicle_no, trips=@trips, per_trip_cm=@per_trip_cm, total_cm=@total_cm,
         uom=@uom, quantity=@quantity, qty_cm=@qty_cm, rate=@rate, amount=@amount,
         diesel_litres=@diesel_litres, diesel_amount=@diesel_amount, diesel_charged=@diesel_charged, date=@date, remarks=@remarks WHERE id=@id`
    ).run({ id: p.id, ...unloadingFields(p, total, amount, diesel, diesel_charged) });
    if (await rackUnloadable(d, old.rack_id, old.product_name) < 0 || await rackUnloadable(d, old.rack_id, p.product_name.trim()) < 0)
      throw new Error("Edit would leave more unloaded than loaded for this product.");
    if (await rackSellable(d, old.rack_id, old.product_name) < 0 || await rackSellable(d, old.rack_id, p.product_name.trim()) < 0)
      throw new Error("Edit would leave sales exceeding the unloaded quantity.");
  });
  return await d.prepare(`SELECT * FROM rack_unloadings WHERE id = ?`).get(p.id);
}
async function deleteUnloading(payload) {
  const d = getDb();
  const old = await d.prepare(`SELECT * FROM rack_unloadings WHERE id = ?`).get(payload.id);
  if (!old) return { ok: false, error: "Unloading not found." };
  try {
    await d.transaction(async () => {
      await d.prepare(`DELETE FROM rack_unloadings WHERE id = ?`).run(payload.id);
      if (await rackSellable(d, old.rack_id, old.product_name) < 0)
        throw new Error("Cannot delete: material from this unloading has already been sold.");
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
async function listExpenseTypes() {
  const d = getDb();
  const rows = await d.prepare(`SELECT name FROM expense_types ORDER BY name`).all();
  return rows.map((r) => r.name);
}
async function createExpenseType(payload) {
  const d = getDb();
  const name = properCase(payload.name);
  if (!name) return { ok: false, error: "Expense type name is required." };
  const dup = await d.prepare(`SELECT id FROM expense_types WHERE name = ? COLLATE NOCASE`).get(name);
  if (dup) return { ok: false, error: `"${name}" already exists.` };
  await d.prepare(`INSERT INTO expense_types (name) VALUES (?)`).run(name);
  return { ok: true };
}
async function deleteExpenseType(payload) {
  const d = getDb();
  await d.prepare(`DELETE FROM expense_types WHERE name = ?`).run(payload.name);
  return { ok: true };
}
async function addExpense(p) {
  const d = getDb();
  const type = properCase(p.expense_type);
  if (!type) throw new Error("Expense type is required.");
  if (!(Number(p.amount) > 0)) throw new Error("Amount must be greater than 0.");
  const id = await d.transaction(async () => {
    await d.prepare(
      dbKind() === "mysql" ? `INSERT IGNORE INTO expense_types (name) VALUES (?)` : `INSERT INTO expense_types (name) VALUES (?) ON CONFLICT(name) DO NOTHING`
    ).run(type);
    const info = await d.prepare(
      `INSERT INTO rack_expenses (rack_id, expense_type, amount, date, remarks) VALUES (?, ?, ?, ?, ?)`
    ).run(p.rack_id, type, roundMoney(Number(p.amount)), p.date, p.remarks ?? "");
    return Number(info.lastInsertRowid);
  });
  return await d.prepare(`SELECT * FROM rack_expenses WHERE id = ?`).get(id);
}
async function updateExpense(p) {
  const d = getDb();
  if (!p.id) throw new Error("Missing expense id.");
  const type = properCase(p.expense_type);
  if (!type) throw new Error("Expense type is required.");
  if (!(Number(p.amount) > 0)) throw new Error("Amount must be greater than 0.");
  await d.transaction(async () => {
    await d.prepare(
      dbKind() === "mysql" ? `INSERT IGNORE INTO expense_types (name) VALUES (?)` : `INSERT INTO expense_types (name) VALUES (?) ON CONFLICT(name) DO NOTHING`
    ).run(type);
    await d.prepare(
      `UPDATE rack_expenses SET expense_type=?, amount=?, date=?, remarks=? WHERE id=?`
    ).run(type, roundMoney(Number(p.amount)), p.date, p.remarks ?? "", p.id);
  });
  return await d.prepare(`SELECT * FROM rack_expenses WHERE id = ?`).get(p.id);
}
async function deleteExpense(payload) {
  const d = getDb();
  await d.prepare(`DELETE FROM rack_expenses WHERE id = ?`).run(payload.id);
  return { ok: true };
}
async function listExpenses(filter = {}) {
  const d = getDb();
  const where = [];
  const params = {};
  if (filter.rack_id) {
    where.push("e.rack_id = @rack_id");
    params.rack_id = filter.rack_id;
  }
  if (filter.expense_type) {
    where.push("e.expense_type = @expense_type");
    params.expense_type = filter.expense_type;
  }
  if (filter.from) {
    where.push("e.date >= @from");
    params.from = filter.from;
  }
  if (filter.to) {
    where.push("e.date <= @to");
    params.to = filter.to;
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return await d.prepare(
    `SELECT e.*, r.rack_no
       FROM rack_expenses e
       JOIN racks r ON r.id = e.rack_id
       ${clause}
       ORDER BY e.date DESC, e.id DESC`
  ).all(params);
}
async function writeRackSaleChildLines(d, saleId, plantId, transporters, machines) {
  await d.prepare(`DELETE FROM rack_sale_transporters WHERE rack_sale_id = ?`).run(saleId);
  await d.prepare(`DELETE FROM rack_sale_machines WHERE rack_sale_id = ?`).run(saleId);
  const tStmt = d.prepare(
    `INSERT INTO rack_sale_transporters
       (rack_sale_id, transporter_id, rack_vehicle_id, vehicle_no, basis, qty, rate, charge, diesel_litres, diesel_amount, diesel_charged)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const t of transporters ?? []) {
    const transporterId = t.transporter_id ? Number(t.transporter_id) : null;
    const vehicleId = t.rack_vehicle_id ? Number(t.rack_vehicle_id) : null;
    if (!transporterId && !vehicleId) continue;
    const basis = t.basis === "trip" || t.basis === "uom" ? t.basis : "flat";
    const qty = basis === "flat" ? 0 : Number(t.qty) || 0;
    const rate = basis === "flat" ? 0 : Number(t.rate) || 0;
    const charge = basis === "flat" ? roundMoney(Number(t.charge) || 0) : roundMoney(qty * rate);
    const diesel = await rackDiesel(d, plantId, t.diesel_litres);
    const dieselCharged = diesel.litres && (t.diesel_charged ?? true) ? 1 : 0;
    await tStmt.run(
      saleId,
      transporterId,
      vehicleId,
      properCase(t.vehicle_no || ""),
      basis,
      qty,
      rate,
      charge,
      diesel.litres,
      diesel.amount,
      dieselCharged
    );
  }
  const mStmt = d.prepare(
    `INSERT INTO rack_sale_machines (rack_sale_id, asset_id, basis, qty, rate, amount, outsource_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const m of machines ?? []) {
    if (!m.asset_id) continue;
    const basis = m.basis === "cm" ? "cm" : "hour";
    const qty = Number(m.qty) || 0;
    const rate = Number(m.rate) || 0;
    await mStmt.run(saleId, m.asset_id, basis, qty, rate, roundMoney(qty * rate), m.outsource_id ?? null);
  }
}
async function getSaleDetail(payload) {
  const d = getDb();
  const sale = await d.prepare(`SELECT * FROM rack_sales WHERE id = ?`).get(payload.id);
  if (!sale) return null;
  sale.transporters = await d.prepare(
    `SELECT rst.*, t.name AS transporter_name, rv.vehicle_no AS rack_vehicle_no,
              COALESCE(t.name, rv.vehicle_no) AS carrier_name
       FROM rack_sale_transporters rst
       LEFT JOIN transporters t ON t.id = rst.transporter_id
       LEFT JOIN rack_vehicles rv ON rv.id = rst.rack_vehicle_id
       WHERE rst.rack_sale_id = ? ORDER BY rst.id`
  ).all(payload.id);
  sale.machines = await d.prepare(
    `SELECT rsm.*, a.name AS asset_name, o.name AS outsource_name FROM rack_sale_machines rsm
       JOIN assets a ON a.id = rsm.asset_id
       LEFT JOIN outsource o ON o.id = rsm.outsource_id WHERE rsm.rack_sale_id = ? ORDER BY rsm.id`
  ).all(payload.id);
  return sale;
}
function resolveSale(p, factors) {
  if (!(Number(p.quantity) > 0)) throw new Error("Quantity must be greater than 0.");
  if (!["CM", "TON", "CFT"].includes(p.uom)) throw new Error("Invalid unit of measure.");
  const qtyCm = roundQty3(toCm(Number(p.quantity), p.uom, factors));
  return { qtyCm, amount: computeAmount3(p.rate, Number(p.quantity)) };
}
async function addSale(p) {
  const d = getDb();
  const rack = await d.prepare(`SELECT * FROM racks WHERE id = ?`).get(p.rack_id);
  if (!rack) throw new Error("Rack not found.");
  if (rack.status === "loading" || rack.status === "in_transit")
    throw new Error(`Sales start once the rack has reached its destination. Mark rack "${rack.rack_no}" as Reached first.`);
  if (rack.status === "closed") throw new Error("Rack is closed. Re-open it to add sales.");
  const { qtyCm, amount } = resolveSale(p, await rackPlantFactors(d, p.rack_id));
  const available = await rackSellable(d, p.rack_id, p.product_name);
  if (qtyCm > available)
    throw new Error(
      `Not enough unloaded material at destination. Available ${p.product_name}: ${available} m\xB3, requested: ${qtyCm} m\xB3. Add an unloading first.`
    );
  const id = await d.transaction(async () => {
    const no = await nextNumber("SL", "rack_sale");
    const challan = (p.challan_no ?? "").trim() || await nextNumber("CHN", "challan");
    const info = await d.prepare(
      `INSERT INTO rack_sales
          (sale_no, rack_id, customer_id, product_name, uom, quantity, qty_cm, rate, amount, truck_no, challan_no, date, remarks)
         VALUES (@sale_no,@rack_id,@customer_id,@product_name,@uom,@quantity,@qty_cm,@rate,@amount,@truck_no,@challan_no,@date,@remarks)`
    ).run({
      sale_no: no,
      rack_id: p.rack_id,
      customer_id: p.customer_id,
      product_name: p.product_name.trim(),
      uom: p.uom,
      quantity: Number(p.quantity),
      qty_cm: qtyCm,
      rate: p.rate,
      amount,
      truck_no: (p.truck_no ?? "").trim(),
      challan_no: challan,
      date: p.date,
      remarks: p.remarks ?? ""
    });
    const saleId = Number(info.lastInsertRowid);
    await writeRackSaleChildLines(d, saleId, rack.plant_id, p.transporters, p.machines);
    return saleId;
  });
  return await d.prepare(`SELECT * FROM rack_sales WHERE id = ?`).get(id);
}
async function updateSale(p) {
  const d = getDb();
  if (!p.id) throw new Error("Missing sale id.");
  const old = await d.prepare(`SELECT * FROM rack_sales WHERE id = ?`).get(p.id);
  if (!old) throw new Error("Sale not found.");
  const rackRow = await d.prepare(`SELECT plant_id FROM racks WHERE id = ?`).get(old.rack_id);
  const { qtyCm, amount } = resolveSale(p, await rackPlantFactors(d, old.rack_id));
  const available = await rackSellable(d, old.rack_id, p.product_name, p.id);
  if (qtyCm > available)
    throw new Error(
      `Not enough unloaded material at destination. Available ${p.product_name}: ${available} m\xB3, requested: ${qtyCm} m\xB3.`
    );
  const challan = (p.challan_no ?? "").trim() || old.challan_no || await nextNumber("CHN", "challan");
  await d.transaction(async () => {
    await d.prepare(
      `UPDATE rack_sales SET customer_id=@customer_id, product_name=@product_name, uom=@uom,
         quantity=@quantity, qty_cm=@qty_cm, rate=@rate, amount=@amount, truck_no=@truck_no, challan_no=@challan_no, date=@date, remarks=@remarks
       WHERE id=@id`
    ).run({
      id: p.id,
      customer_id: p.customer_id,
      product_name: p.product_name.trim(),
      uom: p.uom,
      quantity: Number(p.quantity),
      qty_cm: qtyCm,
      rate: p.rate,
      amount,
      truck_no: (p.truck_no ?? "").trim(),
      challan_no: challan,
      date: p.date,
      remarks: p.remarks ?? ""
    });
    await writeRackSaleChildLines(d, p.id, rackRow?.plant_id ?? null, p.transporters, p.machines);
  });
  return await d.prepare(`SELECT * FROM rack_sales WHERE id = ?`).get(p.id);
}
async function deleteSale(payload) {
  const d = getDb();
  await d.transaction(async () => {
    await d.prepare(`DELETE FROM rack_sale_transporters WHERE rack_sale_id = ?`).run(payload.id);
    await d.prepare(`DELETE FROM rack_sale_machines WHERE rack_sale_id = ?`).run(payload.id);
    await d.prepare(`DELETE FROM rack_sales WHERE id = ?`).run(payload.id);
  });
  return { ok: true };
}
async function listSales(filter = {}) {
  const d = getDb();
  const where = [];
  const params = {};
  if (filter.rack_id) {
    where.push("rs.rack_id = @rack_id");
    params.rack_id = filter.rack_id;
  }
  if (filter.customer_id) {
    where.push("rs.customer_id = @customer_id");
    params.customer_id = filter.customer_id;
  }
  if (filter.product_name) {
    where.push("rs.product_name = @product_name");
    params.product_name = filter.product_name;
  }
  if (filter.from) {
    where.push("rs.date >= @from");
    params.from = filter.from;
  }
  if (filter.to) {
    where.push("rs.date <= @to");
    params.to = filter.to;
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return await d.prepare(
    `SELECT rs.*, c.name AS customer_name, r.rack_no
       FROM rack_sales rs
       JOIN customers c ON c.id = rs.customer_id
       JOIN racks r ON r.id = rs.rack_id
       ${clause}
       ORDER BY rs.date DESC, rs.id DESC`
  ).all(params);
}

// src/main/services/rackFleet.ts
function numOrNull2(v) {
  const n = Number(v);
  return v == null || v === "" || isNaN(n) ? null : n;
}
async function listRackVehicles(payload = {}) {
  const d = getDb();
  const clause = payload.plant_id ? `WHERE ${plantScopeSql("v", "rack_vehicle")}` : "";
  const rows = await d.prepare(`SELECT v.* FROM rack_vehicles v ${clause} ORDER BY v.vehicle_no`).all(payload);
  await attachPartyPlants(d, "rack_vehicle", rows);
  return rows;
}
async function createRackVehicle(p) {
  const d = getDb();
  const no = (p.vehicle_no || "").trim().toUpperCase();
  if (!no) throw new Error("Vehicle no. is required.");
  const plants = plantIdSet(p);
  const id = await d.transaction(async () => {
    const info = await d.prepare(
      `INSERT INTO rack_vehicles
          (vehicle_no, owner_name, owner_mobile, driver_name, driver_mobile, cap_cm, cap_ton, cap_cft, rate_per_trip, remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      no,
      properCase(p.owner_name || ""),
      (p.owner_mobile || "").trim(),
      properCase(p.driver_name || ""),
      (p.driver_mobile || "").trim(),
      numOrNull2(p.cap_cm),
      numOrNull2(p.cap_ton),
      numOrNull2(p.cap_cft),
      numOrNull2(p.rate_per_trip),
      p.remarks ?? ""
    );
    const vid = Number(info.lastInsertRowid);
    await writePartyPlants(d, "rack_vehicle", vid, plants);
    return vid;
  });
  const row = await d.prepare(`SELECT * FROM rack_vehicles WHERE id = ?`).get(id);
  await attachPartyPlants(d, "rack_vehicle", [row]);
  return row;
}
async function updateRackVehicle(p) {
  const d = getDb();
  if (!p.id) throw new Error("Missing vehicle id.");
  const no = (p.vehicle_no || "").trim().toUpperCase();
  if (!no) throw new Error("Vehicle no. is required.");
  const plants = plantIdSet(p);
  await d.transaction(async () => {
    await d.prepare(
      `UPDATE rack_vehicles SET vehicle_no=?, owner_name=?, owner_mobile=?, driver_name=?, driver_mobile=?,
           cap_cm=?, cap_ton=?, cap_cft=?, rate_per_trip=?, remarks=? WHERE id=?`
    ).run(
      no,
      properCase(p.owner_name || ""),
      (p.owner_mobile || "").trim(),
      properCase(p.driver_name || ""),
      (p.driver_mobile || "").trim(),
      numOrNull2(p.cap_cm),
      numOrNull2(p.cap_ton),
      numOrNull2(p.cap_cft),
      numOrNull2(p.rate_per_trip),
      p.remarks ?? "",
      p.id
    );
    await writePartyPlants(d, "rack_vehicle", p.id, plants);
  });
  const row = await d.prepare(`SELECT * FROM rack_vehicles WHERE id = ?`).get(p.id);
  await attachPartyPlants(d, "rack_vehicle", [row]);
  return row;
}
async function bulkCreateRackVehicles(payload) {
  const result = { created: 0, errors: [] };
  const rows = payload.rows ?? [];
  for (let i = 0; i < rows.length; i++) {
    try {
      await createRackVehicle(rows[i]);
      result.created++;
    } catch (e) {
      result.errors.push({ row: i + 2, message: e.message });
    }
  }
  return result;
}
async function deleteRackVehicle(payload) {
  const d = getDb();
  await d.transaction(async () => {
    await d.prepare(`DELETE FROM rack_vehicle_plants WHERE rack_vehicle_id = ?`).run(payload.id);
    await d.prepare(`DELETE FROM rack_vehicles WHERE id = ?`).run(payload.id);
  });
  return { ok: true };
}
async function listRackJcbs(payload = {}) {
  const d = getDb();
  const clause = payload.plant_id ? `WHERE ${plantScopeSql("j", "rack_jcb")}` : "";
  const rows = await d.prepare(`SELECT j.* FROM rack_jcbs j ${clause} ORDER BY j.name`).all(payload);
  await attachPartyPlants(d, "rack_jcb", rows);
  return rows;
}
async function createRackJcb(p) {
  const d = getDb();
  const name = properCase(p.name || "");
  if (!name) throw new Error("JCB name / no. is required.");
  const plants = plantIdSet(p);
  const id = await d.transaction(async () => {
    const info = await d.prepare(
      `INSERT INTO rack_jcbs
          (name, owner_name, owner_mobile, driver_name, driver_mobile, rate_unloading, rate_loading, rate_other, remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      name,
      properCase(p.owner_name || ""),
      (p.owner_mobile || "").trim(),
      properCase(p.driver_name || ""),
      (p.driver_mobile || "").trim(),
      numOrNull2(p.rate_unloading),
      numOrNull2(p.rate_loading),
      numOrNull2(p.rate_other),
      p.remarks ?? ""
    );
    const jid = Number(info.lastInsertRowid);
    await writePartyPlants(d, "rack_jcb", jid, plants);
    return jid;
  });
  const row = await d.prepare(`SELECT * FROM rack_jcbs WHERE id = ?`).get(id);
  await attachPartyPlants(d, "rack_jcb", [row]);
  return row;
}
async function updateRackJcb(p) {
  const d = getDb();
  if (!p.id) throw new Error("Missing JCB id.");
  const name = properCase(p.name || "");
  if (!name) throw new Error("JCB name / no. is required.");
  const plants = plantIdSet(p);
  await d.transaction(async () => {
    await d.prepare(
      `UPDATE rack_jcbs SET name=?, owner_name=?, owner_mobile=?, driver_name=?, driver_mobile=?,
           rate_unloading=?, rate_loading=?, rate_other=?, remarks=? WHERE id=?`
    ).run(
      name,
      properCase(p.owner_name || ""),
      (p.owner_mobile || "").trim(),
      properCase(p.driver_name || ""),
      (p.driver_mobile || "").trim(),
      numOrNull2(p.rate_unloading),
      numOrNull2(p.rate_loading),
      numOrNull2(p.rate_other),
      p.remarks ?? "",
      p.id
    );
    await writePartyPlants(d, "rack_jcb", p.id, plants);
  });
  const row = await d.prepare(`SELECT * FROM rack_jcbs WHERE id = ?`).get(p.id);
  await attachPartyPlants(d, "rack_jcb", [row]);
  return row;
}
async function bulkCreateRackJcbs(payload) {
  const result = { created: 0, errors: [] };
  const rows = payload.rows ?? [];
  for (let i = 0; i < rows.length; i++) {
    try {
      await createRackJcb(rows[i]);
      result.created++;
    } catch (e) {
      result.errors.push({ row: i + 2, message: e.message });
    }
  }
  return result;
}
async function deleteRackJcb(payload) {
  const d = getDb();
  await d.transaction(async () => {
    await d.prepare(`DELETE FROM rack_jcb_plants WHERE rack_jcb_id = ?`).run(payload.id);
    await d.prepare(`DELETE FROM rack_jcbs WHERE id = ?`).run(payload.id);
  });
  return { ok: true };
}

// src/main/services/ledgers.ts
var PARTY_TABLE = {
  customer: "customers",
  supplier: "suppliers",
  transporter: "transporters",
  outsource: "outsource"
};
var PAYMENT_TABLES = {
  customer: "customers",
  supplier: "suppliers",
  transporter: "transporters",
  outsource: "outsource",
  rack_vehicle: "rack_vehicles",
  rack_jcb: "rack_jcbs"
};
function roundMoney2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
async function partyName(partyType, partyId) {
  const d = getDb();
  if (partyType === "rack") {
    const row2 = await d.prepare(`SELECT rack_no AS name FROM racks WHERE id = ?`).get(partyId);
    if (!row2) throw new Error("Rack not found.");
    return row2.name;
  }
  if (partyType === "company") {
    const row2 = await d.prepare(`SELECT name FROM companies WHERE id = ?`).get(partyId);
    if (!row2) throw new Error("Company not found.");
    return row2.name;
  }
  if (partyType === "plant") {
    const row2 = await d.prepare(`SELECT name FROM plants WHERE id = ?`).get(partyId);
    if (!row2) throw new Error("Plant not found.");
    return row2.name;
  }
  if (partyType === "business") {
    const row2 = await d.prepare(`SELECT name FROM businesses WHERE id = ?`).get(partyId);
    if (!row2) throw new Error("Business not found.");
    return row2.name;
  }
  if (partyType === "machine") {
    const row2 = await d.prepare(`SELECT name FROM assets WHERE id = ?`).get(partyId);
    if (!row2) throw new Error("Machine not found.");
    return row2.name;
  }
  if (partyType === "rack_vehicle") {
    const row2 = await d.prepare(`SELECT vehicle_no AS name FROM rack_vehicles WHERE id = ?`).get(partyId);
    if (!row2) throw new Error("Vehicle not found.");
    return row2.name;
  }
  if (partyType === "rack_jcb") {
    const row2 = await d.prepare(`SELECT name FROM rack_jcbs WHERE id = ?`).get(partyId);
    if (!row2) throw new Error("JCB not found.");
    return row2.name;
  }
  const table = PARTY_TABLE[partyType];
  if (!table) throw new Error("Invalid party type.");
  const row = await d.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(partyId);
  if (!row) throw new Error("Party not found.");
  return row.name;
}
async function companyLinks(companyId) {
  const d = getDb();
  const links = [];
  for (const type of ["customer", "supplier", "transporter"]) {
    const rows = await d.prepare(`SELECT id FROM ${PARTY_TABLE[type]} WHERE company_id = ?`).all(companyId);
    for (const r of rows) links.push({ type, id: r.id });
  }
  return links;
}
async function addPayment(p) {
  const d = getDb();
  if (!PAYMENT_TABLES[p.party_type]) throw new Error("Invalid party type.");
  if (p.direction !== "in" && p.direction !== "out") throw new Error("Invalid payment direction.");
  if (!(Number(p.amount) > 0)) throw new Error("Amount must be greater than 0.");
  await partyName(p.party_type, p.party_id);
  const info = await d.prepare(
    `INSERT INTO payments (party_type, party_id, direction, amount, mode, ref, date, remarks)
       VALUES (@party_type,@party_id,@direction,@amount,@mode,@ref,@date,@remarks)`
  ).run({
    party_type: p.party_type,
    party_id: p.party_id,
    direction: p.direction,
    amount: roundMoney2(Number(p.amount)),
    mode: p.mode || "cash",
    ref: p.ref ?? "",
    date: p.date,
    remarks: p.remarks ?? ""
  });
  return await d.prepare(`SELECT * FROM payments WHERE id = ?`).get(info.lastInsertRowid);
}
async function listPayments(filter = {}) {
  const d = getDb();
  const where = [];
  const params = {};
  if (filter.party_type) {
    where.push("pay.party_type = @party_type");
    params.party_type = filter.party_type;
  }
  if (filter.party_id) {
    where.push("pay.party_id = @party_id");
    params.party_id = filter.party_id;
  }
  if (filter.from) {
    where.push("pay.date >= @from");
    params.from = filter.from;
  }
  if (filter.to) {
    where.push("pay.date <= @to");
    params.to = filter.to;
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return await d.prepare(
    `SELECT pay.*, COALESCE(c.name, s.name, t.name, o.name, rv.vehicle_no, rj.name) AS party_name
       FROM payments pay
       LEFT JOIN customers c ON pay.party_type='customer' AND c.id = pay.party_id
       LEFT JOIN suppliers s ON pay.party_type='supplier' AND s.id = pay.party_id
       LEFT JOIN transporters t ON pay.party_type='transporter' AND t.id = pay.party_id
       LEFT JOIN outsource o ON pay.party_type='outsource' AND o.id = pay.party_id
       LEFT JOIN rack_vehicles rv ON pay.party_type='rack_vehicle' AND rv.id = pay.party_id
       LEFT JOIN rack_jcbs rj ON pay.party_type='rack_jcb' AND rj.id = pay.party_id
       ${clause}
       ORDER BY pay.date DESC, pay.id DESC`
  ).all(params);
}
async function deletePayment(payload) {
  const d = getDb();
  await d.prepare(`DELETE FROM payments WHERE id = ?`).run(payload.id);
  return { ok: true };
}
var OPENING_TYPES = ["customer", "supplier", "transporter", "outsource", "plant"];
async function openingEntries(partyType, partyId, plantId) {
  if (!OPENING_TYPES.includes(partyType)) return [];
  const scopeByPlant = !!plantId && partyType !== "plant";
  const params = { party_type: partyType, party_id: partyId };
  if (scopeByPlant) params.plant_id = plantId;
  const rows = await getDb().prepare(
    `SELECT ob.amount, ob.direction, ob.as_of_date, p.name AS plant_name
       FROM opening_balances ob LEFT JOIN plants p ON p.id = ob.plant_id
       WHERE ob.party_type = @party_type AND ob.party_id = @party_id
       ${scopeByPlant ? "AND (ob.plant_id = @plant_id OR ob.plant_id IS NULL)" : ""}`
  ).all(params);
  return rows.filter((r) => r.amount > 0).map((r) => ({
    date: r.as_of_date || "1900-04-01",
    created_at: "",
    particulars: r.plant_name ? `Opening Balance \u2014 ${r.plant_name}` : "Opening Balance",
    ref: "OPENING",
    debit: r.direction === "debit" ? roundMoney2(r.amount) : 0,
    credit: r.direction === "credit" ? roundMoney2(r.amount) : 0
  }));
}
async function buildEntries(partyType, partyId, plantId) {
  const d = getDb();
  const entries = [];
  entries.push(...await openingEntries(partyType, partyId, plantId));
  if (partyType === "rack") {
    const loadings = await d.prepare(
      `SELECT rl.loading_no, rl.date, rl.created_at, COALESCE(rl.amount,0) AS amount,
                rl.total_cm, rl.trips, t.name AS transporter_name
         FROM rack_loadings rl JOIN transporters t ON t.id = rl.transporter_id
         WHERE rl.rack_id = ?`
    ).all(partyId);
    for (const x of loadings)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Transport \u2014 ${x.trips} trips, ${x.total_cm} m\xB3 (${x.transporter_name})`,
          ref: x.loading_no,
          debit: x.amount,
          credit: 0
        });
    const runl = await d.prepare(
      `SELECT ru.unloading_no, ru.date, ru.created_at, COALESCE(ru.amount,0) AS amount, ru.qty_cm,
                COALESCE(rv.vehicle_no, rj.name, t.name, 'Carrier') AS who
         FROM rack_unloadings ru
         LEFT JOIN rack_vehicles rv ON rv.id = ru.rack_vehicle_id
         LEFT JOIN rack_jcbs rj ON rj.id = ru.rack_jcb_id
         LEFT JOIN transporters t ON t.id = ru.transporter_id
         WHERE ru.rack_id = ?`
    ).all(partyId);
    for (const x of runl)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Unloading \u2014 ${x.qty_cm} m\xB3 (${x.who})`,
          ref: x.unloading_no,
          debit: x.amount,
          credit: 0
        });
    const expenses = await d.prepare(
      `SELECT expense_type, amount, date, created_at, remarks FROM rack_expenses WHERE rack_id = ?`
    ).all(partyId);
    for (const x of expenses)
      entries.push({
        date: x.date,
        created_at: x.created_at,
        particulars: `Expense \u2014 ${x.expense_type}${x.remarks ? ` (${x.remarks})` : ""}`,
        ref: "",
        debit: x.amount,
        credit: 0
      });
    const sales = await d.prepare(
      `SELECT rs.sale_no, rs.date, rs.created_at, COALESCE(rs.amount,0) AS amount,
                rs.product_name, rs.quantity, rs.uom, c.name AS customer_name
         FROM rack_sales rs JOIN customers c ON c.id = rs.customer_id
         WHERE rs.rack_id = ?`
    ).all(partyId);
    for (const x of sales)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Sale \u2014 ${x.product_name} (${x.quantity} ${x.uom}) to ${x.customer_name}`,
          ref: x.sale_no,
          debit: 0,
          credit: x.amount
        });
    const saleTrans = await d.prepare(
      `SELECT rs.sale_no, rs.date, rs.created_at, COALESCE(rst.charge,0) AS charge,
                COALESCE(t.name, rv.vehicle_no, 'Carrier') AS tname
         FROM rack_sale_transporters rst JOIN rack_sales rs ON rs.id = rst.rack_sale_id
         LEFT JOIN transporters t ON t.id = rst.transporter_id
         LEFT JOIN rack_vehicles rv ON rv.id = rst.rack_vehicle_id
         WHERE rs.rack_id = ?`
    ).all(partyId);
    for (const x of saleTrans)
      if (x.charge > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Sale transport \u2014 ${x.tname}`,
          ref: x.sale_no,
          debit: x.charge,
          credit: 0
        });
    const saleMach = await d.prepare(
      `SELECT rs.sale_no, rs.date, rs.created_at, COALESCE(rsm.amount,0) AS amount, a.name AS aname
         FROM rack_sale_machines rsm JOIN rack_sales rs ON rs.id = rsm.rack_sale_id
         JOIN assets a ON a.id = rsm.asset_id WHERE rs.rack_id = ?`
    ).all(partyId);
    for (const x of saleMach)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Machine \u2014 ${x.aname}`,
          ref: x.sale_no,
          debit: x.amount,
          credit: 0
        });
    entries.sort(
      (a, b) => a.date === b.date ? a.created_at.localeCompare(b.created_at) : a.date.localeCompare(b.date)
    );
    return entries;
  }
  if (partyType === "company") {
    const roleLabel = {
      customer: "Customer",
      supplier: "Supplier",
      transporter: "Transporter",
      outsource: "Outsource"
    };
    for (const link of await companyLinks(partyId)) {
      for (const e of await buildEntries(link.type, link.id, plantId))
        entries.push({ ...e, particulars: `[${roleLabel[link.type]}] ${e.particulars}` });
    }
    entries.sort(
      (a, b) => a.date === b.date ? a.created_at.localeCompare(b.created_at) : a.date.localeCompare(b.date)
    );
    return entries;
  }
  if (partyType === "plant") {
    const sales = await d.prepare(
      `SELECT dispatch_no, date, created_at, product_name, COALESCE(sale_quantity, quantity) AS quantity, uom,
          (COALESCE(amount,0)
            + CASE WHEN transport_billed=1 THEN transport_charge ELSE 0 END
            + CASE WHEN other_billed=1 THEN other_charge ELSE 0 END) AS billed
         FROM dispatches WHERE plant_id = ? AND amount IS NOT NULL`
    ).all(partyId);
    for (const x of sales)
      if (x.billed > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Direct sale \u2014 ${x.product_name} (${x.quantity} ${x.uom})`,
          ref: x.dispatch_no,
          debit: 0,
          credit: x.billed
        });
    const racks = await d.prepare(
      `SELECT r.id, r.rack_no, r.date, r.created_at,
          (SELECT COALESCE(SUM(amount),0) FROM rack_sales WHERE rack_id=r.id)
            - (SELECT COALESCE(SUM(amount),0) FROM rack_loadings WHERE rack_id=r.id)
            - (SELECT COALESCE(SUM(amount),0) FROM rack_unloadings WHERE rack_id=r.id)
            - (SELECT COALESCE(SUM(amount),0) FROM rack_expenses WHERE rack_id=r.id)
            - (SELECT COALESCE(SUM(rst.charge),0) FROM rack_sale_transporters rst
                 JOIN rack_sales rs ON rs.id=rst.rack_sale_id WHERE rs.rack_id=r.id)
            - (SELECT COALESCE(SUM(rsm.amount),0) FROM rack_sale_machines rsm
                 JOIN rack_sales rs ON rs.id=rsm.rack_sale_id WHERE rs.rack_id=r.id) AS profit,
          (SELECT COALESCE(SUM(total_cm),0) FROM rack_loadings WHERE rack_id=r.id AND plant_id=@pid) AS plant_cm,
          (SELECT COALESCE(SUM(total_cm),0) FROM rack_loadings WHERE rack_id=r.id) AS total_cm
         FROM racks r
         WHERE r.status='closed'
           AND EXISTS (SELECT 1 FROM rack_loadings WHERE rack_id=r.id AND plant_id=@pid)`
    ).all({ pid: partyId });
    for (const r of racks) {
      const share = r.total_cm > 0 ? r.plant_cm / r.total_cm : 0;
      const attributed = r.profit * share;
      if (Math.abs(attributed) < 5e-3) continue;
      entries.push({
        date: r.date,
        created_at: r.created_at,
        particulars: `Rack ${r.rack_no} gross${share < 0.999 ? " (share)" : ""}`,
        ref: r.rack_no,
        debit: attributed < 0 ? -attributed : 0,
        credit: attributed > 0 ? attributed : 0
      });
    }
    const purchases = await d.prepare(
      `SELECT purchase_no, date, created_at, COALESCE(amount,0) AS amount, quantity
         FROM purchases WHERE plant_id = ? AND amount IS NOT NULL`
    ).all(partyId);
    for (const x of purchases)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Raw material purchase (${x.quantity} m\xB3)`,
          ref: x.purchase_no,
          debit: x.amount,
          credit: 0
        });
    const catLabel = {
      electricity: "Electricity",
      maintenance: "Maintenance",
      fixed: "Fixed Cost",
      tipper_rent: "Tipper Rent",
      equipment_rent: "Equipment Rent",
      other: "Other Expense"
    };
    const expenses = await d.prepare(
      `SELECT expense_no, date, created_at, category, title, amount
         FROM plant_expenses WHERE plant_id = ?`
    ).all(partyId);
    for (const x of expenses)
      entries.push({
        date: x.date,
        created_at: x.created_at,
        particulars: `${catLabel[x.category] ?? "Expense"}${x.title ? ` \u2014 ${x.title}` : ""}`,
        ref: x.expense_no,
        debit: x.amount,
        credit: 0
      });
    const ptrans = await d.prepare(
      `SELECT pu.purchase_no, pu.date, pu.created_at, COALESCE(pt.charge,0) AS charge, t.name AS tname
         FROM purchase_transporters pt JOIN purchases pu ON pu.id = pt.purchase_id
         JOIN transporters t ON t.id = pt.transporter_id WHERE pu.plant_id = ?`
    ).all(partyId);
    for (const x of ptrans)
      if (x.charge > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Purchase transport \u2014 ${x.tname}`,
          ref: x.purchase_no,
          debit: x.charge,
          credit: 0
        });
    const pmach = await d.prepare(
      `SELECT pu.purchase_no, pu.date, pu.created_at, COALESCE(pm.amount,0) AS amount, a.name AS aname
         FROM purchase_machines pm JOIN purchases pu ON pu.id = pm.purchase_id
         JOIN assets a ON a.id = pm.asset_id WHERE pu.plant_id = ?`
    ).all(partyId);
    for (const x of pmach)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Machine \u2014 ${x.aname}`,
          ref: x.purchase_no,
          debit: x.amount,
          credit: 0
        });
    const dtrans = await d.prepare(
      `SELECT di.dispatch_no, di.date, di.created_at, COALESCE(dt.charge,0) AS charge, t.name AS tname
         FROM dispatch_transporters dt JOIN dispatches di ON di.id = dt.dispatch_id
         JOIN transporters t ON t.id = dt.transporter_id WHERE di.plant_id = ?`
    ).all(partyId);
    for (const x of dtrans)
      if (x.charge > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Sale transport \u2014 ${x.tname}`,
          ref: x.dispatch_no,
          debit: x.charge,
          credit: 0
        });
    const dmach = await d.prepare(
      `SELECT di.dispatch_no, di.date, di.created_at, COALESCE(dm.amount,0) AS amount, a.name AS aname
         FROM dispatch_machines dm JOIN dispatches di ON di.id = dm.dispatch_id
         JOIN assets a ON a.id = dm.asset_id WHERE di.plant_id = ?`
    ).all(partyId);
    for (const x of dmach)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Machine \u2014 ${x.aname}`,
          ref: x.dispatch_no,
          debit: x.amount,
          credit: 0
        });
    const dieselCost = await d.prepare(
      `SELECT purchase_no, date, created_at, COALESCE(amount,0) AS amount, litres
         FROM diesel_purchases WHERE plant_id = ?`
    ).all(partyId);
    for (const x of dieselCost)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Diesel purchase (${x.litres} L)`,
          ref: x.purchase_no,
          debit: x.amount,
          credit: 0
        });
    const wages = await d.prepare(
      `SELECT w.entry_no, w.date, w.created_at, w.amount, w.period, e.name AS emp
         FROM wage_entries w JOIN employees e ON e.id = w.employee_id
         WHERE w.plant_id = ?`
    ).all(partyId);
    for (const x of wages)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Wages \u2014 ${x.emp} (${x.period})`,
          ref: x.entry_no,
          debit: x.amount,
          credit: 0
        });
    entries.sort(
      (a, b) => a.date === b.date ? a.created_at.localeCompare(b.created_at) : a.date.localeCompare(b.date)
    );
    return entries;
  }
  if (partyType === "business") {
    const assetIds = (await d.prepare(`SELECT id FROM assets WHERE business_id = ?`).all(partyId)).map((a) => a.id);
    if (assetIds.length === 0) return entries;
    const inC = assetIds.map(() => "?").join(",");
    const rents = await d.prepare(
      `SELECT pe.expense_no, pe.date, pe.created_at, pe.amount, pe.category, a.name AS asset
         FROM plant_expenses pe JOIN assets a ON a.id = pe.asset_id
         WHERE pe.asset_id IN (${inC}) AND pe.category IN ('tipper_rent','equipment_rent')`
    ).all(...assetIds);
    for (const x of rents)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Rent earned \u2014 ${x.asset}`,
          ref: x.expense_no,
          debit: 0,
          credit: x.amount
        });
    const costs = await d.prepare(
      `SELECT pe.expense_no, pe.date, pe.created_at, pe.amount, pe.category, a.name AS asset
         FROM plant_expenses pe JOIN assets a ON a.id = pe.asset_id
         WHERE pe.asset_id IN (${inC}) AND pe.category NOT IN ('tipper_rent','equipment_rent')`
    ).all(...assetIds);
    for (const x of costs)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `${x.category === "maintenance" ? "Maintenance" : "Expense"} \u2014 ${x.asset}`,
          ref: x.expense_no,
          debit: x.amount,
          credit: 0
        });
    const wages = await d.prepare(
      `SELECT w.entry_no, w.date, w.created_at, w.amount, e.name AS emp, a.name AS asset
         FROM wage_entries w JOIN employees e ON e.id = w.employee_id JOIN assets a ON a.id = w.asset_id
         WHERE w.asset_id IN (${inC})`
    ).all(...assetIds);
    for (const x of wages)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Operator wages \u2014 ${x.emp} (${x.asset})`,
          ref: x.entry_no,
          debit: x.amount,
          credit: 0
        });
    const avgRow = await d.prepare(
      `SELECT COALESCE(SUM(amount),0) AS a, COALESCE(SUM(litres),0) AS l FROM diesel_purchases WHERE amount IS NOT NULL`
    ).get();
    const avg = avgRow.l > 0 ? avgRow.a / avgRow.l : 0;
    const diesel = await d.prepare(
      `SELECT di.issue_no, di.date, di.created_at, di.litres, di.amount, a.name AS asset
         FROM diesel_issues di JOIN assets a ON a.id = di.asset_id WHERE di.asset_id IN (${inC})`
    ).all(...assetIds);
    for (const x of diesel) {
      const cost = x.amount != null ? Number(x.amount) : roundMoney2(x.litres * avg);
      if (x.litres > 0 && cost > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Diesel ${x.litres} L \u2014 ${x.asset}`,
          ref: x.issue_no,
          debit: roundMoney2(cost),
          credit: 0
        });
    }
    entries.sort(
      (a, b) => a.date === b.date ? a.created_at.localeCompare(b.created_at) : a.date.localeCompare(b.date)
    );
    return entries;
  }
  if (partyType === "machine") {
    const mcatLabel = {
      electricity: "Electricity",
      maintenance: "Maintenance",
      fixed: "Fixed Expense",
      other: "Other Expense"
    };
    const logs = await d.prepare(
      `SELECT date, created_at, work_type, usage_qty, COALESCE(amount,0) AS amount
         FROM machine_logs WHERE asset_id = ? AND amount IS NOT NULL`
    ).all(partyId);
    for (const x of logs)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Run income \u2014 ${x.work_type || "usage"} (${x.usage_qty})`,
          ref: "",
          debit: 0,
          credit: x.amount
        });
    const pexp = await d.prepare(
      `SELECT expense_no, date, created_at, COALESCE(amount,0) AS amount, category
         FROM plant_expenses WHERE asset_id = ?`
    ).all(partyId);
    for (const x of pexp) {
      if (!(x.amount > 0)) continue;
      const isRent = x.category === "tipper_rent" || x.category === "equipment_rent";
      entries.push({
        date: x.date,
        created_at: x.created_at,
        particulars: isRent ? "Rent earned" : mcatLabel[x.category] ?? "Expense",
        ref: x.expense_no,
        debit: isRent ? 0 : x.amount,
        credit: isRent ? x.amount : 0
      });
    }
    const wages = await d.prepare(
      `SELECT w.entry_no, w.date, w.created_at, COALESCE(w.amount,0) AS amount, e.name AS emp, w.period
         FROM wage_entries w JOIN employees e ON e.id = w.employee_id WHERE w.asset_id = ?`
    ).all(partyId);
    for (const x of wages)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Operator wages \u2014 ${x.emp} (${x.period})`,
          ref: x.entry_no,
          debit: x.amount,
          credit: 0
        });
    const avgRow = await d.prepare(`SELECT COALESCE(SUM(amount),0) AS a, COALESCE(SUM(litres),0) AS l FROM diesel_purchases WHERE amount IS NOT NULL`).get();
    const avg = avgRow.l > 0 ? avgRow.a / avgRow.l : 0;
    const diesel = await d.prepare(`SELECT issue_no, date, created_at, litres, amount FROM diesel_issues WHERE asset_id = ?`).all(partyId);
    for (const x of diesel) {
      const cost = x.amount != null ? Number(x.amount) : roundMoney2(x.litres * avg);
      if (x.litres > 0 && cost > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Diesel ${x.litres} L`,
          ref: x.issue_no,
          debit: roundMoney2(cost),
          credit: 0
        });
    }
    entries.sort(
      (a, b) => a.date === b.date ? a.created_at.localeCompare(b.created_at) : a.date.localeCompare(b.date)
    );
    return entries;
  }
  if (partyType === "outsource") {
    const exp = await d.prepare(
      `SELECT expense_no, date, created_at, category, amount, paid_amount
         FROM plant_expenses WHERE outsource_id = ?`
    ).all(partyId);
    for (const x of exp) {
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Outsourced \u2014 ${x.category}`,
          ref: x.expense_no,
          debit: 0,
          credit: x.amount
        });
      if (x.paid_amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Paid against bill`,
          ref: x.expense_no,
          debit: x.paid_amount,
          credit: 0
        });
    }
    const mach = await d.prepare(
      `SELECT pu.purchase_no, pu.date, pu.created_at, COALESCE(pm.amount,0) AS amount, a.name AS aname
         FROM purchase_machines pm JOIN purchases pu ON pu.id = pm.purchase_id
         JOIN assets a ON a.id = pm.asset_id WHERE pm.outsource_id = ?`
    ).all(partyId);
    for (const x of mach)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Machine hire \u2014 ${x.aname}`,
          ref: x.purchase_no,
          debit: 0,
          credit: x.amount
        });
    const dmach = await d.prepare(
      `SELECT di.dispatch_no, di.date, di.created_at, COALESCE(dm.amount,0) AS amount, a.name AS aname
         FROM dispatch_machines dm JOIN dispatches di ON di.id = dm.dispatch_id
         JOIN assets a ON a.id = dm.asset_id WHERE dm.outsource_id = ?`
    ).all(partyId);
    for (const x of dmach)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Machine hire \u2014 ${x.aname}`,
          ref: x.dispatch_no,
          debit: 0,
          credit: x.amount
        });
    const rsmach = await d.prepare(
      `SELECT rs.sale_no, rs.date, rs.created_at, COALESCE(rsm.amount,0) AS amount, a.name AS aname
         FROM rack_sale_machines rsm JOIN rack_sales rs ON rs.id = rsm.rack_sale_id
         JOIN assets a ON a.id = rsm.asset_id WHERE rsm.outsource_id = ?`
    ).all(partyId);
    for (const x of rsmach)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Machine hire \u2014 ${x.aname}`,
          ref: x.sale_no,
          debit: 0,
          credit: x.amount
        });
    const osale = await d.prepare(
      `SELECT dispatch_no, date, created_at, product_name, uom,
                COALESCE(sale_quantity, quantity) AS qty,
                ROUND(COALESCE(buy_rate,0) * COALESCE(sale_quantity, quantity), 2) AS amount
         FROM dispatches
         WHERE outsourced = 1 AND outsource_id = ? AND COALESCE(buy_rate,0) > 0`
    ).all(partyId);
    for (const x of osale)
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Outsourced supply \u2014 ${x.product_name}`,
          ref: x.dispatch_no,
          qty: x.qty,
          uom: x.uom,
          debit: 0,
          credit: x.amount
        });
  }
  if (partyType === "customer") {
    const dispatches = await d.prepare(
      `SELECT dispatch_no, date, created_at, product_name, COALESCE(sale_quantity, quantity) AS quantity, uom,
          rate, COALESCE(vehicle_no,'') AS vehicle_no, COALESCE(challan_no,'') AS challan_no,
          COALESCE(amount,0) AS goods,
          CASE WHEN transport_billed=1 THEN COALESCE(transport_charge,0) ELSE 0 END AS transport,
          CASE WHEN other_billed=1 THEN COALESCE(other_charge,0) ELSE 0 END AS other,
          (COALESCE(amount,0)
            + CASE WHEN transport_billed=1 THEN transport_charge ELSE 0 END
            + CASE WHEN other_billed=1 THEN other_charge ELSE 0 END) AS billed,
          paid_amount
         FROM dispatches WHERE customer_id = ? AND to_plant_id IS NULL`
    ).all(partyId);
    const uomLabel = (u) => u === "CM" ? "m\xB3" : u === "TON" ? "Ton" : u === "CFT" ? "CFT" : u;
    for (const x of dispatches) {
      if (x.billed > 0) {
        const bits = [`Direct sale \u2014 ${x.product_name}`];
        if (x.rate != null) bits.push(`@ ${roundMoney2(x.rate)}/${uomLabel(x.uom)}`);
        if (x.vehicle_no) bits.push(`Veh ${x.vehicle_no}`);
        if (x.challan_no) bits.push(`Challan ${x.challan_no}`);
        if (x.transport > 0) bits.push(`+ transport ${roundMoney2(x.transport)}`);
        if (x.other > 0) bits.push(`+ other ${roundMoney2(x.other)}`);
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: bits.join(" \xB7 "),
          ref: x.dispatch_no,
          qty: x.quantity,
          uom: x.uom,
          debit: x.billed,
          credit: 0
        });
      }
      if (x.paid_amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Received against sale`,
          ref: x.dispatch_no,
          debit: 0,
          credit: x.paid_amount
        });
    }
    const sales = await d.prepare(
      `SELECT rs.sale_no, rs.date, rs.created_at, COALESCE(rs.amount,0) AS amount,
                rs.product_name, rs.quantity, rs.uom, r.rack_no
         FROM rack_sales rs JOIN racks r ON r.id = rs.rack_id
         WHERE rs.customer_id = ? AND rs.amount IS NOT NULL`
    ).all(partyId);
    for (const x of sales)
      entries.push({
        date: x.date,
        created_at: x.created_at,
        particulars: `Rack sale \u2014 ${x.product_name} \xB7 Rack ${x.rack_no}`,
        ref: x.sale_no,
        qty: x.quantity,
        uom: x.uom,
        debit: x.amount,
        credit: 0
      });
  }
  if (partyType === "supplier") {
    const purchases = await d.prepare(
      `SELECT purchase_no, date, created_at, COALESCE(amount,0) AS amount, paid_amount, quantity, uom,
                COALESCE(material_type,'raw') AS material_type, product_name
         FROM purchases WHERE supplier_id = ? AND linked_dispatch_id IS NULL`
    ).all(partyId);
    for (const x of purchases) {
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Purchase \u2014 ${x.material_type === "finished" && x.product_name ? x.product_name : "raw material"}`,
          ref: x.purchase_no,
          qty: x.quantity,
          uom: x.uom,
          debit: 0,
          credit: x.amount
        });
      if (x.paid_amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Paid against bill`,
          ref: x.purchase_no,
          debit: x.paid_amount,
          credit: 0
        });
    }
    const diesel = await d.prepare(
      `SELECT purchase_no, date, created_at, COALESCE(amount,0) AS amount, paid_amount, litres
         FROM diesel_purchases WHERE supplier_id = ?`
    ).all(partyId);
    for (const x of diesel) {
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Diesel purchase`,
          ref: x.purchase_no,
          qty: x.litres,
          uom: "L",
          debit: 0,
          credit: x.amount
        });
      if (x.paid_amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Paid against diesel bill`,
          ref: x.purchase_no,
          debit: x.paid_amount,
          credit: 0
        });
    }
  }
  if (partyType === "transporter") {
    const loadings = await d.prepare(
      `SELECT rl.loading_no, rl.date, rl.created_at, COALESCE(rl.amount,0) AS amount,
                COALESCE(rl.diesel_amount,0) AS diesel, COALESCE(rl.diesel_charged,0) AS diesel_charged, rl.total_cm, rl.trips, r.rack_no
         FROM rack_loadings rl JOIN racks r ON r.id = rl.rack_id
         WHERE rl.transporter_id = ?`
    ).all(partyId);
    for (const x of loadings) {
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Transport \u2014 ${x.trips} trips, ${x.total_cm} m\xB3 \xB7 Rack ${x.rack_no}`,
          ref: x.loading_no,
          debit: 0,
          credit: x.amount
        });
      if (x.diesel > 0 && x.diesel_charged)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Diesel issued (deduction)`,
          ref: x.loading_no,
          debit: x.diesel,
          credit: 0
        });
    }
    const unloadings = await d.prepare(
      `SELECT ru.unloading_no, ru.date, ru.created_at, COALESCE(ru.amount,0) AS amount,
                COALESCE(ru.diesel_amount,0) AS diesel, COALESCE(ru.diesel_charged,0) AS diesel_charged, ru.total_cm, ru.trips, r.rack_no
         FROM rack_unloadings ru JOIN racks r ON r.id = ru.rack_id
         WHERE ru.transporter_id = ?`
    ).all(partyId);
    for (const x of unloadings) {
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Unloading transport \u2014 ${x.trips} trips, ${x.total_cm} m\xB3 \xB7 Rack ${x.rack_no}`,
          ref: x.unloading_no,
          debit: 0,
          credit: x.amount
        });
      if (x.diesel > 0 && x.diesel_charged)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Diesel issued (deduction)`,
          ref: x.unloading_no,
          debit: x.diesel,
          credit: 0
        });
    }
    const sales = await d.prepare(
      `SELECT dispatch_no, date, created_at, product_name, COALESCE(transport_charge,0) AS charge
         FROM dispatches WHERE transporter_id = ? AND COALESCE(transport_charge,0) > 0`
    ).all(partyId);
    for (const x of sales)
      entries.push({
        date: x.date,
        created_at: x.created_at,
        particulars: `Transport \u2014 direct sale ${x.product_name}`,
        ref: x.dispatch_no,
        debit: 0,
        credit: x.charge
      });
    const pin = await d.prepare(
      `SELECT pu.purchase_no, pu.date, pu.created_at, COALESCE(pt.charge,0) AS charge, COALESCE(pt.vehicle_no,'') AS vno
         FROM purchase_transporters pt JOIN purchases pu ON pu.id = pt.purchase_id
         WHERE pt.transporter_id = ?`
    ).all(partyId);
    for (const x of pin)
      if (x.charge > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Transport \u2014 purchase inward${x.vno ? ` (${x.vno})` : ""}`,
          ref: x.purchase_no,
          debit: 0,
          credit: x.charge
        });
    const dtin = await d.prepare(
      `SELECT di.dispatch_no, di.date, di.created_at, COALESCE(dt.charge,0) AS charge, COALESCE(dt.vehicle_no,'') AS vno
         FROM dispatch_transporters dt JOIN dispatches di ON di.id = dt.dispatch_id
         WHERE dt.transporter_id = ?`
    ).all(partyId);
    for (const x of dtin)
      if (x.charge > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Transport \u2014 direct sale${x.vno ? ` (${x.vno})` : ""}`,
          ref: x.dispatch_no,
          debit: 0,
          credit: x.charge
        });
    const rstin = await d.prepare(
      `SELECT rs.sale_no, rs.date, rs.created_at, COALESCE(rst.charge,0) AS charge, COALESCE(rst.vehicle_no,'') AS vno,
                COALESCE(rst.diesel_amount,0) AS diesel, COALESCE(rst.diesel_charged,0) AS diesel_charged
         FROM rack_sale_transporters rst JOIN rack_sales rs ON rs.id = rst.rack_sale_id
         WHERE rst.transporter_id = ?`
    ).all(partyId);
    for (const x of rstin) {
      if (x.charge > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Transport \u2014 rack sale${x.vno ? ` (${x.vno})` : ""}`,
          ref: x.sale_no,
          debit: 0,
          credit: x.charge
        });
      if (x.diesel > 0 && x.diesel_charged)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Diesel issued (deduction)`,
          ref: x.sale_no,
          debit: x.diesel,
          credit: 0
        });
    }
    const dsl = await d.prepare(
      `SELECT issue_no, date, created_at, COALESCE(litres,0) AS litres, COALESCE(amount,0) AS amount
         FROM diesel_issues WHERE transporter_id = ? AND charged = 1 AND COALESCE(amount,0) > 0`
    ).all(partyId);
    for (const x of dsl)
      entries.push({
        date: x.date,
        created_at: x.created_at,
        particulars: `Diesel issued \u2014 ${x.litres} L`,
        ref: x.issue_no,
        debit: x.amount,
        credit: 0
      });
  }
  if (partyType === "rack_vehicle") {
    const unl = await d.prepare(
      `SELECT ru.unloading_no, ru.date, ru.created_at, COALESCE(ru.amount,0) AS amount,
                COALESCE(ru.diesel_amount,0) AS diesel, COALESCE(ru.diesel_charged,0) AS diesel_charged,
                ru.qty_cm, ru.trips, r.rack_no
         FROM rack_unloadings ru JOIN racks r ON r.id = ru.rack_id WHERE ru.rack_vehicle_id = ?`
    ).all(partyId);
    for (const x of unl) {
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Unloading \u2014 ${x.trips} trips, ${x.qty_cm} m\xB3 \xB7 Rack ${x.rack_no}`,
          ref: x.unloading_no,
          debit: 0,
          credit: x.amount
        });
      if (x.diesel > 0 && x.diesel_charged)
        entries.push({ date: x.date, created_at: x.created_at, particulars: `Diesel issued (deduction)`, ref: x.unloading_no, debit: x.diesel, credit: 0 });
    }
    const st = await d.prepare(
      `SELECT rs.sale_no, rs.date, rs.created_at, COALESCE(rst.charge,0) AS charge,
                COALESCE(rst.diesel_amount,0) AS diesel, COALESCE(rst.diesel_charged,0) AS diesel_charged, r.rack_no
         FROM rack_sale_transporters rst JOIN rack_sales rs ON rs.id = rst.rack_sale_id
         JOIN racks r ON r.id = rs.rack_id WHERE rst.rack_vehicle_id = ?`
    ).all(partyId);
    for (const x of st) {
      if (x.charge > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Sale transport \xB7 Rack ${x.rack_no}`,
          ref: x.sale_no,
          debit: 0,
          credit: x.charge
        });
      if (x.diesel > 0 && x.diesel_charged)
        entries.push({ date: x.date, created_at: x.created_at, particulars: `Diesel issued (deduction)`, ref: x.sale_no, debit: x.diesel, credit: 0 });
    }
  }
  if (partyType === "rack_jcb") {
    const wLabel = { unloading: "unloading (per wagon)", loading: "loading (per tipper)", other: "other work (per hour)" };
    const unl = await d.prepare(
      `SELECT ru.unloading_no, ru.date, ru.created_at, COALESCE(ru.amount,0) AS amount,
                COALESCE(ru.diesel_amount,0) AS diesel, COALESCE(ru.diesel_charged,0) AS diesel_charged,
                ru.qty_cm, ru.trips, ru.work_type, r.rack_no
         FROM rack_unloadings ru JOIN racks r ON r.id = ru.rack_id WHERE ru.rack_jcb_id = ?`
    ).all(partyId);
    for (const x of unl) {
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `JCB ${wLabel[x.work_type ?? "unloading"] ?? "work"} \u2014 ${x.trips} \xB7 Rack ${x.rack_no}`,
          ref: x.unloading_no,
          debit: 0,
          credit: x.amount
        });
      if (x.diesel > 0 && x.diesel_charged)
        entries.push({ date: x.date, created_at: x.created_at, particulars: `Diesel issued (deduction)`, ref: x.unloading_no, debit: x.diesel, credit: 0 });
    }
  }
  const payments = await getDb().prepare(`SELECT * FROM payments WHERE party_type = ? AND party_id = ?`).all(partyType, partyId);
  for (const p of payments) {
    const received = p.direction === "in";
    entries.push({
      date: p.date,
      created_at: p.created_at,
      particulars: (received ? "Payment received" : "Payment made") + (p.mode ? ` (${p.mode})` : "") + (p.remarks ? ` \u2014 ${p.remarks}` : ""),
      ref: p.ref || `PAY-${p.id}`,
      debit: received ? 0 : p.amount,
      credit: received ? p.amount : 0,
      payment_id: p.id
    });
  }
  entries.sort(
    (a, b) => a.date === b.date ? a.created_at.localeCompare(b.created_at) : a.date.localeCompare(b.date)
  );
  return entries;
}
function runningSign(partyType) {
  return partyType === "customer" || partyType === "company" ? 1 : -1;
}
async function getLedger(payload) {
  const name = await partyName(payload.party_type, payload.party_id);
  const all = await buildEntries(payload.party_type, payload.party_id, payload.plant_id);
  const sign = runningSign(payload.party_type);
  let opening = 0;
  let visible = all;
  if (payload.from) {
    const before = all.filter((e) => e.date < payload.from);
    opening = before.reduce((acc, e) => acc + sign * (e.debit - e.credit), 0);
    visible = all.filter((e) => e.date >= payload.from);
  }
  if (payload.to) visible = visible.filter((e) => e.date <= payload.to);
  const entries = [];
  let bal = opening;
  if (payload.from) {
    entries.push({
      date: payload.from,
      particulars: "Opening Balance b/f",
      ref: "",
      debit: 0,
      credit: 0,
      balance: roundMoney2(opening)
    });
  }
  let totalDebit = 0;
  let totalCredit = 0;
  for (const e of visible) {
    bal += sign * (e.debit - e.credit);
    totalDebit += e.debit;
    totalCredit += e.credit;
    entries.push({
      date: e.date,
      particulars: e.particulars,
      ref: e.ref,
      qty: e.qty,
      uom: e.uom,
      debit: roundMoney2(e.debit),
      credit: roundMoney2(e.credit),
      balance: roundMoney2(bal),
      payment_id: e.payment_id
    });
  }
  let extra = {};
  if (payload.party_type === "plant") {
    const rp = await plantReceivablePayable(payload.party_id);
    extra = { opening: await plantOpeningNet(payload.party_id, sign), receivable: rp.receivable, payable: rp.payable };
  }
  return {
    party_type: payload.party_type,
    party_id: payload.party_id,
    party_name: name,
    entries,
    total_debit: roundMoney2(totalDebit),
    total_credit: roundMoney2(totalCredit),
    closing: roundMoney2(bal),
    ...extra
  };
}
async function plantReceivablePayable(plantId) {
  const d = getDb();
  const r = await d.prepare(
    `SELECT COALESCE(SUM(
          (COALESCE(amount,0)
           + CASE WHEN transport_billed=1 THEN transport_charge ELSE 0 END
           + CASE WHEN other_billed=1 THEN other_charge ELSE 0 END)
          - COALESCE(paid_amount,0)),0)
        + (SELECT COALESCE(SUM(CASE WHEN direction='debit' THEN amount ELSE -amount END),0)
             FROM opening_balances WHERE party_type='customer' AND plant_id=@pid) AS q
       FROM dispatches WHERE plant_id = @pid AND to_plant_id IS NULL`
  ).get({ pid: plantId });
  const p = await d.prepare(
    `SELECT
        (SELECT COALESCE(SUM(COALESCE(amount,0)-COALESCE(paid_amount,0)),0)
           FROM purchases WHERE plant_id=@pid AND linked_dispatch_id IS NULL) +
        (SELECT COALESCE(SUM(COALESCE(amount,0)-COALESCE(paid_amount,0)),0)
           FROM diesel_purchases WHERE plant_id=@pid) +
        (SELECT COALESCE(SUM(COALESCE(amount,0)-COALESCE(paid_amount,0)),0)
           FROM plant_expenses WHERE plant_id=@pid AND outsource_id IS NOT NULL) +
        (SELECT COALESCE(SUM(ROUND(COALESCE(buy_rate,0)*COALESCE(sale_quantity,quantity),2)),0)
           FROM dispatches WHERE plant_id=@pid AND outsourced=1 AND outsource_id IS NOT NULL AND to_plant_id IS NULL) +
        (SELECT COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END),0)
           FROM opening_balances WHERE party_type IN ('supplier','transporter','outsource') AND plant_id=@pid) AS q`
  ).get({ pid: plantId });
  return { receivable: roundMoney2(r.q), payable: roundMoney2(p.q) };
}
async function plantOpeningNet(plantId, sign) {
  const row = await getDb().prepare(
    `SELECT COALESCE(SUM(CASE WHEN direction='debit' THEN amount ELSE -amount END),0) AS net
       FROM opening_balances WHERE party_type='plant' AND party_id=?`
  ).get(plantId);
  return roundMoney2(sign * (Number(row.net) || 0));
}
async function getPartyBalances(payload) {
  const d = getDb();
  let parties;
  if (payload.party_type === "rack") {
    parties = await d.prepare(`SELECT id, rack_no AS name FROM racks ORDER BY date DESC, id DESC`).all();
  } else if (payload.party_type === "company") {
    parties = await d.prepare(`SELECT id, name FROM companies ORDER BY name`).all();
  } else if (payload.party_type === "plant") {
    parties = await d.prepare(`SELECT id, name FROM plants ORDER BY name`).all();
  } else if (payload.party_type === "business") {
    parties = await d.prepare(`SELECT id, name FROM businesses ORDER BY name`).all();
  } else if (payload.party_type === "outsource") {
    parties = await d.prepare(`SELECT id, name FROM outsource ORDER BY name`).all();
  } else if (payload.party_type === "rack_vehicle") {
    const clause = payload.plant_id ? `WHERE ${plantScopeSql("t", "rack_vehicle")}` : "";
    parties = await d.prepare(`SELECT t.id, t.vehicle_no AS name FROM rack_vehicles t ${clause} ORDER BY t.vehicle_no`).all(payload.plant_id ? { plant_id: payload.plant_id } : {});
  } else if (payload.party_type === "rack_jcb") {
    const clause = payload.plant_id ? `WHERE ${plantScopeSql("t", "rack_jcb")}` : "";
    parties = await d.prepare(`SELECT t.id, t.name FROM rack_jcbs t ${clause} ORDER BY t.name`).all(payload.plant_id ? { plant_id: payload.plant_id } : {});
  } else if (payload.party_type === "machine") {
    const clause = payload.plant_id ? `WHERE EXISTS (SELECT 1 FROM asset_plants ap WHERE ap.asset_id = a.id AND ap.plant_id = @plant_id)
           OR NOT EXISTS (SELECT 1 FROM asset_plants ap2 WHERE ap2.asset_id = a.id)` : "";
    parties = await d.prepare(`SELECT a.id, a.name FROM assets a ${clause} ORDER BY a.asset_type, a.name`).all(payload.plant_id ? { plant_id: payload.plant_id } : {});
  } else {
    const table = PARTY_TABLE[payload.party_type];
    if (!table) throw new Error("Invalid party type.");
    const conds = [];
    if (payload.plant_id) conds.push(plantScopeSql("t", payload.party_type));
    if (payload.party_type === "customer" || payload.party_type === "supplier") conds.push("t.plant_ref_id IS NULL");
    const clause = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    parties = await d.prepare(`SELECT t.id, t.name FROM ${table} t ${clause} ORDER BY t.name`).all(payload.plant_id ? { plant_id: payload.plant_id } : {});
  }
  const sign = runningSign(payload.party_type);
  const result = [];
  for (const p of parties) {
    const entries = await buildEntries(payload.party_type, p.id, payload.plant_id);
    const totalDebit = entries.reduce((a, e) => a + e.debit, 0);
    const totalCredit = entries.reduce((a, e) => a + e.credit, 0);
    result.push({
      party_id: p.id,
      name: p.name,
      total_debit: roundMoney2(totalDebit),
      total_credit: roundMoney2(totalCredit),
      balance: roundMoney2(sign * (totalDebit - totalCredit))
    });
  }
  return result;
}
async function listOpeningBalances(payload) {
  return await getDb().prepare(
    `SELECT id, party_type, party_id, plant_id, amount, direction, as_of_date, remarks
       FROM opening_balances WHERE party_type = ? AND party_id = ? ORDER BY plant_id`
  ).all(payload.party_type, payload.party_id);
}
async function getOpeningBalance(payload) {
  const rows = await listOpeningBalances(payload);
  return rows.find((r) => r.plant_id == null) ?? rows[0] ?? null;
}
async function setOpeningBalances(payload) {
  if (!OPENING_TYPES.includes(payload.party_type))
    return { ok: false, error: "Opening balance is only available for customer, supplier, transporter, outsource and plant ledgers." };
  if (!payload.party_id) return { ok: false, error: "Select a party." };
  const d = getDb();
  await d.transaction(async () => {
    await d.prepare(`DELETE FROM opening_balances WHERE party_type = ? AND party_id = ?`).run(payload.party_type, payload.party_id);
    const stmt = d.prepare(
      `INSERT INTO opening_balances (party_type, party_id, plant_id, amount, direction, as_of_date, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const r of payload.rows ?? []) {
      const amount = roundMoney2(Number(r.amount) || 0);
      if (!(amount > 0)) continue;
      const direction = r.direction === "credit" ? "credit" : "debit";
      const asOf = r.as_of_date || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      await stmt.run(
        payload.party_type,
        payload.party_id,
        r.plant_id ? Number(r.plant_id) : null,
        amount,
        direction,
        asOf,
        r.remarks ?? ""
      );
    }
  });
  return { ok: true };
}
async function setOpeningBalance(payload) {
  return setOpeningBalances({
    party_type: payload.party_type,
    party_id: payload.party_id,
    rows: [{ plant_id: payload.plant_id ?? null, amount: payload.amount, direction: payload.direction, as_of_date: payload.as_of_date, remarks: payload.remarks }]
  });
}
async function deleteOpeningBalance(payload) {
  await getDb().prepare(`DELETE FROM opening_balances WHERE party_type = ? AND party_id = ?`).run(payload.party_type, payload.party_id);
  return { ok: true };
}
async function getAllDues(payload = {}) {
  const types = ["customer", "supplier", "transporter", "outsource", "rack_vehicle", "rack_jcb"];
  const rows = [];
  for (const t of types) {
    const balances = await getPartyBalances({ party_type: t, plant_id: payload.plant_id });
    for (const b of balances) {
      rows.push({
        party_type: t,
        party_id: b.party_id,
        name: b.name,
        total_debit: b.total_debit,
        total_credit: b.total_credit,
        balance: b.balance,
        kind: t === "customer" ? "receivable" : "payable"
      });
    }
  }
  return rows;
}

// src/main/services/assets.ts
async function attachPlants(d, assets) {
  if (assets.length === 0) return assets;
  const rows = await d.prepare(
    `SELECT ap.asset_id, ap.plant_id, p.name AS plant_name
       FROM asset_plants ap JOIN plants p ON p.id = ap.plant_id ORDER BY p.name`
  ).all();
  const byAsset = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const e = byAsset.get(r.asset_id) ?? { ids: [], names: [] };
    e.ids.push(r.plant_id);
    e.names.push(r.plant_name);
    byAsset.set(r.asset_id, e);
  }
  for (const a of assets) {
    const e = byAsset.get(a.id);
    a.plant_ids = e?.ids ?? [];
    a.plant_names = e?.names ?? [];
  }
  return assets;
}
async function listAssets(payload = {}) {
  const d = getDb();
  const clause = payload.plant_id ? `WHERE EXISTS (SELECT 1 FROM asset_plants ap WHERE ap.asset_id = a.id AND ap.plant_id = @plant_id)
         OR NOT EXISTS (SELECT 1 FROM asset_plants ap2 WHERE ap2.asset_id = a.id)` : "";
  const assets = await d.prepare(
    `SELECT a.*, b.name AS business_name
       FROM assets a
       LEFT JOIN businesses b ON b.id = a.business_id
       ${clause}
       ORDER BY a.asset_type, a.name`
  ).all(payload);
  return attachPlants(d, assets);
}
function plantSet(p) {
  if (Array.isArray(p.plant_ids)) return [...new Set(p.plant_ids.map(Number).filter((n) => n > 0))];
  return p.plant_id ? [Number(p.plant_id)] : [];
}
async function writeAssetPlants(d, assetId, plantIds) {
  await d.prepare(`DELETE FROM asset_plants WHERE asset_id = ?`).run(assetId);
  const stmt = d.prepare(`INSERT INTO asset_plants (asset_id, plant_id) VALUES (?, ?)`);
  for (const pid of plantIds) await stmt.run(assetId, pid);
}
function meterTypeOf(p) {
  if (p.meter_type === "hour" || p.meter_type === "km") return p.meter_type;
  return p.asset_type === "vehicle" ? "km" : "hour";
}
function stdConsumption(p) {
  return p.standard_consumption == null || p.standard_consumption === "" ? null : Number(p.standard_consumption);
}
async function createAsset(p) {
  const d = getDb();
  if (!p.name?.trim()) throw new Error("Name is required.");
  const plants = plantSet(p);
  const id = await d.transaction(async () => {
    const info = await d.prepare(
      `INSERT INTO assets (name, asset_type, category, identifier, plant_id, business_id, meter_type, standard_consumption, status, remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      properCase(p.name),
      p.asset_type || "machine",
      properCase(p.category),
      (p.identifier ?? "").trim().toUpperCase(),
      plants[0] ?? null,
      p.business_id ?? null,
      meterTypeOf(p),
      stdConsumption(p),
      p.status || "active",
      p.remarks ?? ""
    );
    const assetId = Number(info.lastInsertRowid);
    await writeAssetPlants(d, assetId, plants);
    return assetId;
  });
  return await d.prepare(`SELECT * FROM assets WHERE id = ?`).get(id);
}
async function updateAsset(p) {
  const d = getDb();
  const plants = plantSet(p);
  await d.transaction(async () => {
    await d.prepare(
      `UPDATE assets SET name=?, asset_type=?, category=?, identifier=?, plant_id=?, business_id=?, meter_type=?, standard_consumption=?, status=?, remarks=? WHERE id=?`
    ).run(
      properCase(p.name),
      p.asset_type || "machine",
      properCase(p.category),
      (p.identifier ?? "").trim().toUpperCase(),
      plants[0] ?? null,
      p.business_id ?? null,
      meterTypeOf(p),
      stdConsumption(p),
      p.status || "active",
      p.remarks ?? "",
      p.id
    );
    await writeAssetPlants(d, p.id, plants);
  });
  return await d.prepare(`SELECT * FROM assets WHERE id = ?`).get(p.id);
}
async function moveAsset(p) {
  const d = getDb();
  const old = await d.prepare(`SELECT plant_id FROM assets WHERE id = ?`).get(p.id);
  if (!old) throw new Error("Machine not found.");
  const plants = [...new Set((p.plant_ids ?? []).map(Number).filter((n) => n > 0))];
  await d.transaction(async () => {
    await d.prepare(
      `INSERT INTO asset_plant_moves (asset_id, from_plant_id, to_plant_id, date, remarks) VALUES (?, ?, ?, ?, ?)`
    ).run(p.id, old.plant_id ?? null, plants[0] ?? null, p.date || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10), p.remarks ?? "");
    await d.prepare(`UPDATE assets SET plant_id = ? WHERE id = ?`).run(plants[0] ?? null, p.id);
    await writeAssetPlants(d, p.id, plants);
  });
  return await d.prepare(`SELECT * FROM assets WHERE id = ?`).get(p.id);
}
async function assetMoves(payload) {
  return await getDb().prepare(
    `SELECT m.id, m.date, m.remarks, fp.name AS from_plant_name, tp.name AS to_plant_name
       FROM asset_plant_moves m
       LEFT JOIN plants fp ON fp.id = m.from_plant_id
       LEFT JOIN plants tp ON tp.id = m.to_plant_id
       WHERE m.asset_id = ? ORDER BY m.date DESC, m.id DESC`
  ).all(payload.id);
}
async function assetReport(payload) {
  const d = getDb();
  const a = await d.prepare(
    `SELECT a.name, b.name AS business_name FROM assets a
       LEFT JOIN businesses b ON b.id = a.business_id WHERE a.id = ?`
  ).get(payload.id);
  if (!a) throw new Error("Asset not found.");
  const litres2 = (await d.prepare(`SELECT COALESCE(SUM(litres),0) AS q FROM diesel_issues WHERE asset_id = ?`).get(payload.id)).q;
  const dieselCost = litres2 * await avgDieselRate();
  const exp = await d.prepare(
    `SELECT
        COALESCE(SUM(CASE WHEN category='maintenance' THEN amount ELSE 0 END),0) AS maintenance,
        COALESCE(SUM(CASE WHEN category IN ('tipper_rent','equipment_rent') THEN amount ELSE 0 END),0) AS rent,
        COALESCE(SUM(CASE WHEN category NOT IN ('maintenance','tipper_rent','equipment_rent') THEN amount ELSE 0 END),0) AS other
       FROM plant_expenses WHERE asset_id = ?`
  ).get(payload.id);
  const wages = (await d.prepare(`SELECT COALESCE(SUM(amount),0) AS q FROM wage_entries WHERE asset_id = ?`).get(payload.id)).q;
  const money8 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const net = money8(exp.rent - dieselCost - exp.maintenance - exp.other - wages);
  return {
    asset_id: payload.id,
    asset_name: a.name,
    business_name: a.business_name,
    diesel_litres: money8(litres2),
    diesel_cost: money8(dieselCost),
    maintenance: money8(exp.maintenance),
    other_expense: money8(exp.other),
    wages: money8(wages),
    rent_income: money8(exp.rent),
    net
  };
}
async function deleteAsset(payload) {
  const d = getDb();
  const used = await d.prepare(`SELECT COUNT(*) AS c FROM plant_expenses WHERE asset_id = ?`).get(payload.id);
  if (used.c > 0) {
    return { ok: false, error: "Cannot delete: this asset has expense records." };
  }
  await d.transaction(async () => {
    await d.prepare(`DELETE FROM machine_logs WHERE asset_id = ?`).run(payload.id);
    await d.prepare(`DELETE FROM asset_documents WHERE asset_id = ?`).run(payload.id);
    await d.prepare(`DELETE FROM assets WHERE id = ?`).run(payload.id);
  });
  return { ok: true };
}

// src/main/services/machinery.ts
function money3(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
function round32(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1e3) / 1e3;
}
async function listMachineLogs(payload) {
  const d = getDb();
  const where = ["ml.asset_id = @asset_id"];
  const params = { asset_id: payload.asset_id };
  if (payload.from) {
    where.push("ml.date >= @from");
    params.from = payload.from;
  }
  if (payload.to) {
    where.push("ml.date <= @to");
    params.to = payload.to;
  }
  return await d.prepare(
    `SELECT ml.*, a.name AS asset_name FROM machine_logs ml
       JOIN assets a ON a.id = ml.asset_id
       WHERE ${where.join(" AND ")}
       ORDER BY ml.date DESC, ml.id DESC`
  ).all(params);
}
function normalizeLog(p) {
  const opening = Number(p.opening_meter) || 0;
  const closing = Number(p.closing_meter) || 0;
  if (closing < opening) throw new Error("Closing meter cannot be less than the opening meter.");
  const fuel = p.fuel_litres == null || p.fuel_litres === "" ? null : Number(p.fuel_litres);
  if (fuel != null && fuel < 0) throw new Error("Fuel cannot be negative.");
  const rate = p.rate == null || p.rate === "" ? null : Number(p.rate);
  if (rate != null && rate < 0) throw new Error("Rate cannot be negative.");
  const usage = round32(closing - opening);
  return {
    work_type: properCase(p.work_type || ""),
    opening: round32(opening),
    closing: round32(closing),
    usage,
    fuel: fuel == null ? null : round32(fuel),
    rate: rate == null ? null : round32(rate),
    amount: rate == null ? null : money3(usage * rate)
  };
}
async function lastMachineMeter(payload) {
  if (!payload.asset_id) return { closing_meter: null };
  const row = await getDb().prepare(
    `SELECT closing_meter FROM machine_logs WHERE asset_id = ? ORDER BY date DESC, id DESC LIMIT 1`
  ).get(payload.asset_id);
  return { closing_meter: row ? Number(row.closing_meter) : null };
}
async function addMachineLog(p) {
  const d = getDb();
  if (!p.asset_id) throw new Error("Select a machine.");
  if (!p.date) throw new Error("Date is required.");
  const n = normalizeLog(p);
  const info = await d.prepare(
    `INSERT INTO machine_logs (asset_id, date, work_type, opening_meter, closing_meter, usage_qty, fuel_litres, rate, amount, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(p.asset_id, p.date, n.work_type, n.opening, n.closing, n.usage, n.fuel, n.rate, n.amount, p.remarks ?? "");
  return await d.prepare(`SELECT * FROM machine_logs WHERE id = ?`).get(info.lastInsertRowid);
}
async function updateMachineLog(p) {
  const d = getDb();
  if (!p.id) throw new Error("Missing log id.");
  if (!p.date) throw new Error("Date is required.");
  const n = normalizeLog(p);
  await d.prepare(
    `UPDATE machine_logs SET date=?, work_type=?, opening_meter=?, closing_meter=?, usage_qty=?, fuel_litres=?, rate=?, amount=?, remarks=? WHERE id=?`
  ).run(p.date, n.work_type, n.opening, n.closing, n.usage, n.fuel, n.rate, n.amount, p.remarks ?? "", p.id);
  return await d.prepare(`SELECT * FROM machine_logs WHERE id = ?`).get(p.id);
}
async function deleteMachineLog(payload) {
  await getDb().prepare(`DELETE FROM machine_logs WHERE id = ?`).run(payload.id);
  return { ok: true };
}
async function machineBalanceSheet(payload) {
  const d = getDb();
  const a = await d.prepare(
    `SELECT a.name, a.meter_type, a.standard_consumption, b.name AS business_name
       FROM assets a LEFT JOIN businesses b ON b.id = a.business_id WHERE a.id = ?`
  ).get(payload.asset_id);
  if (!a) throw new Error("Machine not found.");
  const dateClause = (alias) => {
    const parts = [];
    const params = {};
    if (payload.from) {
      parts.push(`${alias}.date >= @from`);
      params.from = payload.from;
    }
    if (payload.to) {
      parts.push(`${alias}.date <= @to`);
      params.to = payload.to;
    }
    return { sql: parts.length ? " AND " + parts.join(" AND ") : "", params };
  };
  const dl = dateClause("ml");
  const logAgg = await d.prepare(
    `SELECT COALESCE(SUM(usage_qty),0) AS usage_qty,
              COALESCE(SUM(CASE WHEN fuel_litres IS NOT NULL THEN fuel_litres ELSE 0 END),0) AS log_fuel,
              SUM(CASE WHEN fuel_litres IS NOT NULL THEN 1 ELSE 0 END) AS fuel_rows,
              COALESCE(SUM(CASE WHEN amount IS NOT NULL THEN amount ELSE 0 END),0) AS run_income,
              MIN(opening_meter) AS min_open, MAX(closing_meter) AS max_close
       FROM machine_logs ml WHERE ml.asset_id = @asset_id${dl.sql}`
  ).get({ asset_id: payload.asset_id, ...dl.params });
  const rate = await avgDieselRate();
  const di = dateClause("di");
  const dieselRow = await d.prepare(
    `SELECT COALESCE(SUM(litres),0) AS litres,
              COALESCE(SUM(COALESCE(amount, litres * @avg)),0) AS cost
       FROM diesel_issues di WHERE di.asset_id = @asset_id${di.sql}`
  ).get({ asset_id: payload.asset_id, avg: rate, ...di.params });
  const dieselLitres = round32(dieselRow.litres);
  let fuel = 0;
  let fuelSource = "none";
  if (logAgg.fuel_rows > 0) {
    fuel = logAgg.log_fuel;
    fuelSource = "logbook";
  } else if (dieselLitres > 0) {
    fuel = dieselLitres;
    fuelSource = "diesel";
  }
  const usage = round32(logAgg.usage_qty);
  const dieselCost = money3(dieselRow.cost);
  const pe = dateClause("pe");
  const exp = await d.prepare(
    `SELECT
        COALESCE(SUM(CASE WHEN category='maintenance' THEN amount ELSE 0 END),0) AS maintenance,
        COALESCE(SUM(CASE WHEN category='fixed' THEN amount ELSE 0 END),0) AS fixed_cost,
        COALESCE(SUM(CASE WHEN category IN ('tipper_rent','equipment_rent') THEN amount ELSE 0 END),0) AS rent,
        COALESCE(SUM(CASE WHEN category NOT IN ('maintenance','fixed','tipper_rent','equipment_rent') THEN amount ELSE 0 END),0) AS other
       FROM plant_expenses pe WHERE pe.asset_id = @asset_id${pe.sql}`
  ).get({ asset_id: payload.asset_id, ...pe.params });
  const we = dateClause("we");
  const wages = (await d.prepare(`SELECT COALESCE(SUM(amount),0) AS q FROM wage_entries we WHERE we.asset_id = @asset_id${we.sql}`).get({ asset_id: payload.asset_id, ...we.params })).q;
  const totalCost = money3(dieselCost + exp.maintenance + exp.fixed_cost + exp.other + wages);
  const runIncome = money3(logAgg.run_income);
  const totalIncome = money3(exp.rent + runIncome);
  return {
    asset_id: payload.asset_id,
    asset_name: a.name,
    meter_type: a.meter_type === "km" ? "km" : "hour",
    business_name: a.business_name,
    from: payload.from ?? "",
    to: payload.to ?? "",
    usage_qty: usage,
    fuel_litres: round32(fuel),
    fuel_source: fuelSource,
    actual_consumption: usage > 0 ? round32(fuel / usage) : null,
    standard_consumption: a.standard_consumption ?? null,
    opening_meter: logAgg.min_open,
    closing_meter: logAgg.max_close,
    diesel_cost: dieselCost,
    maintenance: money3(exp.maintenance),
    fixed_expense: money3(exp.fixed_cost),
    other_expense: money3(exp.other),
    wages: money3(wages),
    rent_income: money3(exp.rent),
    run_income: runIncome,
    total_income: totalIncome,
    total_cost: totalCost,
    net: money3(totalIncome - totalCost),
    cost_per_unit: usage > 0 ? money3(totalCost / usage) : null
  };
}
async function mileageReport(payload) {
  const d = getDb();
  const typeClause = payload.asset_type === "machine" || payload.asset_type === "vehicle" ? " AND a.asset_type = @atype" : "";
  const assets = await d.prepare(
    `SELECT a.id, a.name, a.asset_type, a.meter_type, a.standard_consumption
       FROM assets a WHERE a.status = 'active'${typeClause} ORDER BY a.asset_type, a.name`
  ).all(payload.asset_type ? { atype: payload.asset_type } : {});
  const rows = [];
  for (const a of assets) {
    const bs = await machineBalanceSheet({ asset_id: a.id, from: payload.from, to: payload.to });
    if (bs.usage_qty <= 0 && bs.fuel_litres <= 0) continue;
    rows.push({
      asset_id: a.id,
      asset_name: a.name,
      asset_type: a.asset_type,
      meter_type: a.meter_type === "km" ? "km" : "hour",
      usage_qty: bs.usage_qty,
      fuel_litres: bs.fuel_litres,
      actual_consumption: bs.actual_consumption,
      standard_consumption: bs.standard_consumption,
      over: bs.actual_consumption != null && bs.standard_consumption != null && bs.actual_consumption > bs.standard_consumption
    });
  }
  return rows;
}
async function machineryOverview() {
  const d = getDb();
  const assets = await d.prepare(`SELECT id, meter_type, standard_consumption FROM assets`).all();
  const diesel = await d.prepare(`SELECT asset_id, COALESCE(SUM(litres),0) AS litres FROM diesel_issues WHERE asset_id IS NOT NULL GROUP BY asset_id`).all();
  const logs = await d.prepare(
    `SELECT asset_id, COALESCE(SUM(usage_qty),0) AS usage_qty,
              COALESCE(SUM(CASE WHEN fuel_litres IS NOT NULL THEN fuel_litres ELSE 0 END),0) AS log_fuel,
              SUM(CASE WHEN fuel_litres IS NOT NULL THEN 1 ELSE 0 END) AS fuel_rows
       FROM machine_logs GROUP BY asset_id`
  ).all();
  const maint = await d.prepare(`SELECT asset_id, COALESCE(SUM(amount),0) AS amt FROM plant_expenses WHERE asset_id IS NOT NULL AND category='maintenance' GROUP BY asset_id`).all();
  const dieselBy = new Map(diesel.map((r) => [r.asset_id, r.litres]));
  const logBy = new Map(logs.map((r) => [r.asset_id, r]));
  const maintBy = new Map(maint.map((r) => [r.asset_id, r.amt]));
  return assets.map((a) => {
    const lg = logBy.get(a.id);
    const usage = round32(lg?.usage_qty ?? 0);
    const dieselLitres = round32(dieselBy.get(a.id) ?? 0);
    const fuel = lg && lg.fuel_rows > 0 ? round32(lg.log_fuel) : dieselLitres;
    const actual = usage > 0 && fuel > 0 ? round32(fuel / usage) : null;
    const std = a.standard_consumption ?? null;
    return {
      asset_id: a.id,
      meter_type: a.meter_type === "km" ? "km" : "hour",
      usage_qty: usage,
      diesel_litres: dieselLitres,
      fuel_litres: fuel,
      actual_consumption: actual,
      standard_consumption: std,
      maintenance: money3(maintBy.get(a.id) ?? 0),
      over: actual != null && std != null && actual > std
    };
  });
}
async function listAllLogs(payload = {}) {
  const d = getDb();
  const where = [];
  const params = {};
  if (payload.asset_id) {
    where.push("ml.asset_id = @asset_id");
    params.asset_id = payload.asset_id;
  }
  if (payload.from) {
    where.push("ml.date >= @from");
    params.from = payload.from;
  }
  if (payload.to) {
    where.push("ml.date <= @to");
    params.to = payload.to;
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return await d.prepare(
    `SELECT ml.*, a.name AS asset_name FROM machine_logs ml
       JOIN assets a ON a.id = ml.asset_id ${clause}
       ORDER BY ml.date DESC, ml.id DESC`
  ).all(params);
}
var DOC_TYPES = ["insurance", "permit", "fitness", "puc", "rc", "tax", "other"];
async function listAssetDocuments(payload) {
  const d = getDb();
  const rows = await d.prepare(`SELECT * FROM asset_documents WHERE asset_id = ? ORDER BY expiry_date IS NULL, expiry_date, id`).all(payload.asset_id);
  return rows.map((r) => ({ ...r, ...reminderFields(r.expiry_date) }));
}
function todayStr() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function reminderFields(expiry) {
  if (!expiry) return { days_left: null, reminder_status: "ok" };
  const ms = (/* @__PURE__ */ new Date(expiry + "T00:00:00")).getTime() - (/* @__PURE__ */ new Date(todayStr() + "T00:00:00")).getTime();
  const days = Math.round(ms / 864e5);
  return { days_left: days, reminder_status: days < 0 ? "expired" : "ok" };
}
function normalizeDoc(p) {
  const file = (p.file_data ?? "").trim();
  if (file && !file.startsWith("data:")) throw new Error("Attachment must be a file.");
  if (file.length > 6e6) throw new Error("Attachment is too large \u2014 use a smaller file.");
  return {
    doc_type: DOC_TYPES.includes(p.doc_type) ? p.doc_type : "other",
    number: (p.number ?? "").trim().toUpperCase(),
    issue_date: p.issue_date || null,
    expiry_date: p.expiry_date || null,
    file_data: file || null
  };
}
async function addAssetDocument(p) {
  const d = getDb();
  if (!p.asset_id) return { ok: false, error: "Select a machine." };
  try {
    const n = normalizeDoc(p);
    await d.prepare(
      `INSERT INTO asset_documents (asset_id, doc_type, number, issue_date, expiry_date, file_data, remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(p.asset_id, n.doc_type, n.number, n.issue_date, n.expiry_date, n.file_data, p.remarks ?? "");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
async function updateAssetDocument(p) {
  const d = getDb();
  if (!p.id) return { ok: false, error: "Missing document id." };
  try {
    const n = normalizeDoc(p);
    await d.prepare(
      `UPDATE asset_documents SET doc_type=?, number=?, issue_date=?, expiry_date=?, file_data=?, remarks=? WHERE id=?`
    ).run(n.doc_type, n.number, n.issue_date, n.expiry_date, n.file_data, p.remarks ?? "", p.id);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
async function deleteAssetDocument(payload) {
  await getDb().prepare(`DELETE FROM asset_documents WHERE id = ?`).run(payload.id);
  return { ok: true };
}
async function getDocumentReminders(payload = {}) {
  const d = getDb();
  const days = payload.days != null ? Number(payload.days) : await getReminderDays();
  const rows = await d.prepare(
    `SELECT ad.id, ad.asset_id, ad.doc_type, ad.number, ad.issue_date, ad.expiry_date, ad.remarks, ad.created_at,
              a.name AS asset_name
       FROM asset_documents ad JOIN assets a ON a.id = ad.asset_id
       WHERE ad.expiry_date IS NOT NULL AND ad.expiry_date <> ''
       ORDER BY ad.expiry_date`
  ).all();
  return rows.map((r) => {
    const f = reminderFields(r.expiry_date);
    const status = f.days_left == null ? "ok" : f.days_left < 0 ? "expired" : f.days_left <= days ? "due" : "ok";
    return { ...r, days_left: f.days_left, reminder_status: status };
  }).filter((r) => r.reminder_status !== "ok");
}
async function putSetting2(key, value) {
  const sql = dbKind() === "mysql" ? "INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)" : "INSERT INTO settings (`key`, value) VALUES (?, ?) ON CONFLICT(`key`) DO UPDATE SET value = excluded.value";
  await getDb().prepare(sql).run(key, value);
}
async function getReminderDays() {
  const row = await getDb().prepare("SELECT value FROM settings WHERE `key` = ?").get("reminder_days");
  const n = Number(row?.value);
  return Number.isFinite(n) && n > 0 ? n : 30;
}
async function getReminderSettings() {
  return { days: await getReminderDays() };
}
async function setReminderDays(payload) {
  const n = Math.max(1, Math.round(Number(payload.days) || 30));
  await putSetting2("reminder_days", String(n));
  return { ok: true };
}

// src/main/services/parts.ts
var TYPES = ["new", "repairable", "scrap"];
function round33(n) {
  return Math.round((Number(n) + Number.EPSILON) * 1e3) / 1e3;
}
function round24(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}
function rateOrNull(v) {
  const n = Number(v);
  return v != null && v !== "" && n > 0 ? round24(n) : null;
}
function normalizeType(value) {
  return TYPES.includes(value) ? value : "new";
}
async function partBalance(d, partId) {
  const row = await d.prepare(`SELECT COALESCE(SUM(quantity),0) AS qty FROM spare_part_movements WHERE part_id = ?`).get(partId);
  return round33(Number(row.qty) || 0);
}
async function partFifoCost(d, partId, qty, excludeMovementId, excludeRef) {
  const q = round33(Math.abs(Number(qty) || 0));
  const exId = excludeMovementId ? Number(excludeMovementId) : 0;
  const layers = await d.prepare(
    `SELECT quantity, rate FROM spare_part_movements
       WHERE part_id = ? AND quantity > 0 ${exId ? "AND id <> ?" : ""}
       ORDER BY date, id`
  ).all(...exId ? [partId, exId] : [partId]);
  const totalIn = layers.reduce((a, l) => a + (Number(l.quantity) || 0), 0);
  const outClauses = ["part_id = @pid", "quantity < 0"];
  const outParams = { pid: partId };
  if (exId) {
    outClauses.push("id <> @exid");
    outParams.exid = exId;
  }
  if (excludeRef) {
    outClauses.push("ref_no <> @ref");
    outParams.ref = excludeRef;
  }
  const outRow = await d.prepare(`SELECT COALESCE(SUM(-quantity),0) AS q FROM spare_part_movements WHERE ${outClauses.join(" AND ")}`).get(outParams);
  const prior = round33(Number(outRow.q) || 0);
  const available = round33(totalIn - prior);
  if (!(q > 0)) return { amount: 0, rate: 0, available, pricedQty: 0, unpricedQty: 0 };
  let skip = prior;
  let need = q;
  let cost = 0;
  let priced = 0;
  let unpriced = 0;
  for (const layer of layers) {
    let avail = Number(layer.quantity) || 0;
    if (skip > 0) {
      const s = Math.min(skip, avail);
      skip -= s;
      avail -= s;
    }
    if (avail <= 0 || need <= 0) continue;
    const take = Math.min(avail, need);
    if (layer.rate != null && Number(layer.rate) > 0) {
      cost += take * Number(layer.rate);
      priced += take;
    } else unpriced += take;
    need -= take;
  }
  const amount = round24(cost);
  return {
    amount,
    rate: priced > 0 ? round24(amount / priced) : 0,
    available,
    pricedQty: round33(priced),
    unpricedQty: round33(unpriced + Math.max(0, need))
  };
}
async function partFifoQuote(payload) {
  if (!payload.part_id) return { amount: 0, rate: 0, available: 0, hasCost: false, unpricedQty: 0 };
  const f = await partFifoCost(getDb(), Number(payload.part_id), Number(payload.quantity) || 0, payload.exclude);
  return { amount: f.amount, rate: f.rate, available: f.available, hasCost: f.amount > 0, unpricedQty: f.unpricedQty };
}
async function partFifoQuoteMany(payload) {
  const d = getDb();
  const items = [];
  let total = 0;
  for (const it of payload.items ?? []) {
    const pid = Number(it.part_id);
    const qty = Number(it.quantity) || 0;
    if (!pid || !(qty > 0)) continue;
    const f = await partFifoCost(d, pid, qty, void 0, payload.exclude_ref);
    items.push({ part_id: pid, quantity: qty, amount: f.amount, rate: f.rate, available: f.available, hasCost: f.amount > 0, unpricedQty: f.unpricedQty });
    total += f.amount;
  }
  return { items, total: round24(total) };
}
async function issuePartsForRef(d, opts) {
  let total = 0;
  for (const it of opts.parts ?? []) {
    const pid = Number(it.part_id);
    const qty = round33(Math.abs(Number(it.quantity) || 0));
    if (!pid || !(qty > 0)) continue;
    const fifo = await partFifoCost(d, pid, qty);
    await addPartMovement(d, {
      part_id: pid,
      asset_id: opts.asset_id ?? null,
      movement_type: "stock_out",
      ref_no: opts.ref_no,
      quantity: -qty,
      rate: fifo.rate > 0 ? fifo.rate : null,
      amount: fifo.amount > 0 ? fifo.amount : null,
      date: opts.date,
      note: opts.note || "Used in maintenance"
    });
    if (await partBalance(d, pid) < 0) throw new Error("Not enough stock for a part used in this maintenance.");
    total += fifo.amount;
  }
  return round24(total);
}
async function clearPartsForRef(d, refNo) {
  if (!refNo) return;
  await d.prepare(`DELETE FROM spare_part_movements WHERE ref_no = ? AND movement_type='stock_out'`).run(refNo);
}
async function addPartMovement(d, input) {
  const qty = round33(input.quantity);
  if (!qty) return;
  const rate = rateOrNull(input.rate);
  const amount = input.amount != null && input.amount !== "" ? round24(Number(input.amount)) : rate != null ? round24(Math.abs(qty) * rate) : null;
  await d.prepare(
    `INSERT INTO spare_part_movements
       (part_id, asset_id, movement_type, ref_no, quantity, rate, amount, date, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.part_id,
    input.asset_id ?? null,
    input.movement_type,
    input.ref_no ?? "",
    qty,
    rate,
    amount,
    input.date,
    input.note ?? ""
  );
}
async function listParts(payload = {}) {
  const d = getDb();
  const where = [];
  const params = {};
  if (payload.plant_id) {
    where.push("(sp.plant_id IS NULL OR sp.plant_id = @plant_id)");
    params.plant_id = payload.plant_id;
  }
  if (payload.part_type) {
    where.push("sp.part_type = @part_type");
    params.part_type = payload.part_type;
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return await d.prepare(
    `SELECT sp.*, p.name AS plant_name,
              COALESCE((SELECT SUM(m.quantity) FROM spare_part_movements m WHERE m.part_id = sp.id),0) AS balance_qty
       FROM spare_parts sp
       LEFT JOIN plants p ON p.id = sp.plant_id
       ${clause}
       ORDER BY sp.name, sp.part_type, sp.id`
  ).all(params);
}
async function createPart(p) {
  const d = getDb();
  const name = properCase(p.name);
  if (!name) throw new Error("Part name is required.");
  const partType = normalizeType(p.part_type);
  const unit = properCase(p.unit || "PCS") || "PCS";
  const partNo = (p.part_no || "").trim().toUpperCase();
  const rate = rateOrNull(p.rate);
  const duplicate = await d.prepare(
    `SELECT id FROM spare_parts
       WHERE name=? AND part_type=? AND COALESCE(plant_id,0)=COALESCE(?,0)`
  ).get(name, partType, p.plant_id ?? null);
  if (duplicate) throw new Error("This part and stock type already exists for the selected plant.");
  const id = await d.transaction(async () => {
    const info = await d.prepare(
      `INSERT INTO spare_parts (name, part_no, part_type, unit, plant_id, min_qty, rate, remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      name,
      partNo,
      partType,
      unit,
      p.plant_id ?? null,
      Math.max(0, Number(p.min_qty) || 0),
      rate,
      p.remarks ?? ""
    );
    const partId = Number(info.lastInsertRowid);
    const opening = Math.max(0, Number(p.opening_qty) || 0);
    if (opening > 0) {
      await addPartMovement(d, {
        part_id: partId,
        asset_id: null,
        movement_type: "opening",
        quantity: opening,
        rate,
        date: p.opening_date || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
        note: p.opening_note || "Opening stock"
      });
    }
    return partId;
  });
  return (await listParts()).find((x) => x.id === id);
}
async function updatePart(p) {
  if (!p.id) throw new Error("Missing part id.");
  const name = properCase(p.name);
  if (!name) throw new Error("Part name is required.");
  await getDb().prepare(
    `UPDATE spare_parts SET name=?, part_no=?, part_type=?, unit=?, plant_id=?, min_qty=?, rate=?, remarks=? WHERE id=?`
  ).run(
    name,
    (p.part_no || "").trim().toUpperCase(),
    normalizeType(p.part_type),
    properCase(p.unit || "PCS") || "PCS",
    p.plant_id ?? null,
    Math.max(0, Number(p.min_qty) || 0),
    rateOrNull(p.rate),
    p.remarks ?? "",
    p.id
  );
  return (await listParts()).find((x) => x.id === p.id);
}
async function stockIn(payload) {
  const d = getDb();
  const qty = round33(Math.abs(Number(payload.quantity)));
  if (!(qty > 0)) throw new Error("Stock-in quantity must be greater than 0.");
  const rate = rateOrNull(payload.rate);
  await d.transaction(async () => {
    await addPartMovement(d, {
      part_id: payload.part_id,
      asset_id: null,
      movement_type: "stock_in",
      quantity: qty,
      rate,
      date: payload.date,
      note: payload.note || "Stock received"
    });
    if (rate != null) {
      await d.prepare(`UPDATE spare_parts SET rate=? WHERE id=?`).run(rate, payload.part_id);
    }
  });
  return { ok: true };
}
async function stockOut(payload) {
  const d = getDb();
  const qty = round33(Math.abs(Number(payload.quantity)));
  if (!payload.asset_id) throw new Error("Select the machine or vehicle using this part.");
  if (!(qty > 0)) throw new Error("Stock-out quantity must be greater than 0.");
  let fifo = { amount: 0, rate: 0, unpricedQty: 0 };
  await d.transaction(async () => {
    fifo = await partFifoCost(d, payload.part_id, qty);
    await addPartMovement(d, {
      part_id: payload.part_id,
      asset_id: payload.asset_id,
      movement_type: "stock_out",
      quantity: -qty,
      rate: fifo.rate > 0 ? fifo.rate : null,
      amount: fifo.amount > 0 ? fifo.amount : null,
      date: payload.date,
      note: payload.note || "Issued to machine / vehicle"
    });
    if (await partBalance(d, payload.part_id) < 0) throw new Error("Not enough stock for this part.");
  });
  return { ok: true, cost: fifo.amount, hasCost: fifo.amount > 0, unpricedQty: fifo.unpricedQty };
}
async function listPartMovements(payload = {}) {
  const where = [];
  const params = {};
  if (payload.part_id) {
    where.push("m.part_id=@part_id");
    params.part_id = payload.part_id;
  }
  if (payload.asset_id) {
    where.push("m.asset_id=@asset_id");
    params.asset_id = payload.asset_id;
  }
  if (payload.ref_no) {
    where.push("m.ref_no=@ref_no");
    params.ref_no = payload.ref_no;
  }
  if (payload.from) {
    where.push("m.date>=@from");
    params.from = payload.from;
  }
  if (payload.to) {
    where.push("m.date<=@to");
    params.to = payload.to;
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return await getDb().prepare(
    `SELECT m.*, sp.name AS part_name, sp.part_type, sp.unit, a.name AS asset_name
       FROM spare_part_movements m
       JOIN spare_parts sp ON sp.id=m.part_id
       LEFT JOIN assets a ON a.id=m.asset_id
       ${clause}
       ORDER BY m.date DESC, m.id DESC`
  ).all(params);
}
async function deletePart(payload) {
  const d = getDb();
  const used = await d.prepare(`SELECT COUNT(*) AS n FROM spare_part_movements WHERE part_id=? AND movement_type<>'opening'`).get(payload.id);
  if (Number(used.n) > 0) return { ok: false, error: "This part has stock activity and cannot be deleted." };
  await d.transaction(async () => {
    await d.prepare(`DELETE FROM spare_part_movements WHERE part_id=?`).run(payload.id);
    await d.prepare(`DELETE FROM spare_parts WHERE id=?`).run(payload.id);
  });
  return { ok: true };
}

// src/main/services/plantExpenses.ts
function money4(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function num(n) {
  return Math.round((n + Number.EPSILON) * 1e3) / 1e3;
}
async function listPlantExpenses(filter = {}) {
  const d = getDb();
  const where = [];
  const params = {};
  if (filter.plant_id) {
    where.push("e.plant_id = @plant_id");
    params.plant_id = filter.plant_id;
  }
  if (filter.category) {
    where.push("e.category = @category");
    params.category = filter.category;
  }
  if (filter.asset_id) {
    where.push("e.asset_id = @asset_id");
    params.asset_id = filter.asset_id;
  }
  if (filter.from) {
    where.push("e.date >= @from");
    params.from = filter.from;
  }
  if (filter.to) {
    where.push("e.date <= @to");
    params.to = filter.to;
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return await d.prepare(
    `SELECT e.*, p.name AS plant_name, a.name AS asset_name, o.name AS outsource_name
       FROM plant_expenses e
       JOIN plants p ON p.id = e.plant_id
       LEFT JOIN assets a ON a.id = e.asset_id
       LEFT JOIN outsource o ON o.id = e.outsource_id
       ${clause}
       ORDER BY e.date DESC, e.id DESC`
  ).all(params);
}
async function expenseTotals(filter = {}) {
  const d = getDb();
  const where = [];
  const params = {};
  if (filter.plant_id) {
    where.push("plant_id = @plant_id");
    params.plant_id = filter.plant_id;
  }
  if (filter.from) {
    where.push("date >= @from");
    params.from = filter.from;
  }
  if (filter.to) {
    where.push("date <= @to");
    params.to = filter.to;
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return await d.prepare(
    `SELECT category, ROUND(COALESCE(SUM(amount),0),2) AS amount
       FROM plant_expenses ${clause} GROUP BY category ORDER BY amount DESC`
  ).all(params);
}
var CAT_LABEL = {
  electricity: "Electricity",
  maintenance: "Maintenance",
  fixed: "Fixed Cost",
  tipper_rent: "Tipper Rent",
  equipment_rent: "Equipment Rent",
  other: "Other"
};
async function expenseBook(filter = {}) {
  const d = getDb();
  const pid = filter.plant_id;
  const cond = (alias) => {
    const parts = [];
    const params = {};
    if (pid) {
      parts.push(`${alias}.plant_id = @plant_id`);
      params.plant_id = pid;
    }
    if (filter.from) {
      parts.push(`${alias}.date >= @from`);
      params.from = filter.from;
    }
    if (filter.to) {
      parts.push(`${alias}.date <= @to`);
      params.to = filter.to;
    }
    return { sql: parts.length ? `WHERE ${parts.join(" AND ")}` : "", params };
  };
  const rows = [];
  const e = cond("e");
  const exp = await d.prepare(
    `SELECT e.id, e.expense_no, e.date, e.plant_id, p.name AS plant_name, e.category, e.title,
              e.units, e.rate, a.name AS asset_name, e.amount, e.paid_amount, e.payment_status
       FROM plant_expenses e JOIN plants p ON p.id = e.plant_id LEFT JOIN assets a ON a.id = e.asset_id ${e.sql}`
  ).all(e.params);
  for (const x of exp)
    rows.push({
      source: "expense",
      source_label: "Expense",
      id: Number(x.id),
      ref_no: String(x.expense_no),
      date: String(x.date),
      plant_id: Number(x.plant_id),
      plant_name: x.plant_name,
      category: CAT_LABEL[String(x.category)] ?? String(x.category),
      details: x.title || x.asset_name || "-",
      amount: money4(Number(x.amount) || 0),
      paid_amount: money4(Number(x.paid_amount) || 0),
      payment_status: x.payment_status
    });
  const pu = cond("pu");
  const purWhere = pu.sql ? `${pu.sql} AND pu.linked_dispatch_id IS NULL` : "WHERE pu.linked_dispatch_id IS NULL";
  const purchases = await d.prepare(
    `SELECT pu.id, pu.purchase_no, pu.date, pu.plant_id, pl.name AS plant_name, pu.product_name, pu.quantity,
              s.name AS supplier_name, pu.amount, pu.paid_amount, pu.payment_status
       FROM purchases pu JOIN plants pl ON pl.id = pu.plant_id LEFT JOIN suppliers s ON s.id = pu.supplier_id ${purWhere}`
  ).all(pu.params);
  for (const x of purchases)
    rows.push({
      source: "purchase",
      source_label: "Purchase",
      id: 0,
      ref_no: String(x.purchase_no),
      date: String(x.date),
      plant_id: Number(x.plant_id),
      plant_name: x.plant_name,
      category: "Material Purchase",
      details: [x.supplier_name, x.product_name, x.quantity ? `${num(Number(x.quantity))} m\xB3` : ""].filter(Boolean).join(" \xB7 ") || "-",
      amount: money4(Number(x.amount) || 0),
      paid_amount: money4(Number(x.paid_amount) || 0),
      payment_status: x.payment_status
    });
  const dp = cond("dp");
  const diesel = await d.prepare(
    `SELECT dp.id, dp.purchase_no, dp.date, dp.plant_id, pl.name AS plant_name, dp.litres,
              s.name AS supplier_name, dp.amount, dp.paid_amount, dp.payment_status
       FROM diesel_purchases dp JOIN plants pl ON pl.id = dp.plant_id LEFT JOIN suppliers s ON s.id = dp.supplier_id ${dp.sql}`
  ).all(dp.params);
  for (const x of diesel)
    rows.push({
      source: "diesel",
      source_label: "Diesel",
      id: 0,
      ref_no: String(x.purchase_no),
      date: String(x.date),
      plant_id: Number(x.plant_id),
      plant_name: x.plant_name,
      category: "Diesel Purchase",
      details: [x.supplier_name, x.litres ? `${num(Number(x.litres))} L` : ""].filter(Boolean).join(" \xB7 ") || "-",
      amount: money4(Number(x.amount) || 0),
      paid_amount: money4(Number(x.paid_amount) || 0),
      payment_status: x.payment_status
    });
  const w = cond("w");
  const wages = await d.prepare(
    `SELECT w.id, w.entry_no, w.date, w.plant_id, pl.name AS plant_name, w.period,
              em.name AS emp_name, w.amount, w.paid_amount, w.payment_status
       FROM wage_entries w JOIN plants pl ON pl.id = w.plant_id LEFT JOIN employees em ON em.id = w.employee_id ${w.sql}`
  ).all(w.params);
  for (const x of wages)
    rows.push({
      source: "wages",
      source_label: "Wages",
      id: 0,
      ref_no: String(x.entry_no),
      date: String(x.date),
      plant_id: Number(x.plant_id),
      plant_name: x.plant_name,
      category: "Wages",
      details: [x.emp_name, x.period].filter(Boolean).join(" \xB7 ") || "-",
      amount: money4(Number(x.amount) || 0),
      paid_amount: money4(Number(x.paid_amount) || 0),
      payment_status: x.payment_status
    });
  const issues = await listDieselIssuesAll({ plant_id: pid || void 0, from: filter.from, to: filter.to });
  for (const x of issues)
    rows.push({
      source: "diesel_issue",
      source_label: "Diesel Issued",
      informational: true,
      id: x.source === "issue" ? x.id : 0,
      ref_no: x.ref_no,
      date: x.date,
      plant_id: x.plant_id ?? 0,
      plant_name: x.plant_name ?? void 0,
      category: "Diesel Issued",
      details: [x.recipient, x.context, `${num(x.litres)} L`, x.charged_to ? `charged to ${x.charged_to}` : ""].filter(Boolean).join(" \xB7 "),
      amount: money4(Number(x.amount) || 0),
      paid_amount: 0,
      payment_status: "paid"
    });
  rows.sort((a, b) => a.date === b.date ? b.ref_no.localeCompare(a.ref_no) : b.date.localeCompare(a.date));
  return rows;
}
function resolve(p) {
  const cat = p.category;
  let meter_open = p.meter_open == null || p.meter_open === "" ? null : Number(p.meter_open);
  let meter_close = p.meter_close == null || p.meter_close === "" ? null : Number(p.meter_close);
  let units = null;
  let rate = p.rate == null || p.rate === "" ? null : Number(p.rate);
  let hours = p.hours == null || p.hours === "" ? null : Number(p.hours);
  let amount = Number(p.amount) || 0;
  if (cat === "electricity") {
    if (meter_open != null && meter_close != null) units = num(meter_close - meter_open);
    if (units != null && units !== 0) {
      if (amount <= 0 && rate != null) amount = money4(units * rate);
      else if (amount > 0 && (rate == null || rate === 0)) rate = money4(amount / units);
    }
  } else {
    meter_open = null;
    meter_close = null;
  }
  if (cat === "tipper_rent" || cat === "equipment_rent") {
    if (amount <= 0 && hours != null && rate != null) amount = money4(hours * rate);
  } else {
    hours = null;
  }
  if (!(amount > 0)) throw new Error("Amount must be greater than 0.");
  return {
    plant_id: p.plant_id,
    category: cat,
    title: properCase(p.title),
    asset_id: p.asset_id ?? null,
    outsource_id: p.outsource_id ?? null,
    meter_open,
    meter_close,
    units,
    rate,
    hours,
    parts: p.parts ?? "",
    amount: money4(amount),
    payment_status: derivePaymentStatus(amount, Number(p.paid_amount) || 0),
    paid_amount: money4(Number(p.paid_amount) || 0),
    date: p.date,
    remarks: p.remarks ?? ""
  };
}
async function createPlantExpense(p) {
  const d = getDb();
  const id = await d.transaction(async () => {
    const no = await nextNumber("PEX", "plant_expense");
    const partsCost = p.parts_used?.length ? await issuePartsForRef(d, { asset_id: p.asset_id ?? null, ref_no: no, date: p.date, note: properCase(p.title), parts: p.parts_used }) : 0;
    const fields = resolve({ ...p, amount: (Number(p.amount) || 0) + partsCost });
    const info = await d.prepare(
      `INSERT INTO plant_expenses
          (expense_no, plant_id, category, title, asset_id, outsource_id, meter_open, meter_close, units, rate, hours,
           parts, amount, payment_status, paid_amount, date, remarks)
         VALUES (@expense_no,@plant_id,@category,@title,@asset_id,@outsource_id,@meter_open,@meter_close,@units,@rate,@hours,
           @parts,@amount,@payment_status,@paid_amount,@date,@remarks)`
    ).run({ expense_no: no, ...fields });
    return Number(info.lastInsertRowid);
  });
  return await d.prepare(`SELECT * FROM plant_expenses WHERE id = ?`).get(id);
}
async function updatePlantExpense(p) {
  const d = getDb();
  if (!p.id) throw new Error("Missing expense id.");
  const old = await d.prepare(`SELECT expense_no FROM plant_expenses WHERE id = ?`).get(p.id);
  if (!old) throw new Error("Expense not found.");
  await d.transaction(async () => {
    await clearPartsForRef(d, old.expense_no);
    const partsCost = p.parts_used?.length ? await issuePartsForRef(d, { asset_id: p.asset_id ?? null, ref_no: old.expense_no, date: p.date, note: properCase(p.title), parts: p.parts_used }) : 0;
    const fields = resolve({ ...p, amount: (Number(p.amount) || 0) + partsCost });
    await d.prepare(
      `UPDATE plant_expenses SET plant_id=@plant_id, category=@category, title=@title, asset_id=@asset_id,
         outsource_id=@outsource_id,
         meter_open=@meter_open, meter_close=@meter_close, units=@units, rate=@rate, hours=@hours,
         parts=@parts, amount=@amount, payment_status=@payment_status, paid_amount=@paid_amount,
         date=@date, remarks=@remarks WHERE id=@id`
    ).run({ id: p.id, ...fields });
  });
  return await d.prepare(`SELECT * FROM plant_expenses WHERE id = ?`).get(p.id);
}
async function deletePlantExpense(payload) {
  const d = getDb();
  const old = await d.prepare(`SELECT expense_no FROM plant_expenses WHERE id = ?`).get(payload.id);
  await d.transaction(async () => {
    if (old?.expense_no) await clearPartsForRef(d, old.expense_no);
    await d.prepare(`DELETE FROM plant_expenses WHERE id = ?`).run(payload.id);
  });
  return { ok: true };
}

// src/main/services/budget.ts
var HEADS = [
  { head: "electricity", label: "Electricity", source: "expense" },
  { head: "maintenance", label: "Maintenance", source: "expense" },
  { head: "fixed", label: "Fixed Costs", source: "expense" },
  { head: "tipper_rent", label: "Tipper Rent", source: "expense" },
  { head: "equipment_rent", label: "Equipment Rent", source: "expense" },
  { head: "other", label: "Other", source: "expense" },
  { head: "diesel", label: "Diesel", source: "diesel" },
  { head: "payroll", label: "Payroll / Wages", source: "payroll" }
];
function money5(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round((v + Number.EPSILON) * 100) / 100 : 0;
}
async function getBudget(payload) {
  const d = getDb();
  const { plant_id, from, to } = payload;
  const empty = { plant_id, from, to, items: [], total_budget: 0, total_actual: 0 };
  if (!plant_id || !from || !to) return empty;
  const saved = await d.prepare(`SELECT head, amount FROM budgets WHERE plant_id = ? AND from_date = ? AND to_date = ?`).all(plant_id, from, to);
  const budgetByHead = new Map(saved.map((r) => [r.head, money5(r.amount)]));
  const expRows = await d.prepare(
    `SELECT category, COALESCE(SUM(amount),0) AS amt FROM plant_expenses
       WHERE plant_id = ? AND date >= ? AND date <= ? GROUP BY category`
  ).all(plant_id, from, to);
  const expByCat = new Map(expRows.map((r) => [r.category, money5(r.amt)]));
  const diesel = await d.prepare(
    `SELECT COALESCE(SUM(amount),0) AS amt FROM diesel_purchases
       WHERE plant_id = ? AND date >= ? AND date <= ?`
  ).get(plant_id, from, to);
  const payroll = await d.prepare(
    `SELECT COALESCE(SUM(amount),0) AS amt FROM wage_entries
       WHERE plant_id = ? AND date >= ? AND date <= ?`
  ).get(plant_id, from, to);
  const machine = await d.prepare(
    `SELECT COALESCE(SUM(pm.amount),0) AS amt FROM purchase_machines pm
       JOIN purchases pu ON pu.id = pm.purchase_id
       WHERE pu.plant_id = ? AND pu.date >= ? AND pu.date <= ?`
  ).get(plant_id, from, to);
  const saleMachine = await d.prepare(
    `SELECT COALESCE(SUM(dm.amount),0) AS amt FROM dispatch_machines dm
       JOIN dispatches di ON di.id = dm.dispatch_id
       WHERE di.plant_id = ? AND di.date >= ? AND di.date <= ?`
  ).get(plant_id, from, to);
  const items = HEADS.map((h) => {
    const budget = budgetByHead.get(h.head) ?? 0;
    let actual = h.source === "diesel" ? money5(diesel.amt) : h.source === "payroll" ? money5(payroll.amt) : expByCat.get(h.head) ?? 0;
    if (h.head === "equipment_rent") actual = money5(actual + money5(machine.amt) + money5(saleMachine.amt));
    return { head: h.head, label: h.label, budget, actual, variance: money5(budget - actual) };
  });
  return {
    plant_id,
    from,
    to,
    items,
    total_budget: money5(items.reduce((s, i) => s + i.budget, 0)),
    total_actual: money5(items.reduce((s, i) => s + i.actual, 0))
  };
}
async function saveBudget(payload) {
  const d = getDb();
  if (!payload.plant_id) return { ok: false, error: "Select a plant." };
  if (!payload.from || !payload.to) return { ok: false, error: "Select a date range." };
  const valid = new Set(HEADS.map((h) => h.head));
  await d.transaction(async () => {
    await d.prepare(`DELETE FROM budgets WHERE plant_id = ? AND from_date = ? AND to_date = ?`).run(payload.plant_id, payload.from, payload.to);
    const stmt = d.prepare(
      `INSERT INTO budgets (plant_id, head, from_date, to_date, amount) VALUES (?, ?, ?, ?, ?)`
    );
    for (const it of payload.items ?? []) {
      if (!valid.has(it.head)) continue;
      await stmt.run(payload.plant_id, it.head, payload.from, payload.to, money5(it.amount));
    }
  });
  return { ok: true };
}

// src/main/services/businesses.ts
async function listBusinesses() {
  return await getDb().prepare(`SELECT * FROM businesses ORDER BY name`).all();
}
async function createBusiness(p) {
  const d = getDb();
  if (!p.name?.trim()) throw new Error("Business name is required.");
  await ensureUniqueName("businesses", p.name, { label: "A business" });
  const info = await d.prepare(`INSERT INTO businesses (name, contact, remarks) VALUES (?, ?, ?)`).run(properCase(p.name), p.contact ?? "", p.remarks ?? "");
  return await d.prepare(`SELECT * FROM businesses WHERE id = ?`).get(info.lastInsertRowid);
}
async function updateBusiness(p) {
  const d = getDb();
  if (!p.name?.trim()) throw new Error("Business name is required.");
  await ensureUniqueName("businesses", p.name, { id: p.id, label: "A business" });
  await d.prepare(`UPDATE businesses SET name=?, contact=?, remarks=? WHERE id=?`).run(
    properCase(p.name),
    p.contact ?? "",
    p.remarks ?? "",
    p.id
  );
  return await d.prepare(`SELECT * FROM businesses WHERE id = ?`).get(p.id);
}
async function deleteBusiness(payload) {
  const d = getDb();
  await d.transaction(async () => {
    await d.prepare(`UPDATE assets SET business_id = NULL WHERE business_id = ?`).run(payload.id);
    await d.prepare(`DELETE FROM businesses WHERE id = ?`).run(payload.id);
  });
  return { ok: true };
}

// src/main/services/outsource.ts
async function listOutsource() {
  return await getDb().prepare(`SELECT * FROM outsource ORDER BY name`).all();
}
async function createOutsource(p) {
  const d = getDb();
  if (!p.name?.trim()) throw new Error("Name is required.");
  if (!p.head?.trim()) throw new Error("Head is required.");
  await ensureUniqueName("outsource", p.name, { scopeColumn: "head", scopeValue: p.head, label: "An outsource vendor with that head" });
  const info = await d.prepare(`INSERT INTO outsource (name, head, contact, remarks) VALUES (?, ?, ?, ?)`).run(properCase(p.name), properCase(p.head), p.contact ?? "", p.remarks ?? "");
  return await d.prepare(`SELECT * FROM outsource WHERE id = ?`).get(info.lastInsertRowid);
}
async function updateOutsource(p) {
  const d = getDb();
  if (!p.name?.trim()) throw new Error("Name is required.");
  if (!p.head?.trim()) throw new Error("Head is required.");
  await ensureUniqueName("outsource", p.name, { id: p.id, scopeColumn: "head", scopeValue: p.head, label: "An outsource vendor with that head" });
  await d.prepare(`UPDATE outsource SET name=?, head=?, contact=?, remarks=? WHERE id=?`).run(
    properCase(p.name),
    properCase(p.head),
    p.contact ?? "",
    p.remarks ?? "",
    p.id
  );
  return await d.prepare(`SELECT * FROM outsource WHERE id = ?`).get(p.id);
}
async function deleteOutsource(payload) {
  const d = getDb();
  const used = await d.prepare(`SELECT COUNT(*) AS c FROM plant_expenses WHERE outsource_id = ?`).get(payload.id);
  if (used.c > 0) {
    return { ok: false, error: "Cannot delete: expenses are attributed to this outsource vendor." };
  }
  await d.prepare(`DELETE FROM outsource WHERE id = ?`).run(payload.id);
  return { ok: true };
}

// src/main/services/system.ts
var DELETE_DELAY_MS = 3 * 24 * 60 * 60 * 1e3;
async function getSetting(key) {
  const row = await getDb().prepare("SELECT value FROM settings WHERE `key` = ?").get(key);
  return row?.value ?? null;
}
async function setSetting(key, value) {
  const sql = dbKind() === "mysql" ? "INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)" : "INSERT INTO settings (`key`, value) VALUES (?, ?) ON CONFLICT(`key`) DO UPDATE SET value = excluded.value";
  await getDb().prepare(sql).run(key, value);
}
async function delSetting(key) {
  await getDb().prepare("DELETE FROM settings WHERE `key` = ?").run(key);
}
var DATA_TABLES = [
  "spare_part_movements",
  "production_outputs",
  "purchase_transporters",
  "purchase_machines",
  "dispatch_transporters",
  "dispatch_machines",
  "rack_sale_transporters",
  "rack_sale_machines",
  "rack_loadings",
  "rack_unloadings",
  "rack_expenses",
  "rack_sales",
  "machine_logs",
  "asset_documents",
  "asset_plant_moves",
  "asset_plants",
  "customer_plants",
  "supplier_plants",
  "transporter_plants",
  "company_plants",
  "rack_vehicle_plants",
  "rack_jcb_plants",
  "customer_rates",
  "rate_chart",
  "transport_charges",
  "opening_balances",
  "budgets",
  "wage_entries",
  "diesel_issues",
  "diesel_purchases",
  "plant_expenses",
  "finished_goods_opening",
  "production_settings",
  "productions",
  "stock_movements",
  "dispatches",
  "purchases",
  "payments",
  "spare_parts",
  "racks",
  "rack_vehicles",
  "rack_jcbs",
  "assets",
  "employees",
  "stock_locations",
  "products",
  "expense_types",
  "businesses",
  "outsource",
  "companies",
  "customers",
  "suppliers",
  "transporters",
  "plants",
  "counters"
];
async function clearAllData() {
  const d = getDb();
  const sqlite = dbKind() === "sqlite";
  if (sqlite) await d.run("PRAGMA foreign_keys = OFF");
  try {
    await d.transaction(async () => {
      for (const t of DATA_TABLES) await d.prepare(`DELETE FROM ${t}`).run();
    });
  } finally {
    if (sqlite) await d.run("PRAGMA foreign_keys = ON");
  }
  if (sqlite) await d.run("VACUUM");
}
async function requestDataDeletion(payload) {
  const me = getCurrentUser();
  if (!me) return { ok: false, error: "Not signed in." };
  const row = await getDb().prepare("SELECT password_hash FROM users WHERE id = ?").get(me.id);
  if (!row || !verifyPassword(payload.password ?? "", row.password_hash)) {
    return { ok: false, error: "Password is incorrect." };
  }
  const scheduled = Date.now() + DELETE_DELAY_MS;
  await setSetting("delete_scheduled_at", String(scheduled));
  await setSetting("delete_requested_by", me.username);
  await setSetting("delete_requested_at", String(Date.now()));
  return { ok: true, scheduled_at: scheduled };
}
async function cancelDataDeletion() {
  await delSetting("delete_scheduled_at");
  await delSetting("delete_requested_by");
  await delSetting("delete_requested_at");
  return { ok: true };
}
async function deletionStatus() {
  const at = await getSetting("delete_scheduled_at");
  const reqAt = await getSetting("delete_requested_at");
  return {
    scheduled_at: at ? Number(at) : null,
    requested_by: await getSetting("delete_requested_by"),
    requested_at: reqAt ? Number(reqAt) : null
  };
}
async function maybeRunScheduledDeletion() {
  const at = await getSetting("delete_scheduled_at");
  if (at && Number(at) <= Date.now()) {
    await clearAllData();
    await cancelDataDeletion();
    return true;
  }
  return false;
}
async function getWorkdaySettings() {
  const v = await getSetting("weekly_offs");
  if (!v) return { weekly_offs: [0] };
  try {
    const arr = JSON.parse(v);
    return { weekly_offs: Array.isArray(arr) ? arr : [0] };
  } catch {
    return { weekly_offs: [0] };
  }
}
async function setWorkdaySettings(payload) {
  await setSetting("weekly_offs", JSON.stringify(payload.weekly_offs ?? []));
  return { ok: true };
}

// src/main/services/payroll.ts
function money6(n) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round((v + Number.EPSILON) * 100) / 100 : 0;
}
async function workingDaysIn(period) {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return 0;
  const offs = new Set((await getWorkdaySettings()).weekly_offs);
  const days = new Date(y, m, 0).getDate();
  let count = 0;
  for (let day = 1; day <= days; day++) {
    if (!offs.has(new Date(y, m - 1, day).getDay())) count++;
  }
  return count;
}
async function getWorkingDays(payload) {
  return { working_days: await workingDaysIn(payload.period) };
}
async function listEmployees(payload = {}) {
  const d = getDb();
  const clause = payload.plant_id ? `WHERE (e.plant_id IS NULL OR e.plant_id = @plant_id)` : "";
  return await d.prepare(
    `SELECT e.*, p.name AS plant_name
       FROM employees e LEFT JOIN plants p ON p.id = e.plant_id
       ${clause}
       ORDER BY e.name`
  ).all(payload);
}
async function createEmployee(p) {
  const d = getDb();
  if (!p.name?.trim()) throw new Error("Name is required.");
  await ensureUniqueName("employees", p.name, { label: "An employee" });
  const info = await d.prepare(
    `INSERT INTO employees (name, designation, wage_type, monthly_salary, daily_wage, ot_rate, plant_id, contact, status, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    properCase(p.name),
    properCase(p.designation),
    p.wage_type || "monthly",
    Number(p.monthly_salary) || 0,
    Number(p.daily_wage) || 0,
    Number(p.ot_rate) || 0,
    p.plant_id ?? null,
    p.contact ?? "",
    p.status || "active",
    p.remarks ?? ""
  );
  return await d.prepare(`SELECT * FROM employees WHERE id = ?`).get(info.lastInsertRowid);
}
async function updateEmployee(p) {
  const d = getDb();
  if (!p.name?.trim()) throw new Error("Name is required.");
  await ensureUniqueName("employees", p.name, { id: p.id, label: "An employee" });
  await d.prepare(
    `UPDATE employees SET name=?, designation=?, wage_type=?, monthly_salary=?, daily_wage=?, ot_rate=?,
       plant_id=?, contact=?, status=?, remarks=? WHERE id=?`
  ).run(
    properCase(p.name),
    properCase(p.designation),
    p.wage_type || "monthly",
    Number(p.monthly_salary) || 0,
    Number(p.daily_wage) || 0,
    Number(p.ot_rate) || 0,
    p.plant_id ?? null,
    p.contact ?? "",
    p.status || "active",
    p.remarks ?? "",
    p.id
  );
  return await d.prepare(`SELECT * FROM employees WHERE id = ?`).get(p.id);
}
async function deleteEmployee(payload) {
  const d = getDb();
  const used = await d.prepare(`SELECT COUNT(*) AS c FROM wage_entries WHERE employee_id = ?`).get(payload.id);
  if (used.c > 0) return { ok: false, error: "Cannot delete: this employee has wage records." };
  await d.prepare(`DELETE FROM employees WHERE id = ?`).run(payload.id);
  return { ok: true };
}
async function listWageEntries(filter = {}) {
  const d = getDb();
  const where = [];
  const params = {};
  if (filter.plant_id) {
    where.push("w.plant_id = @plant_id");
    params.plant_id = filter.plant_id;
  }
  if (filter.employee_id) {
    where.push("w.employee_id = @employee_id");
    params.employee_id = filter.employee_id;
  }
  if (filter.asset_id) {
    where.push("w.asset_id = @asset_id");
    params.asset_id = filter.asset_id;
  }
  if (filter.period) {
    where.push("w.period = @period");
    params.period = filter.period;
  }
  if (filter.payment_status) {
    where.push("w.payment_status = @payment_status");
    params.payment_status = filter.payment_status;
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return await d.prepare(
    `SELECT w.*, e.name AS employee_name, e.designation, a.name AS asset_name
       FROM wage_entries w
       JOIN employees e ON e.id = w.employee_id
       LEFT JOIN assets a ON a.id = w.asset_id
       ${clause}
       ORDER BY w.period DESC, e.name`
  ).all(params);
}
async function resolve2(p) {
  const d = getDb();
  const emp = await d.prepare(`SELECT * FROM employees WHERE id = ?`).get(p.employee_id);
  if (!emp) throw new Error("Employee not found.");
  if (!p.period) throw new Error("Pay period is required.");
  const workingDays = await workingDaysIn(p.period);
  const daysWorked = Number(p.days_worked) || 0;
  const earned = emp.wage_type === "monthly" ? workingDays > 0 ? money6(emp.monthly_salary / workingDays * Math.min(daysWorked, workingDays)) : 0 : money6(emp.daily_wage * daysWorked);
  const otHours = Number(p.ot_hours) || 0;
  const otRate = p.ot_rate == null || p.ot_rate === "" ? emp.ot_rate : Number(p.ot_rate);
  const otAmount = money6(otHours * otRate);
  const deduction = money6(Number(p.deduction) || 0);
  const gross = money6(earned + otAmount);
  const amount = money6(gross - deduction);
  if (!(amount > 0)) throw new Error("Net wage must be greater than 0.");
  return {
    employee_id: p.employee_id,
    plant_id: p.plant_id,
    asset_id: p.asset_id ?? null,
    period: p.period,
    wage_type: emp.wage_type,
    working_days: workingDays,
    days_worked: daysWorked,
    earned,
    ot_hours: otHours,
    ot_rate: otRate,
    ot_amount: otAmount,
    deduction,
    gross,
    amount,
    payment_status: derivePaymentStatus(amount, Number(p.paid_amount) || 0),
    paid_amount: money6(Number(p.paid_amount) || 0),
    date: p.date,
    remarks: p.remarks ?? ""
  };
}
async function createWageEntry(p) {
  const d = getDb();
  const fields = await resolve2(p);
  const no = await nextNumber("WGE", "wage_entry");
  const info = await d.prepare(
    `INSERT INTO wage_entries
        (entry_no, employee_id, plant_id, asset_id, period, wage_type, working_days, days_worked, earned,
         ot_hours, ot_rate, ot_amount, deduction, gross, amount, payment_status, paid_amount, date, remarks)
       VALUES (@entry_no,@employee_id,@plant_id,@asset_id,@period,@wage_type,@working_days,@days_worked,@earned,
         @ot_hours,@ot_rate,@ot_amount,@deduction,@gross,@amount,@payment_status,@paid_amount,@date,@remarks)`
  ).run({ entry_no: no, ...fields });
  return await d.prepare(`SELECT * FROM wage_entries WHERE id = ?`).get(info.lastInsertRowid);
}
async function updateWageEntry(p) {
  const d = getDb();
  if (!p.id) throw new Error("Missing wage entry id.");
  const fields = await resolve2(p);
  await d.prepare(
    `UPDATE wage_entries SET employee_id=@employee_id, plant_id=@plant_id, asset_id=@asset_id, period=@period, wage_type=@wage_type,
       working_days=@working_days, days_worked=@days_worked, earned=@earned, ot_hours=@ot_hours, ot_rate=@ot_rate,
       ot_amount=@ot_amount, deduction=@deduction, gross=@gross, amount=@amount,
       payment_status=@payment_status, paid_amount=@paid_amount, date=@date, remarks=@remarks WHERE id=@id`
  ).run({ id: p.id, ...fields });
  return await d.prepare(`SELECT * FROM wage_entries WHERE id = ?`).get(p.id);
}
async function deleteWageEntry(payload) {
  const d = getDb();
  await d.prepare(`DELETE FROM wage_entries WHERE id = ?`).run(payload.id);
  return { ok: true };
}

// src/main/services/audit.ts
var VERB_LABEL = {
  create: "Created",
  update: "Updated",
  delete: "Deleted",
  save: "Saved",
  set: "Updated",
  add: "Added",
  transfer: "Transferred",
  wipe: "Wiped",
  remove: "Removed"
};
var ENTITY_LABEL = {
  plants: "plant",
  locations: "stock location",
  suppliers: "supplier",
  customers: "customer",
  transporters: "transporter",
  companies: "company",
  businesses: "business",
  outsource: "outsource vendor",
  assets: "machine/vehicle",
  purchases: "purchase",
  productionSettings: "production setting",
  productions: "production",
  finished: "finished goods",
  dispatches: "direct sale",
  movements: "stock",
  racks: "rack",
  ledgers: "ledger",
  payments: "payment",
  plantExpenses: "plant expense",
  diesel: "diesel",
  employees: "employee",
  wages: "wage entry",
  system: "system",
  users: "user"
};
var SPECIFIC = {
  "auth.login": "Signed in",
  "auth.loginFailed": "Failed sign-in attempt",
  "auth.logout": "Signed out",
  "auth.changePassword": "Changed own password",
  "racks.addLoading": "Added rack loading",
  "racks.updateLoading": "Updated rack loading",
  "racks.deleteLoading": "Deleted rack loading",
  "racks.addUnloading": "Added rack unloading",
  "racks.updateUnloading": "Updated rack unloading",
  "racks.deleteUnloading": "Deleted rack unloading",
  "racks.addExpense": "Added rack expense",
  "racks.addSale": "Added rack sale",
  "racks.setStatus": "Changed rack status",
  "movements.transfer": "Transferred stock",
  "system.requestDelete": "Requested data deletion (3-day)",
  "system.cancelDelete": "Cancelled data deletion",
  "system.setWorkdays": "Updated working-days setting",
  "dispatches.setPayment": "Recorded sale payment",
  "dispatches.setDelivery": "Updated delivery status",
  "dispatches.setRate": "Set sale rate",
  "payments.add": "Recorded payment",
  "payments.delete": "Deleted payment",
  "finished.setOpening": "Set opening stock"
};
function actionLabel(method) {
  if (SPECIFIC[method]) return SPECIFIC[method];
  const [prefix, action = ""] = method.split(".");
  const entity = ENTITY_LABEL[prefix] ?? prefix;
  for (const [verb, label] of Object.entries(VERB_LABEL)) {
    if (action === verb || action.startsWith(verb)) return `${label} ${entity}`;
  }
  return method;
}
var DETAIL_KEYS = [
  "id",
  "name",
  "username",
  "code",
  "dispatch_no",
  "purchase_no",
  "rack_no",
  "issue_no",
  "no",
  "product_name",
  "party_name",
  "role",
  "amount",
  "paid_amount",
  "quantity",
  "litres",
  "status",
  "delivery_status",
  "date"
];
function detailFrom(payload) {
  if (payload == null) return "";
  if (typeof payload !== "object") return String(payload);
  const obj = payload;
  const parts = [];
  for (const k of DETAIL_KEYS) {
    const v = obj[k];
    if (v !== void 0 && v !== null && v !== "") parts.push(`${k}=${v}`);
  }
  return parts.slice(0, 6).join(", ");
}
async function logActivity(entry) {
  try {
    const me = entry.user ?? getCurrentUser();
    await getDb().prepare(
      `INSERT INTO activity_log (user_id, username, action, module, method, detail, ip)
         VALUES (?,?,?,?,?,?,?)`
    ).run(
      me?.id ?? null,
      me?.username ?? "",
      actionLabel(entry.method),
      moduleForMethod(entry.method) ?? "",
      entry.method,
      detailFrom(entry.payload),
      entry.ip ?? ""
    );
  } catch {
  }
}
async function listActivity(filter = {}) {
  const d = getDb();
  const where = [];
  const params = {};
  if (filter.user_id) {
    where.push("user_id = @user_id");
    params.user_id = filter.user_id;
  }
  if (filter.from) {
    where.push("date(ts) >= @from");
    params.from = filter.from;
  }
  if (filter.to) {
    where.push("date(ts) <= @to");
    params.to = filter.to;
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(Number(filter.limit) || 1e3, 1), 5e3);
  return await d.prepare(`SELECT * FROM activity_log ${clause} ORDER BY id DESC LIMIT ${limit}`).all(params);
}

// src/main/services/dashboard.ts
function num2(row) {
  return Math.round(((row?.q ?? 0) + Number.EPSILON) * 1e3) / 1e3;
}
function money7(row) {
  return Math.round(((row?.q ?? 0) + Number.EPSILON) * 100) / 100;
}
async function getDashboard(payload = {}) {
  const d = getDb();
  const pid = Number(payload.plant_id) || 0;
  const mAnd = pid ? ` AND m.plant_id = ${pid}` : "";
  const plAnd = pid ? ` AND plant_id = ${pid}` : "";
  const plWhere = pid ? ` WHERE plant_id = ${pid}` : "";
  const rawTotal = num2(
    await d.prepare(`SELECT COALESCE(SUM(change_qty),0) AS q FROM stock_movements m WHERE material_type='raw'${mAnd}`).get()
  );
  const rawByPlant = await d.prepare(
    `SELECT m.plant_id, p.name AS plant_name, ROUND(COALESCE(SUM(m.change_qty),0),3) AS qty
       FROM stock_movements m JOIN plants p ON p.id = m.plant_id
       WHERE m.material_type='raw'${mAnd} GROUP BY m.plant_id, p.name ORDER BY p.name`
  ).all();
  const rawByLocation = await d.prepare(
    `SELECT l.id, l.name, p.name AS plant_name, ROUND(COALESCE(SUM(m.change_qty),0),3) AS qty
       FROM stock_locations l
       JOIN plants p ON p.id = l.plant_id
       LEFT JOIN stock_movements m ON m.stock_location_id = l.id AND m.material_type='raw'
       ${pid ? `WHERE l.plant_id = ${pid}` : ""}
       GROUP BY l.id, l.name, p.name ORDER BY p.name, l.name`
  ).all();
  const finishedTotal = num2(
    await d.prepare(`SELECT COALESCE(SUM(change_qty),0) AS q FROM stock_movements m WHERE material_type='finished'${mAnd}`).get()
  );
  const finishedByPlant = await d.prepare(
    `SELECT m.plant_id, p.name AS plant_name, ROUND(COALESCE(SUM(m.change_qty),0),3) AS qty
       FROM stock_movements m JOIN plants p ON p.id = m.plant_id
       WHERE m.material_type='finished'${mAnd} GROUP BY m.plant_id, p.name ORDER BY p.name`
  ).all();
  const finishedByProduct = await d.prepare(
    `SELECT m.product_name, ROUND(COALESCE(SUM(m.change_qty),0),3) AS qty
       FROM stock_movements m
       WHERE m.material_type='finished'${mAnd} GROUP BY m.product_name HAVING qty > 0 ORDER BY m.product_name`
  ).all();
  const totalPurchased = num2(
    await d.prepare(`SELECT COALESCE(SUM(qty_cm),0) AS q FROM purchases WHERE COALESCE(material_type,'raw')='raw'${plAnd}`).get()
  );
  const totalConsumed = num2(
    await d.prepare(`SELECT COALESCE(SUM(raw_qty),0) AS q FROM productions${plWhere}`).get()
  );
  const totalProduced = num2(
    await d.prepare(`SELECT COALESCE(SUM(change_qty),0) AS q FROM stock_movements m WHERE type='production_output'${mAnd}`).get()
  );
  const totalDispatched = num2(
    await d.prepare(`SELECT COALESCE(SUM(qty_cm),0) AS q FROM dispatches WHERE to_plant_id IS NULL${plAnd}`).get()
  );
  const pendingDeliveries = (await d.prepare(`SELECT COUNT(*) AS q FROM dispatches WHERE delivery_status='pending' AND to_plant_id IS NULL${plAnd}`).get()).q;
  const deliveredNoRate = (await d.prepare(`SELECT COUNT(*) AS q FROM dispatches WHERE delivery_status='delivered' AND rate IS NULL AND to_plant_id IS NULL${plAnd}`).get()).q;
  const rackStockCm = num2(
    await d.prepare(
      `SELECT
          (SELECT COALESCE(SUM(total_cm),0) FROM rack_loadings WHERE rack_id IN (SELECT id FROM racks WHERE status<>'closed')) -
          (SELECT COALESCE(SUM(qty_cm),0) FROM rack_sales WHERE rack_id IN (SELECT id FROM racks WHERE status<>'closed')) AS q`
    ).get()
  );
  const rackShortageCm = num2(
    await d.prepare(
      `SELECT
          (SELECT COALESCE(SUM(total_cm),0) FROM rack_loadings WHERE rack_id IN (SELECT id FROM racks WHERE status='closed')) -
          (SELECT COALESCE(SUM(qty_cm),0) FROM rack_sales WHERE rack_id IN (SELECT id FROM racks WHERE status='closed')) AS q`
    ).get()
  );
  const openRacks = (await d.prepare(`SELECT COUNT(*) AS q FROM racks WHERE status <> 'closed'`).get()).q;
  const rackSalesAmount = money7(
    await d.prepare(`SELECT COALESCE(SUM(amount),0) AS q FROM rack_sales`).get()
  );
  const rackTransportCost = money7(
    await d.prepare(
      `SELECT (SELECT COALESCE(SUM(amount),0) FROM rack_loadings)
            + (SELECT COALESCE(SUM(amount),0) FROM rack_unloadings) AS q`
    ).get()
  );
  const totalRackExpenses = money7(
    await d.prepare(`SELECT COALESCE(SUM(amount),0) AS q FROM rack_expenses`).get()
  );
  const rackProfit = money7({ q: rackSalesAmount - rackTransportCost - totalRackExpenses });
  const custSalesExpr = pid ? `COALESCE((SELECT SUM(amount) FROM dispatches WHERE customer_id=c.id AND plant_id=${pid} AND to_plant_id IS NULL AND amount IS NOT NULL),0)` : `COALESCE((SELECT SUM(amount) FROM rack_sales WHERE customer_id=c.id AND amount IS NOT NULL),0) +
       COALESCE((SELECT SUM(amount) FROM dispatches WHERE customer_id=c.id AND to_plant_id IS NULL AND amount IS NOT NULL),0)`;
  const topCustomers = (await d.prepare(
    `SELECT c.name AS name, ${custSalesExpr} AS amount
         FROM customers c ORDER BY amount DESC LIMIT 5`
  ).all()).filter((r) => r.amount > 0).map((r) => ({ name: r.name, amount: money7({ q: r.amount }) }));
  const monthlySrc = pid ? `SELECT substr(date,1,7) AS month, COALESCE(amount,0) AS amount FROM dispatches WHERE amount IS NOT NULL AND to_plant_id IS NULL AND plant_id=${pid}` : `SELECT substr(date,1,7) AS month, COALESCE(amount,0) AS amount FROM rack_sales WHERE amount IS NOT NULL
       UNION ALL
       SELECT substr(date,1,7) AS month, COALESCE(amount,0) AS amount FROM dispatches WHERE amount IS NOT NULL AND to_plant_id IS NULL`;
  const monthlySales = (await d.prepare(
    `SELECT month, SUM(amount) AS amount FROM (${monthlySrc}) AS t GROUP BY month ORDER BY month DESC LIMIT 6`
  ).all()).map((r) => ({ month: r.month, amount: money7({ q: r.amount }) })).reverse();
  const scope = pid ? { plant_id: pid } : {};
  const [custBal, supBal, transBal, outBal, vehBal, jcbBal] = await Promise.all([
    getPartyBalances({ party_type: "customer", ...scope }),
    getPartyBalances({ party_type: "supplier", ...scope }),
    getPartyBalances({ party_type: "transporter", ...scope }),
    getPartyBalances({ party_type: "outsource", ...scope }),
    getPartyBalances({ party_type: "rack_vehicle", ...scope }),
    getPartyBalances({ party_type: "rack_jcb", ...scope })
  ]);
  const sumBal = (arr) => arr.reduce((s, b) => s + b.balance, 0);
  const billReceivable = money7({ q: sumBal(custBal) });
  const billsPayable = money7({ q: sumBal(supBal) + sumBal(transBal) + sumBal(outBal) + sumBal(vehBal) + sumBal(jcbBal) });
  const obAnd = pid ? ` AND ob.plant_id = ${pid}` : "";
  const openingBalance = money7(
    await d.prepare(
      `SELECT
          (SELECT COALESCE(SUM(CASE WHEN ob.direction='debit' THEN ob.amount ELSE -ob.amount END),0)
             FROM opening_balances ob WHERE ob.party_type='customer'${obAnd})
          - (SELECT COALESCE(SUM(CASE WHEN ob.direction='credit' THEN ob.amount ELSE -ob.amount END),0)
             FROM opening_balances ob WHERE ob.party_type='supplier'${obAnd})
          - (SELECT COALESCE(SUM(CASE WHEN ob.direction='credit' THEN ob.amount ELSE -ob.amount END),0)
             FROM opening_balances ob WHERE ob.party_type='outsource'${obAnd}) AS q`
    ).get()
  );
  const scopeWhere = (table, type) => pid ? ` WHERE ${plantScopeSql(table, type, String(pid))}` : "";
  const counts = {
    plants: (await d.prepare(`SELECT COUNT(*) AS q FROM plants`).get()).q,
    suppliers: (await d.prepare(`SELECT COUNT(*) AS q FROM suppliers${scopeWhere("suppliers", "supplier")}`).get()).q,
    customers: (await d.prepare(`SELECT COUNT(*) AS q FROM customers${scopeWhere("customers", "customer")}`).get()).q,
    transporters: (await d.prepare(`SELECT COUNT(*) AS q FROM transporters${scopeWhere("transporters", "transporter")}`).get()).q,
    companies: (await d.prepare(`SELECT COUNT(*) AS q FROM companies`).get()).q,
    racks: pid ? (await d.prepare(`SELECT COUNT(*) AS q FROM racks WHERE id IN (SELECT DISTINCT rack_id FROM rack_loadings WHERE plant_id = ${pid})`).get()).q : (await d.prepare(`SELECT COUNT(*) AS q FROM racks`).get()).q
  };
  return {
    rawTotal,
    rawByPlant,
    rawByLocation,
    finishedTotal,
    finishedByPlant,
    finishedByProduct,
    totalPurchased,
    totalConsumed,
    totalProduced,
    totalDispatched,
    pendingDeliveries,
    deliveredNoRate,
    rackStockCm,
    openRacks,
    rackShortageCm,
    rackSalesAmount,
    totalRackExpenses,
    rackTransportCost,
    rackProfit,
    openingBalance,
    billReceivable,
    billsPayable,
    topCustomers,
    monthlySales,
    counts
  };
}

// src/main/handlers.ts
var handlers = {
  "auth.login": login,
  "auth.changePassword": changePassword,
  // In the desktop build there is no session, so "me" always reports logged-out
  // and the login screen is shown on launch. The web server overrides this to
  // report the real session state (see server/index.ts).
  "auth.me": () => ({ ok: false }),
  "auth.logout": () => ({ ok: true }),
  "plants.list": listPlants,
  "plants.create": createPlant,
  "plants.update": updatePlant,
  "plants.delete": deletePlant,
  "locations.list": listStockLocations,
  "locations.create": createStockLocation,
  "locations.update": updateStockLocation,
  "locations.delete": deleteStockLocation,
  "suppliers.list": listSuppliers,
  "suppliers.create": createSupplier,
  "suppliers.update": updateSupplier,
  "suppliers.delete": deleteSupplier,
  "customers.list": listCustomers,
  "customers.create": createCustomer,
  "customers.update": updateCustomer,
  "customers.delete": deleteCustomer,
  "products.list": listProducts,
  "products.create": createProduct,
  "products.update": updateProduct,
  "products.delete": deleteProduct,
  "rates.list": listCustomerRates,
  "rates.save": saveCustomerRates,
  "rates.createShareLink": customerShareLink,
  "rates.removeShareLink": revokeShareLink,
  "rates.getBusinessName": getBusinessName,
  "rates.setBusinessName": setBusinessName,
  "rates.getBranding": getBranding,
  "rates.setLogo": setLogo,
  "rateChart.list": listRateChart,
  "rateChart.create": createRateChart,
  "rateChart.update": updateRateChart,
  "rateChart.delete": deleteRateChart,
  "transportCharges.list": listTransportCharges,
  "transportCharges.create": createTransportCharge,
  "transportCharges.update": updateTransportCharge,
  "transportCharges.delete": deleteTransportCharge,
  "purchases.list": listPurchases,
  "purchases.detail": getPurchaseDetail,
  "purchases.create": createPurchase,
  "purchases.update": updatePurchase,
  "purchases.delete": deletePurchase,
  "purchases.setPayment": setPurchasePayment,
  "productionSettings.list": listProductionSettings,
  "productionSettings.save": saveProductionSettings,
  "productions.list": listProductions,
  "productions.preview": previewProduction,
  "productions.create": createProduction,
  "productions.delete": deleteProduction,
  "finished.list": listFinishedGoods,
  "finished.available": availableProducts,
  "finished.setOpening": setOpening,
  "dispatches.list": listDispatches,
  "dispatches.detail": getDispatchDetail,
  "dispatches.create": createDispatch,
  "dispatches.update": updateDispatch,
  "dispatches.setRate": setRate,
  "dispatches.setDelivery": setDelivery,
  "dispatches.setDispatch": setDispatch,
  "dispatches.setPayment": setPayment,
  "dispatches.delete": deleteDispatch,
  "movements.list": listMovements,
  "movements.transfer": transferStock,
  "movements.deleteTransfer": deleteTransfer,
  "transporters.list": listTransporters,
  "transporters.create": createTransporter,
  "transporters.update": updateTransporter,
  "transporters.delete": deleteTransporter,
  "transporterFleet.list": listTransporterFleet,
  "transporterFleet.create": createTransporterFleet,
  "transporterFleet.update": updateTransporterFleet,
  "transporterFleet.delete": deleteTransporterFleet,
  "companies.list": listCompanies,
  "companies.create": createCompany,
  "companies.update": updateCompany,
  "companies.delete": deleteCompany,
  "racks.list": listRacks,
  "racks.create": createRack,
  "racks.update": updateRack,
  "racks.setStatus": setRackStatus,
  "racks.delete": deleteRack,
  "racks.detail": getRackDetail,
  "racks.addLoading": addLoading,
  "racks.updateLoading": updateLoading,
  "racks.deleteLoading": deleteLoading,
  "racks.addUnloading": addUnloading,
  "racks.updateUnloading": updateUnloading,
  "racks.deleteUnloading": deleteUnloading,
  "racks.expenseTypes": listExpenseTypes,
  "racks.createExpenseType": createExpenseType,
  "racks.deleteExpenseType": deleteExpenseType,
  "racks.addExpense": addExpense,
  "racks.updateExpense": updateExpense,
  "racks.deleteExpense": deleteExpense,
  "racks.listExpenses": listExpenses,
  "racks.addSale": addSale,
  "racks.saleDetail": getSaleDetail,
  "racks.updateSale": updateSale,
  "racks.deleteSale": deleteSale,
  "racks.listSales": listSales,
  "rackVehicles.list": listRackVehicles,
  "rackVehicles.create": createRackVehicle,
  "rackVehicles.update": updateRackVehicle,
  "rackVehicles.bulkCreate": bulkCreateRackVehicles,
  "rackVehicles.delete": deleteRackVehicle,
  "rackJcbs.list": listRackJcbs,
  "rackJcbs.create": createRackJcb,
  "rackJcbs.update": updateRackJcb,
  "rackJcbs.bulkCreate": bulkCreateRackJcbs,
  "rackJcbs.delete": deleteRackJcb,
  "ledgers.get": getLedger,
  "ledgers.balances": getPartyBalances,
  "ledgers.allDues": getAllDues,
  "ledgers.getOpening": getOpeningBalance,
  "ledgers.openings": listOpeningBalances,
  "ledgers.setOpening": setOpeningBalance,
  "ledgers.setOpenings": setOpeningBalances,
  "ledgers.deleteOpening": deleteOpeningBalance,
  "assets.list": listAssets,
  "assets.create": createAsset,
  "assets.update": updateAsset,
  "assets.delete": deleteAsset,
  "assets.report": assetReport,
  "assets.move": moveAsset,
  "assets.moves": assetMoves,
  "machinery.logs": listMachineLogs,
  "machinery.allLogs": listAllLogs,
  "machinery.mileage": mileageReport,
  "machinery.overview": machineryOverview,
  "machinery.addLog": addMachineLog,
  "machinery.updateLog": updateMachineLog,
  "machinery.deleteLog": deleteMachineLog,
  "machinery.lastMeter": lastMachineMeter,
  "machinery.balanceSheet": machineBalanceSheet,
  "machinery.documents": listAssetDocuments,
  "machinery.addDocument": addAssetDocument,
  "machinery.updateDocument": updateAssetDocument,
  "machinery.deleteDocument": deleteAssetDocument,
  "machinery.reminders": getDocumentReminders,
  "machinery.reminderSettings": getReminderSettings,
  "machinery.setReminderDays": setReminderDays,
  "parts.list": listParts,
  "parts.create": createPart,
  "parts.update": updatePart,
  "parts.stockIn": stockIn,
  "parts.stockOut": stockOut,
  "parts.fifoQuote": partFifoQuote,
  "parts.fifoQuoteMany": partFifoQuoteMany,
  "parts.movements": listPartMovements,
  "parts.delete": deletePart,
  "businesses.list": listBusinesses,
  "businesses.create": createBusiness,
  "businesses.update": updateBusiness,
  "businesses.delete": deleteBusiness,
  "outsource.list": listOutsource,
  "outsource.create": createOutsource,
  "outsource.update": updateOutsource,
  "outsource.delete": deleteOutsource,
  "plantExpenses.list": listPlantExpenses,
  "plantExpenses.book": expenseBook,
  "plantExpenses.totals": expenseTotals,
  "plantExpenses.create": createPlantExpense,
  "plantExpenses.update": updatePlantExpense,
  "plantExpenses.delete": deletePlantExpense,
  "budget.get": getBudget,
  "budget.save": saveBudget,
  "diesel.stock": dieselStock,
  "diesel.purchases": listDieselPurchases,
  "diesel.createPurchase": createDieselPurchase,
  "diesel.updatePurchase": updateDieselPurchase,
  "diesel.deletePurchase": deleteDieselPurchase,
  "diesel.issues": listDieselIssues,
  "diesel.createIssue": createDieselIssue,
  "diesel.updateIssue": updateDieselIssue,
  "diesel.deleteIssue": deleteDieselIssue,
  "diesel.byAsset": issuesByAsset,
  "diesel.issuesAll": listDieselIssuesAll,
  "diesel.fifoQuote": dieselFifoQuote,
  "payments.add": addPayment,
  "payments.list": listPayments,
  "payments.delete": deletePayment,
  "employees.list": listEmployees,
  "employees.create": createEmployee,
  "employees.update": updateEmployee,
  "employees.delete": deleteEmployee,
  "wages.list": listWageEntries,
  "wages.workingDays": getWorkingDays,
  "wages.create": createWageEntry,
  "wages.update": updateWageEntry,
  "wages.delete": deleteWageEntry,
  "system.requestDelete": requestDataDeletion,
  "system.cancelDelete": cancelDataDeletion,
  "system.deleteStatus": deletionStatus,
  "system.getWorkdays": getWorkdaySettings,
  "system.setWorkdays": setWorkdaySettings,
  "users.list": listUsers,
  "users.create": createUser,
  "users.update": updateUser,
  "users.delete": deleteUser,
  "activity.list": listActivity,
  "dashboard.get": getDashboard
};

// src/main/services/sessions.ts
var import_node_crypto3 = require("node:crypto");
var SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1e3;
async function createSession(userId) {
  const d = getDb();
  const token = (0, import_node_crypto3.randomBytes)(32).toString("hex");
  const now = Date.now();
  await d.prepare(
    `INSERT INTO sessions (token, created_at, expires_at, user_id) VALUES (?, ?, ?, ?)`
  ).run(token, now, now + SESSION_TTL_MS, userId);
  return token;
}
async function sessionUserId(token) {
  if (!token) return null;
  const d = getDb();
  const row = await d.prepare(`SELECT expires_at, user_id FROM sessions WHERE token = ?`).get(token);
  const now = Date.now();
  if (!row || row.expires_at < now || row.user_id == null) return null;
  await d.prepare(`UPDATE sessions SET expires_at = ? WHERE token = ?`).run(now + SESSION_TTL_MS, token);
  return row.user_id;
}
async function destroySession(token) {
  if (!token) return;
  await getDb().prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}
async function cleanupSessions() {
  await getDb().prepare(`DELETE FROM sessions WHERE expires_at < ?`).run(Date.now());
}

// server/index.ts
var lastDeletionCheck = 0;
function failed(result) {
  return !!result && typeof result === "object" && "ok" in result && result.ok === false;
}
var PORT = process.env.PORT || 3e3;
var HOST = process.env.HOST;
var COOKIE = "bl_session";
var SECURE = process.env.SECURE_COOKIE === "1" || process.env.SECURE_COOKIE === "true";
if (!process.env.BL_DB_DIR) process.env.BL_DB_DIR = import_node_path2.default.resolve(process.cwd(), "data");
var STATIC_DIR = process.env.BL_STATIC_DIR || import_node_path2.default.resolve(process.cwd(), "out/renderer");
function setSessionCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    (0, import_cookie.serialize)(COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: SECURE,
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS / 1e3)
    })
  );
}
function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    (0, import_cookie.serialize)(COOKIE, "", { httpOnly: true, sameSite: "lax", secure: SECURE, path: "/", maxAge: 0 })
  );
}
function tokenFrom(req) {
  return (0, import_cookie.parse)(req.headers.cookie || "")[COOKIE];
}
var app2 = (0, import_express.default)();
app2.set("trust proxy", 1);
app2.use(import_express.default.json({ limit: "5mb" }));
app2.get("/healthz", (_req, res) => {
  res.type("text").send("ok");
});
app2.post("/api/call", async (req, res) => {
  const { method, payload } = req.body ?? {};
  if (!method) return res.status(400).json({ error: "Missing method." });
  const token = tokenFrom(req);
  const ip = req.ip || "";
  if (Date.now() - lastDeletionCheck > 6e5) {
    lastDeletionCheck = Date.now();
    void maybeRunScheduledDeletion().catch(() => {
    });
  }
  try {
    if (method === "auth.login") {
      const creds = payload ?? {};
      const user2 = await authenticate(creds.username || "", creds.password || "");
      if (!user2) {
        await logActivity({ method: "auth.loginFailed", payload: { username: creds.username || "" }, ip });
        return res.json({ result: { ok: false } });
      }
      setSessionCookie(res, await createSession(user2.id));
      await logActivity({ method: "auth.login", user: user2, ip });
      return res.json({ result: { ok: true, user: user2 } });
    }
    if (method === "auth.me") {
      const uid2 = await sessionUserId(token);
      const user2 = uid2 ? await getUserById(uid2) : null;
      return res.json({ result: { ok: !!user2, user: user2 } });
    }
    if (method === "auth.logout") {
      const uid2 = await sessionUserId(token);
      const user2 = uid2 ? await getUserById(uid2) : null;
      if (user2) await logActivity({ method: "auth.logout", user: user2, ip });
      await destroySession(token);
      clearSessionCookie(res);
      return res.json({ result: { ok: true } });
    }
    const uid = await sessionUserId(token);
    const user = uid ? await getUserById(uid) : null;
    if (!user) return res.status(401).json({ error: "Not authenticated." });
    if (!can(user, method)) {
      return res.status(403).json({ error: "You do not have permission to do that." });
    }
    const fn = handlers[method];
    if (!fn) return res.status(400).json({ error: `Unknown API method: ${method}` });
    const result = await runWithUser(user, async () => {
      const r = await fn(payload);
      if ((isWriteMethod(method) || SELF_METHODS.has(method)) && !failed(r)) {
        await logActivity({ method, payload, user, ip });
      }
      return r;
    });
    return res.json({ result });
  } catch (err) {
    return res.status(400).json({ error: err.message || "Operation failed" });
  }
});
function esc(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}
function fmtRate(n) {
  return Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
function initials(name) {
  return (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}
function renderRatePage(data) {
  const updated = data.updated_at ? new Date(data.updated_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
  const rows = data.rates.length ? data.rates.map(
    (r) => `
            <tr>
              <td class="prod">${esc(r.product_name)}</td>
              <td><span class="unit">${esc(r.uom)}</span></td>
              <td class="r">\u20B9${fmtRate(r.rate)}</td>
            </tr>`
  ).join("") : "";
  const body = data.rates.length ? `<div class="card">
         <table>
           <thead><tr><th>Product</th><th>Unit</th><th class="r">Rate</th></tr></thead>
           <tbody>${rows}</tbody>
         </table>
       </div>` : `<div class="card empty">No rates have been published yet. Please contact us for a quote.</div>`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<meta name="robots" content="noindex,nofollow"/>
<meta name="theme-color" content="#0b1220"/>
<title>${esc(data.business_name)} \u2014 Rate List</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
<style>
  :root { color-scheme: light; --bg:#eef1f6; --ink:#0f1729; --muted:#64748b; --line:#eceef2; --brand:#1f6feb; --brand2:#0b3aa3; }
  * { box-sizing: border-box; }
  html,body { margin:0; }
  body { font-family:'Inter',system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg);
         color:var(--ink); -webkit-font-smoothing:antialiased; line-height:1.5; }
  .wrap { max-width: 600px; margin:0 auto; padding: 0 16px 56px; }
  .hero { margin: 18px 0 0; border-radius: 22px; padding: 30px 24px 26px; color:#fff; text-align:center;
          background: radial-gradient(120% 120% at 50% -10%, #2b7bff 0%, var(--brand) 45%, var(--brand2) 100%);
          box-shadow: 0 18px 40px -18px rgba(31,111,235,.6); }
  .avatar { width:56px; height:56px; border-radius:16px; margin:0 auto 12px; display:flex; align-items:center;
            justify-content:center; font-weight:800; font-size:20px; letter-spacing:.02em;
            background:rgba(255,255,255,.18); backdrop-filter:blur(4px); border:1px solid rgba(255,255,255,.25); }
  .hero .biz { font-size: 23px; font-weight: 800; letter-spacing:-.02em; }
  .hero .sub { opacity:.92; font-size: 13.5px; margin-top:4px; font-weight:500; }
  .badge { display:inline-block; margin-top:14px; background:rgba(255,255,255,.16); border:1px solid rgba(255,255,255,.28);
           color:#fff; font-weight:600; font-size:12px; padding:6px 14px; border-radius:999px; letter-spacing:.02em; }
  .card { background:#fff; border:1px solid #e8ebf1; border-radius:18px; margin-top:18px; overflow:hidden;
          box-shadow: 0 6px 24px -16px rgba(15,23,41,.25); }
  .card.empty { padding:28px 20px; text-align:center; color:var(--muted); font-size:14px; }
  table { width:100%; border-collapse: collapse; font-size:15px; }
  thead th { background:#f8fafc; text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.06em;
             color:var(--muted); font-weight:700; padding:12px 18px; border-bottom:1px solid var(--line); }
  thead th.r, td.r { text-align:right; }
  tbody td { padding:14px 18px; border-bottom:1px solid var(--line); }
  tbody tr:last-child td { border-bottom:none; }
  tbody tr:nth-child(even) { background:#fcfdfe; }
  .prod { font-weight:600; }
  .unit { display:inline-block; background:#eef4ff; color:#2563cc; font-weight:600; font-size:12px;
          padding:3px 9px; border-radius:7px; }
  td.r { font-weight:700; font-variant-numeric: tabular-nums; white-space:nowrap; }
  footer { text-align:center; color:#94a0b3; font-size:12px; margin-top:22px; line-height:1.7; }
  footer b { color:#64748b; font-weight:600; }
</style>
</head><body>
  <div class="wrap">
    <div class="hero">
      <div class="avatar">${esc(initials(data.business_name))}</div>
      <div class="biz">${esc(data.business_name)}</div>
      <div class="sub">Rate list prepared for ${esc(data.customer_name)}</div>
      <div class="badge">CURRENT PRICES</div>
    </div>
    ${body}
    <footer>
      ${updated ? `<b>Updated ${esc(updated)}</b><br/>` : ""}
      Prices are indicative and subject to change. Please confirm before placing an order.
    </footer>
  </div>
</body></html>`;
}
app2.get("/rates/:token", async (req, res) => {
  try {
    const data = await publicRateList({ token: req.params.token });
    if (!data) {
      res.status(404).type("html").send(
        '<!doctype html><meta charset="utf-8"/><body style="font-family:system-ui;text-align:center;padding:48px;color:#374151"><h2>Rate list not found</h2><p>This link is invalid or has been revoked.</p></body>'
      );
      return;
    }
    res.set("Cache-Control", "no-store");
    res.type("html").send(renderRatePage(data));
  } catch {
    res.status(500).type("text").send("Unable to load rate list.");
  }
});
app2.use(import_express.default.static(STATIC_DIR));
app2.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api")) return next();
  res.sendFile(import_node_path2.default.join(STATIC_DIR, "index.html"));
});
function onListening() {
  console.log(`BL Crusher Manager web server listening (port ${PORT}${HOST ? `, host ${HOST}` : ""})`);
  console.log(`  static : ${STATIC_DIR}`);
}
initDb().then(async () => {
  await cleanupSessions();
  await maybeRunScheduledDeletion().catch(() => false);
  setInterval(() => void maybeRunScheduledDeletion().catch(() => false), 60 * 60 * 1e3);
  if (HOST) app2.listen(PORT, HOST, onListening);
  else app2.listen(PORT, onListening);
}).catch((err) => {
  console.error("Database initialisation failed:", err);
  process.exit(1);
});
//# sourceMappingURL=index.cjs.map
