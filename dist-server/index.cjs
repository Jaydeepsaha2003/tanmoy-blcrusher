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
  product_name      TEXT NOT NULL DEFAULT '',
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
  return s.trim().replace(/\s+/g, " ").toLowerCase().replace(/(^|[\s\-/().&])([a-z])/g, (_m, sep, ch) => sep + ch.toUpperCase());
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
  transporters: "masters",
  companies: "masters",
  businesses: "masters",
  outsource: "masters",
  assets: "masters",
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
  "wipe",
  "remove",
  "request",
  "cancel"
];
function isWriteMethod(method) {
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
  await d.prepare(`DELETE FROM stock_movements WHERE ref_no = ? AND type = 'transfer'`).run(payload.ref_no);
  return { ok: true };
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
  await d.prepare(`DELETE FROM production_settings WHERE plant_id = ?`).run(payload.id);
  await d.prepare(`DELETE FROM stock_locations WHERE plant_id = ?`).run(payload.id);
  await d.prepare(`DELETE FROM plants WHERE id = ?`).run(payload.id);
  return { ok: true };
}

// src/main/services/suppliers.ts
async function listSuppliers(payload = {}) {
  const d = getDb();
  const clause = payload.plant_id ? `WHERE (s.plant_id IS NULL OR s.plant_id = @plant_id)` : "";
  const rows = await d.prepare(
    `SELECT s.*, co.name AS company_name, pl.name AS plant_name
       FROM suppliers s
       LEFT JOIN companies co ON co.id = s.company_id
       LEFT JOIN plants pl ON pl.id = s.plant_id
       ${clause}
       ORDER BY s.name`
  ).all(payload);
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
  const info = await d.prepare(
    `INSERT INTO suppliers (name, contact, address, remarks, company_id, plant_id) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    properCase(p.name),
    p.contact ?? "",
    p.address ?? "",
    p.remarks ?? "",
    p.company_id ?? null,
    p.plant_id ?? null
  );
  return await d.prepare(`SELECT * FROM suppliers WHERE id = ?`).get(info.lastInsertRowid);
}
async function updateSupplier(p) {
  const d = getDb();
  await d.prepare(
    `UPDATE suppliers SET name=?, contact=?, address=?, remarks=?, company_id=?, plant_id=? WHERE id=?`
  ).run(
    properCase(p.name),
    p.contact ?? "",
    p.address ?? "",
    p.remarks ?? "",
    p.company_id ?? null,
    p.plant_id ?? null,
    p.id
  );
  return await d.prepare(`SELECT * FROM suppliers WHERE id = ?`).get(p.id);
}
async function deleteSupplier(payload) {
  const d = getDb();
  const used = await d.prepare(`SELECT COUNT(*) AS c FROM purchases WHERE supplier_id = ?`).get(payload.id);
  if (used.c > 0) {
    return { ok: false, error: "Cannot delete: this supplier has purchase records." };
  }
  await d.prepare(`DELETE FROM suppliers WHERE id = ?`).run(payload.id);
  return { ok: true };
}
function round3(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// src/main/services/customers.ts
async function listCustomers(payload = {}) {
  const d = getDb();
  const clause = payload.plant_id ? `WHERE (c.plant_id IS NULL OR c.plant_id = @plant_id)` : "";
  const rows = await d.prepare(
    `SELECT c.*, co.name AS company_name, pl.name AS plant_name
       FROM customers c
       LEFT JOIN companies co ON co.id = c.company_id
       LEFT JOIN plants pl ON pl.id = c.plant_id
       ${clause}
       ORDER BY c.name`
  ).all(payload);
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
  const info = await d.prepare(
    `INSERT INTO customers (name, contact, address, remarks, company_id, plant_id) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    properCase(p.name),
    p.contact ?? "",
    p.address ?? "",
    p.remarks ?? "",
    p.company_id ?? null,
    p.plant_id ?? null
  );
  return await d.prepare(`SELECT * FROM customers WHERE id = ?`).get(info.lastInsertRowid);
}
async function updateCustomer(p) {
  const d = getDb();
  await d.prepare(
    `UPDATE customers SET name=?, contact=?, address=?, remarks=?, company_id=?, plant_id=? WHERE id=?`
  ).run(
    properCase(p.name),
    p.contact ?? "",
    p.address ?? "",
    p.remarks ?? "",
    p.company_id ?? null,
    p.plant_id ?? null,
    p.id
  );
  return await d.prepare(`SELECT * FROM customers WHERE id = ?`).get(p.id);
}
async function deleteCustomer(payload) {
  const d = getDb();
  const used = await d.prepare(`SELECT COUNT(*) AS c FROM dispatches WHERE customer_id = ?`).get(payload.id);
  const rackUsed = await d.prepare(`SELECT COUNT(*) AS c FROM rack_sales WHERE customer_id = ?`).get(payload.id);
  if (used.c > 0 || rackUsed.c > 0) {
    return { ok: false, error: "Cannot delete: this customer has sales/dispatch records." };
  }
  await d.prepare(`DELETE FROM customers WHERE id = ?`).run(payload.id);
  return { ok: true };
}

// src/main/services/products.ts
async function listProducts(_payload = {}) {
  return await getDb().prepare(`SELECT id, name, description, status, created_at FROM products ORDER BY name`).all();
}
async function createProduct(p) {
  const d = getDb();
  const name = properCase(p.name);
  if (!name) throw new Error("Product name is required.");
  const dup = await d.prepare(`SELECT id FROM products WHERE LOWER(name) = LOWER(?)`).get(name);
  if (dup) throw new Error("A product with this name already exists.");
  const info = await d.prepare(`INSERT INTO products (plant_id, name, description, status) VALUES (0, ?, ?, ?)`).run(name, p.description ?? "", p.status ?? "active");
  return await d.prepare(`SELECT * FROM products WHERE id = ?`).get(info.lastInsertRowid);
}
async function updateProduct(p) {
  const d = getDb();
  const name = properCase(p.name);
  if (!name) throw new Error("Product name is required.");
  const dup = await d.prepare(`SELECT id FROM products WHERE LOWER(name) = LOWER(?) AND id <> ?`).get(name, p.id);
  if (dup) throw new Error("A product with this name already exists.");
  await d.prepare(`UPDATE products SET name=?, description=?, status=? WHERE id=?`).run(name, p.description ?? "", p.status ?? "active", p.id);
  return await d.prepare(`SELECT * FROM products WHERE id = ?`).get(p.id);
}
async function deleteProduct(payload) {
  const d = getDb();
  const prod = await d.prepare(`SELECT * FROM products WHERE id = ?`).get(payload.id);
  if (!prod) return { ok: false, error: "Product not found." };
  const used = await d.prepare(`SELECT COUNT(*) AS c FROM production_settings WHERE LOWER(product_name) = LOWER(?)`).get(prod.name);
  if (used.c > 0) {
    return { ok: false, error: "Cannot delete: this product is used in Production Settings." };
  }
  await d.prepare(`DELETE FROM products WHERE id = ?`).run(payload.id);
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
  const value = (payload.business_name ?? "").trim();
  const sql = dbKind() === "mysql" ? "INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)" : "INSERT INTO settings (`key`, value) VALUES (?, ?) ON CONFLICT(`key`) DO UPDATE SET value = excluded.value";
  await getDb().prepare(sql).run("business_name", value);
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

// src/main/services/purchases.ts
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
    `SELECT pu.*, s.name AS supplier_name, p.name AS plant_name, l.name AS stock_location_name
       FROM purchases pu
       JOIN suppliers s ON s.id = pu.supplier_id
       JOIN plants p ON p.id = pu.plant_id
       JOIN stock_locations l ON l.id = pu.stock_location_id
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
  const kind = p.material_type === "finished" ? "finished" : "raw";
  const product = kind === "finished" ? properCase(p.product_name || "") : "";
  if (kind === "finished" && !product) throw new Error("Select a product to purchase.");
  const locId = p.stock_location_id || await ensureDefaultLocation(p.plant_id);
  const uom = ["CM", "TON", "CFT"].includes(p.uom) ? p.uom : "CM";
  const qtyCm = roundQty(toCm(p.quantity, uom, await plantUomFactors(p.plant_id)));
  const amount = computeAmount(p.rate, p.quantity);
  const id = await d.transaction(async () => {
    const no = await nextNumber("PUR", "purchase");
    const info = await d.prepare(
      `INSERT INTO purchases
          (purchase_no, supplier_id, plant_id, stock_location_id, material_type, product_name, uom, quantity, qty_cm, rate, amount, paid_amount, payment_status, date, remarks)
         VALUES (@purchase_no,@supplier_id,@plant_id,@stock_location_id,@material_type,@product_name,@uom,@quantity,@qty_cm,@rate,@amount,@paid_amount,@payment_status,@date,@remarks)`
    ).run({
      purchase_no: no,
      supplier_id: p.supplier_id,
      plant_id: p.plant_id,
      stock_location_id: locId,
      material_type: kind,
      product_name: product,
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
  const kind = p.material_type === "finished" ? "finished" : "raw";
  const product = kind === "finished" ? properCase(p.product_name || "") : "";
  if (kind === "finished" && !product) throw new Error("Select a product to purchase.");
  const locId = p.stock_location_id || old.stock_location_id || await ensureDefaultLocation(p.plant_id);
  const uom = ["CM", "TON", "CFT"].includes(p.uom) ? p.uom : "CM";
  const qtyCm = roundQty(toCm(p.quantity, uom, await plantUomFactors(p.plant_id)));
  const amount = computeAmount(p.rate, p.quantity);
  await d.transaction(async () => {
    await d.prepare(
      `UPDATE purchases SET supplier_id=@supplier_id, plant_id=@plant_id, stock_location_id=@stock_location_id,
         material_type=@material_type, product_name=@product_name,
         uom=@uom, quantity=@quantity, qty_cm=@qty_cm, rate=@rate, amount=@amount, paid_amount=@paid_amount,
         payment_status=@payment_status, date=@date, remarks=@remarks WHERE id=@id`
    ).run({
      id: p.id,
      supplier_id: p.supplier_id,
      plant_id: p.plant_id,
      stock_location_id: locId,
      material_type: kind,
      product_name: product,
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
      await d.prepare(`DELETE FROM purchases WHERE id = ?`).run(payload.id);
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
async function setPurchasePayment(payload) {
  const d = getDb();
  await d.prepare(`UPDATE purchases SET paid_amount=?, payment_status=? WHERE id=?`).run(
    payload.paid_amount || 0,
    payload.payment_status,
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
  if (!(p.raw_qty > 0)) throw new Error("Raw material quantity must be greater than 0.");
  const locId = p.stock_location_id || await ensureDefaultLocation(p.plant_id);
  const settings = await d.prepare(`SELECT * FROM production_settings WHERE plant_id = ? ORDER BY id`).all(p.plant_id);
  if (settings.length === 0)
    throw new Error("No production settings defined for this plant. Set them up first.");
  const available = await rawLocationBalance(d, locId);
  if (p.raw_qty > available)
    throw new Error(
      `Not enough raw material. Available: ${available} m\xB3, requested: ${p.raw_qty} m\xB3.`
    );
  const id = await d.transaction(async () => {
    const no = await nextNumber("PROD", "production");
    const info = await d.prepare(
      `INSERT INTO productions (production_no, plant_id, stock_location_id, raw_qty, date, remarks)
         VALUES (?, ?, ?, ?, ?, ?)`
    ).run(no, p.plant_id, locId, p.raw_qty, p.date, p.remarks ?? "");
    const productionId = Number(info.lastInsertRowid);
    await addMovement(d, {
      type: "production_consume",
      material_type: "raw",
      ref_no: no,
      plant_id: p.plant_id,
      stock_location_id: locId,
      change_qty: -p.raw_qty,
      date: p.date,
      note: "Raw material consumed in production"
    });
    const outStmt = d.prepare(
      `INSERT INTO production_outputs (production_id, product_name, percentage, quantity)
       VALUES (?, ?, ?, ?)`
    );
    for (const s of settings) {
      const qty = round5(p.raw_qty * s.output_percentage / 100);
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
        COALESCE(SUM(m.change_qty),0) AS balance_qty
       FROM stock_movements m
       JOIN plants p ON p.id = m.plant_id
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
    balance_qty: round6(r.balance_qty)
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
  await d.transaction(async () => {
    await d.prepare(
      dbKind() === "mysql" ? `INSERT INTO finished_goods_opening (plant_id, product_name, opening_qty)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE opening_qty = VALUES(opening_qty)` : `INSERT INTO finished_goods_opening (plant_id, product_name, opening_qty)
           VALUES (?, ?, ?)
           ON CONFLICT(plant_id, product_name) DO UPDATE SET opening_qty = excluded.opening_qty`
    ).run(payload.plant_id, product, payload.opening_qty || 0);
    await setFinishedOpening(d, payload.plant_id, product, payload.opening_qty || 0, date);
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
        ${BILLED_TOTAL_SQL} AS billed_total
       FROM dispatches di
       JOIN customers c ON c.id = di.customer_id
       JOIN plants p ON p.id = di.plant_id
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
  if (!(Number(p.quantity) > 0)) throw new Error("Quantity must be greater than 0.");
  if (!["CM", "TON", "CFT"].includes(p.uom)) throw new Error("Invalid unit of measure.");
  const product = properCase(p.product_name);
  const qtyCm = roundQty2(toCm(Number(p.quantity), p.uom, factors));
  const amount = computeAmount2(p.rate, Number(p.quantity));
  const transport = Number(p.transport_charge) || 0;
  const other = Number(p.other_charge) || 0;
  const billed = (amount ?? 0) + (p.transport_billed ? transport : 0) + (p.other_billed ? other : 0);
  const paid = Number(p.paid_amount) || 0;
  const outsourced = !!p.outsourced;
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
      quantity: Number(p.quantity),
      qty_cm: qtyCm,
      rate: p.rate,
      amount,
      transport_charge: transport,
      transport_billed: p.transport_billed ? 1 : 0,
      other_charge: other,
      other_billed: p.other_billed ? 1 : 0,
      vehicle_no: p.vehicle_no ?? "",
      vehicle_type: p.vehicle_type || "own",
      driver: properCase(p.driver),
      challan_no: (p.challan_no ?? "").trim(),
      outsourced: outsourced ? 1 : 0,
      delivery_status: p.delivery_status,
      payment_status: derivePaymentStatus(billed, paid),
      paid_amount: paid,
      date: p.date,
      remarks: p.remarks ?? ""
    }
  };
}
async function createDispatch(p) {
  const d = getDb();
  const { product, qtyCm, outsourced, fields } = normalize(p, await plantUomFactors(p.plant_id));
  if (!outsourced) {
    const available = await finishedBalance(d, p.plant_id, product);
    if (qtyCm > available)
      throw new Error(
        `Not enough finished goods. Available ${product}: ${available} m\xB3, requested: ${qtyCm} m\xB3.`
      );
  }
  const id = await d.transaction(async () => {
    const no = await nextNumber("SALE", "dispatch");
    const info = await d.prepare(
      `INSERT INTO dispatches
          (dispatch_no, customer_id, plant_id, product_name, uom, quantity, qty_cm, rate, amount,
           transport_charge, transport_billed, other_charge, other_billed,
           vehicle_no, vehicle_type, driver, challan_no, outsourced, delivery_status, payment_status, paid_amount, date, remarks)
         VALUES (@dispatch_no,@customer_id,@plant_id,@product_name,@uom,@quantity,@qty_cm,@rate,@amount,
           @transport_charge,@transport_billed,@other_charge,@other_billed,
           @vehicle_no,@vehicle_type,@driver,@challan_no,@outsourced,@delivery_status,@payment_status,@paid_amount,@date,@remarks)`
    ).run({ dispatch_no: no, ...fields });
    if (!outsourced) {
      await addMovement(d, {
        type: "dispatch",
        material_type: "finished",
        ref_no: no,
        plant_id: p.plant_id,
        product_name: product,
        change_qty: -qtyCm,
        date: p.date,
        note: "Direct sale to customer"
      });
      if (await finishedBalance(d, p.plant_id, product) < 0) throw new Error("Stock cannot go negative.");
    }
    return Number(info.lastInsertRowid);
  });
  return await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(id);
}
async function updateDispatch(p) {
  const d = getDb();
  if (!p.id) throw new Error("Missing dispatch id.");
  const old = await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(p.id);
  if (!old) throw new Error("Dispatch not found.");
  const { product, qtyCm, outsourced, fields } = normalize(p, await plantUomFactors(p.plant_id));
  await d.transaction(async () => {
    await d.prepare(
      `UPDATE dispatches SET customer_id=@customer_id, plant_id=@plant_id, product_name=@product_name,
        uom=@uom, quantity=@quantity, qty_cm=@qty_cm, rate=@rate, amount=@amount,
        transport_charge=@transport_charge, transport_billed=@transport_billed,
        other_charge=@other_charge, other_billed=@other_billed,
        vehicle_no=@vehicle_no, vehicle_type=@vehicle_type, driver=@driver, challan_no=@challan_no,
        outsourced=@outsourced, delivery_status=@delivery_status, payment_status=@payment_status, paid_amount=@paid_amount,
        date=@date, remarks=@remarks WHERE id=@id`
    ).run({ id: p.id, ...fields });
    await d.prepare(`DELETE FROM stock_movements WHERE ref_no=? AND type='dispatch'`).run(old.dispatch_no);
    if (!outsourced) {
      await addMovement(d, {
        type: "dispatch",
        material_type: "finished",
        ref_no: old.dispatch_no,
        plant_id: p.plant_id,
        product_name: product,
        change_qty: -qtyCm,
        date: p.date,
        note: "Direct sale to customer"
      });
      if (await finishedBalance(d, old.plant_id, old.product_name) < 0)
        throw new Error("Edit would make finished goods stock negative.");
      if (await finishedBalance(d, p.plant_id, product) < 0)
        throw new Error("Edit would make finished goods stock negative.");
    }
  });
  return await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(p.id);
}
async function setRate(payload) {
  const d = getDb();
  const row = await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(payload.id);
  const amount = computeAmount2(payload.rate, row.quantity);
  await d.prepare(`UPDATE dispatches SET rate=?, amount=? WHERE id=?`).run(payload.rate, amount, payload.id);
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
async function setPayment(payload) {
  const d = getDb();
  await d.prepare(`UPDATE dispatches SET paid_amount=?, payment_status=? WHERE id=?`).run(
    Number(payload.paid_amount) || 0,
    payload.payment_status,
    payload.id
  );
  return await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(payload.id);
}
async function deleteDispatch(payload) {
  const d = getDb();
  const old = await d.prepare(`SELECT * FROM dispatches WHERE id = ?`).get(payload.id);
  if (!old) return { ok: false, error: "Sale not found." };
  await d.transaction(async () => {
    await d.prepare(`DELETE FROM stock_movements WHERE ref_no=? AND type='dispatch'`).run(old.dispatch_no);
    await d.prepare(`DELETE FROM dispatches WHERE id = ?`).run(payload.id);
  });
  return { ok: true };
}

// src/main/services/transporters.ts
async function listTransporters(payload = {}) {
  const d = getDb();
  const clause = payload.plant_id ? `WHERE (t.plant_id IS NULL OR t.plant_id = @plant_id)` : "";
  const rows = await d.prepare(
    `SELECT t.*, co.name AS company_name, pl.name AS plant_name
       FROM transporters t
       LEFT JOIN companies co ON co.id = t.company_id
       LEFT JOIN plants pl ON pl.id = t.plant_id
       ${clause}
       ORDER BY t.name`
  ).all(payload);
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
         )`
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
  const info = await d.prepare(
    `INSERT INTO transporters (name, contact, address, remarks, company_id, plant_id) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    properCase(p.name),
    p.contact ?? "",
    p.address ?? "",
    p.remarks ?? "",
    p.company_id ?? null,
    p.plant_id ?? null
  );
  return await d.prepare(`SELECT * FROM transporters WHERE id = ?`).get(info.lastInsertRowid);
}
async function updateTransporter(p) {
  const d = getDb();
  await d.prepare(
    `UPDATE transporters SET name=?, contact=?, address=?, remarks=?, company_id=?, plant_id=? WHERE id=?`
  ).run(
    properCase(p.name),
    p.contact ?? "",
    p.address ?? "",
    p.remarks ?? "",
    p.company_id ?? null,
    p.plant_id ?? null,
    p.id
  );
  return await d.prepare(`SELECT * FROM transporters WHERE id = ?`).get(p.id);
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
  await d.prepare(`DELETE FROM transporters WHERE id = ?`).run(payload.id);
  return { ok: true };
}
function round7(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// src/main/services/companies.ts
async function listCompanies() {
  const d = getDb();
  const rows = await d.prepare(`SELECT * FROM companies ORDER BY name`).all();
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
  const info = await d.prepare(`INSERT INTO companies (name, contact, address, remarks) VALUES (?, ?, ?, ?)`).run(properCase(p.name), p.contact ?? "", p.address ?? "", p.remarks ?? "");
  return await d.prepare(`SELECT * FROM companies WHERE id = ?`).get(info.lastInsertRowid);
}
async function updateCompany(p) {
  const d = getDb();
  if (!p.name?.trim()) throw new Error("Company name is required.");
  await d.prepare(`UPDATE companies SET name=?, contact=?, address=?, remarks=? WHERE id=?`).run(
    properCase(p.name),
    p.contact ?? "",
    p.address ?? "",
    p.remarks ?? "",
    p.id
  );
  return await d.prepare(`SELECT * FROM companies WHERE id = ?`).get(p.id);
}
async function deleteCompany(payload) {
  const d = getDb();
  await d.transaction(async () => {
    await d.prepare(`UPDATE customers SET company_id = NULL WHERE company_id = ?`).run(payload.id);
    await d.prepare(`UPDATE suppliers SET company_id = NULL WHERE company_id = ?`).run(payload.id);
    await d.prepare(`UPDATE transporters SET company_id = NULL WHERE company_id = ?`).run(payload.id);
    await d.prepare(`DELETE FROM companies WHERE id = ?`).run(payload.id);
  });
  return { ok: true };
}

// src/main/services/racks.ts
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
    + COALESCE((SELECT SUM(amount) FROM rack_unloadings WHERE rack_id = r.id),0) AS transport_cost,
  COALESCE((SELECT SUM(amount) FROM rack_expenses WHERE rack_id = r.id),0) AS expense_total,
  COALESCE((SELECT SUM(qty_cm) FROM rack_sales WHERE rack_id = r.id),0) AS sold_cm,
  COALESCE((SELECT SUM(amount) FROM rack_sales WHERE rack_id = r.id),0) AS sales_amount`;
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
  const info = await d.prepare(`INSERT INTO racks (rack_no, destination, date, remarks) VALUES (?, ?, ?, ?)`).run(no, properCase(p.destination), p.date, p.remarks ?? "");
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
    await d.prepare(`UPDATE racks SET rack_no=?, destination=?, date=?, remarks=? WHERE id=?`).run(
      no,
      properCase(p.destination),
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
    `SELECT ru.*, r.rack_no, t.name AS transporter_name
       FROM rack_unloadings ru
       JOIN racks r ON r.id = ru.rack_id
       LEFT JOIN transporters t ON t.id = ru.transporter_id
       WHERE ru.rack_id = ?
       ORDER BY ru.date DESC, ru.id DESC`
  ).all(payload.id);
  const expenses = await d.prepare(`SELECT * FROM rack_expenses WHERE rack_id = ? ORDER BY date DESC, id DESC`).all(payload.id);
  const sales = await d.prepare(
    `SELECT rs.*, c.name AS customer_name, r.rack_no
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
       )
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
  const id = await d.transaction(async () => {
    const no = await nextNumber("RKL", "rack_loading");
    const info = await d.prepare(
      `INSERT INTO rack_loadings
          (loading_no, rack_id, plant_id, product_name, transporter_id, vehicle_no, trips, per_trip_cm,
           total_cm, rate, amount, diesel_litres, diesel_amount, outsourced, date, remarks)
         VALUES (@loading_no,@rack_id,@plant_id,@product_name,@transporter_id,@vehicle_no,@trips,@per_trip_cm,
           @total_cm,@rate,@amount,@diesel_litres,@diesel_amount,@outsourced,@date,@remarks)`
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
      diesel_litres: p.diesel_litres,
      diesel_amount: p.diesel_amount,
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
  await d.transaction(async () => {
    await d.prepare(
      `UPDATE rack_loadings SET plant_id=@plant_id, product_name=@product_name, transporter_id=@transporter_id,
         vehicle_no=@vehicle_no, trips=@trips, per_trip_cm=@per_trip_cm, total_cm=@total_cm,
         rate=@rate, amount=@amount, diesel_litres=@diesel_litres, diesel_amount=@diesel_amount,
         outsourced=@outsourced, date=@date, remarks=@remarks WHERE id=@id`
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
      diesel_litres: p.diesel_litres,
      diesel_amount: p.diesel_amount,
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
  if (!(total > 0)) throw new Error("Unloaded quantity must be greater than 0 (trips \xD7 per-trip m\xB3).");
  return { total: roundQty3(total), amount: computeAmount3(p.rate, total) };
}
function unloadingFields(p, total, amount) {
  return {
    rack_id: p.rack_id,
    product_name: p.product_name.trim(),
    transporter_id: p.transporter_id ?? null,
    vehicle_no: p.vehicle_no ?? "",
    trips: Number(p.trips) || 0,
    per_trip_cm: Number(p.per_trip_cm) || 0,
    total_cm: total,
    uom: "CM",
    quantity: total,
    qty_cm: total,
    rate: p.rate,
    amount,
    diesel_litres: p.diesel_litres,
    diesel_amount: p.diesel_amount,
    date: p.date,
    remarks: p.remarks ?? ""
  };
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
  const no = await nextNumber("RKU", "rack_unloading");
  const info = await d.prepare(
    `INSERT INTO rack_unloadings
        (unloading_no, rack_id, product_name, transporter_id, vehicle_no, trips, per_trip_cm, total_cm,
         uom, quantity, qty_cm, rate, amount, diesel_litres, diesel_amount, date, remarks)
       VALUES (@unloading_no,@rack_id,@product_name,@transporter_id,@vehicle_no,@trips,@per_trip_cm,@total_cm,
         @uom,@quantity,@qty_cm,@rate,@amount,@diesel_litres,@diesel_amount,@date,@remarks)`
  ).run({ unloading_no: no, ...unloadingFields(p, total, amount) });
  return await d.prepare(`SELECT * FROM rack_unloadings WHERE id = ?`).get(info.lastInsertRowid);
}
async function updateUnloading(p) {
  const d = getDb();
  if (!p.id) throw new Error("Missing unloading id.");
  const old = await d.prepare(`SELECT * FROM rack_unloadings WHERE id = ?`).get(p.id);
  if (!old) throw new Error("Unloading not found.");
  if (!p.product_name?.trim()) throw new Error("Product is required.");
  const { total, amount } = resolveUnloading(p);
  await d.transaction(async () => {
    await d.prepare(
      `UPDATE rack_unloadings SET product_name=@product_name, transporter_id=@transporter_id,
         vehicle_no=@vehicle_no, trips=@trips, per_trip_cm=@per_trip_cm, total_cm=@total_cm,
         uom=@uom, quantity=@quantity, qty_cm=@qty_cm, rate=@rate, amount=@amount,
         diesel_litres=@diesel_litres, diesel_amount=@diesel_amount, date=@date, remarks=@remarks WHERE id=@id`
    ).run({ id: p.id, ...unloadingFields(p, total, amount) });
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
    const info = await d.prepare(
      `INSERT INTO rack_sales
          (sale_no, rack_id, customer_id, product_name, uom, quantity, qty_cm, rate, amount, truck_no, date, remarks)
         VALUES (@sale_no,@rack_id,@customer_id,@product_name,@uom,@quantity,@qty_cm,@rate,@amount,@truck_no,@date,@remarks)`
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
      date: p.date,
      remarks: p.remarks ?? ""
    });
    return Number(info.lastInsertRowid);
  });
  return await d.prepare(`SELECT * FROM rack_sales WHERE id = ?`).get(id);
}
async function updateSale(p) {
  const d = getDb();
  if (!p.id) throw new Error("Missing sale id.");
  const old = await d.prepare(`SELECT * FROM rack_sales WHERE id = ?`).get(p.id);
  if (!old) throw new Error("Sale not found.");
  const { qtyCm, amount } = resolveSale(p, await rackPlantFactors(d, old.rack_id));
  const available = await rackSellable(d, old.rack_id, p.product_name, p.id);
  if (qtyCm > available)
    throw new Error(
      `Not enough unloaded material at destination. Available ${p.product_name}: ${available} m\xB3, requested: ${qtyCm} m\xB3.`
    );
  await d.prepare(
    `UPDATE rack_sales SET customer_id=@customer_id, product_name=@product_name, uom=@uom,
       quantity=@quantity, qty_cm=@qty_cm, rate=@rate, amount=@amount, truck_no=@truck_no, date=@date, remarks=@remarks
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
    date: p.date,
    remarks: p.remarks ?? ""
  });
  return await d.prepare(`SELECT * FROM rack_sales WHERE id = ?`).get(p.id);
}
async function deleteSale(payload) {
  const d = getDb();
  await d.prepare(`DELETE FROM rack_sales WHERE id = ?`).run(payload.id);
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

// src/main/services/ledgers.ts
var PARTY_TABLE = {
  customer: "customers",
  supplier: "suppliers",
  transporter: "transporters",
  outsource: "outsource"
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
  if (!PARTY_TABLE[p.party_type]) throw new Error("Invalid party type.");
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
    `SELECT pay.*, COALESCE(c.name, s.name, t.name) AS party_name
       FROM payments pay
       LEFT JOIN customers c ON pay.party_type='customer' AND c.id = pay.party_id
       LEFT JOIN suppliers s ON pay.party_type='supplier' AND s.id = pay.party_id
       LEFT JOIN transporters t ON pay.party_type='transporter' AND t.id = pay.party_id
       ${clause}
       ORDER BY pay.date DESC, pay.id DESC`
  ).all(params);
}
async function deletePayment(payload) {
  const d = getDb();
  await d.prepare(`DELETE FROM payments WHERE id = ?`).run(payload.id);
  return { ok: true };
}
async function buildEntries(partyType, partyId) {
  const d = getDb();
  const entries = [];
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
      for (const e of await buildEntries(link.type, link.id))
        entries.push({ ...e, particulars: `[${roleLabel[link.type]}] ${e.particulars}` });
    }
    entries.sort(
      (a, b) => a.date === b.date ? a.created_at.localeCompare(b.created_at) : a.date.localeCompare(b.date)
    );
    return entries;
  }
  if (partyType === "plant") {
    const sales = await d.prepare(
      `SELECT dispatch_no, date, created_at, product_name, quantity, uom,
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
            - (SELECT COALESCE(SUM(amount),0) FROM rack_expenses WHERE rack_id=r.id) AS profit,
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
      `SELECT di.issue_no, di.date, di.created_at, di.litres, a.name AS asset
         FROM diesel_issues di JOIN assets a ON a.id = di.asset_id WHERE di.asset_id IN (${inC})`
    ).all(...assetIds);
    for (const x of diesel)
      if (x.litres > 0 && avg > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Diesel ${x.litres} L \u2014 ${x.asset}`,
          ref: x.issue_no,
          debit: roundMoney2(x.litres * avg),
          credit: 0
        });
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
  }
  if (partyType === "customer") {
    const dispatches = await d.prepare(
      `SELECT dispatch_no, date, created_at, product_name, quantity, uom,
          (COALESCE(amount,0)
            + CASE WHEN transport_billed=1 THEN transport_charge ELSE 0 END
            + CASE WHEN other_billed=1 THEN other_charge ELSE 0 END) AS billed,
          paid_amount
         FROM dispatches WHERE customer_id = ?`
    ).all(partyId);
    for (const x of dispatches) {
      if (x.billed > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Direct sale \u2014 ${x.product_name} (${x.quantity} ${x.uom})`,
          ref: x.dispatch_no,
          debit: x.billed,
          credit: 0
        });
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
        particulars: `Rack sale \u2014 ${x.product_name} (${x.quantity} ${x.uom}) \xB7 Rack ${x.rack_no}`,
        ref: x.sale_no,
        debit: x.amount,
        credit: 0
      });
  }
  if (partyType === "supplier") {
    const purchases = await d.prepare(
      `SELECT purchase_no, date, created_at, COALESCE(amount,0) AS amount, paid_amount, quantity
         FROM purchases WHERE supplier_id = ?`
    ).all(partyId);
    for (const x of purchases) {
      if (x.amount > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Purchase \u2014 raw material (${x.quantity} m\xB3)`,
          ref: x.purchase_no,
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
          particulars: `Diesel purchase (${x.litres} L)`,
          ref: x.purchase_no,
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
                COALESCE(rl.diesel_amount,0) AS diesel, rl.total_cm, rl.trips, r.rack_no
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
      if (x.diesel > 0)
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
                COALESCE(ru.diesel_amount,0) AS diesel, ru.total_cm, ru.trips, r.rack_no
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
      if (x.diesel > 0)
        entries.push({
          date: x.date,
          created_at: x.created_at,
          particulars: `Diesel issued (deduction)`,
          ref: x.unloading_no,
          debit: x.diesel,
          credit: 0
        });
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
  const all = await buildEntries(payload.party_type, payload.party_id);
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
      particulars: "Opening balance",
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
      debit: roundMoney2(e.debit),
      credit: roundMoney2(e.credit),
      balance: roundMoney2(bal),
      payment_id: e.payment_id
    });
  }
  return {
    party_type: payload.party_type,
    party_id: payload.party_id,
    party_name: name,
    entries,
    total_debit: roundMoney2(totalDebit),
    total_credit: roundMoney2(totalCredit),
    closing: roundMoney2(bal)
  };
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
  } else {
    const table = PARTY_TABLE[payload.party_type];
    if (!table) throw new Error("Invalid party type.");
    const clause = payload.plant_id ? `WHERE (plant_id IS NULL OR plant_id = @plant_id)` : "";
    parties = await d.prepare(`SELECT id, name FROM ${table} ${clause} ORDER BY name`).all(payload.plant_id ? { plant_id: payload.plant_id } : {});
  }
  const sign = runningSign(payload.party_type);
  const result = [];
  for (const p of parties) {
    const entries = await buildEntries(payload.party_type, p.id);
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
async function getAllDues(payload = {}) {
  const types = ["customer", "supplier", "transporter", "outsource"];
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

// src/main/services/diesel.ts
function money(n) {
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
async function stockOf(d, plantId) {
  const pAnd = plantId ? " WHERE plant_id = @pid" : "";
  const p = (await d.prepare(`SELECT COALESCE(SUM(litres),0) AS q FROM diesel_purchases${pAnd}`).get({ pid: plantId })).q;
  const i = (await d.prepare(`SELECT COALESCE(SUM(litres),0) AS q FROM diesel_issues${pAnd}`).get({ pid: plantId })).q;
  return { purchased: litres(p), issued: litres(i), balance: litres(p - i) };
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
  const amount = rate == null ? null : money(Number(p.litres) * rate);
  const paid = money(Number(p.paid_amount) || 0);
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
    `SELECT di.*, p.name AS plant_name, a.name AS asset_name
       FROM diesel_issues di
       JOIN plants p ON p.id = di.plant_id
       LEFT JOIN assets a ON a.id = di.asset_id
       ${clause}
       ORDER BY di.date DESC, di.id DESC`
  ).all(params);
}
async function createDieselIssue(p) {
  const d = getDb();
  if (!(Number(p.litres) > 0)) throw new Error("Litres must be greater than 0.");
  const available = (await stockOf(d, p.plant_id)).balance;
  if (Number(p.litres) > available)
    throw new Error(`Not enough diesel in stock. Available: ${available} L, requested: ${p.litres} L.`);
  const no = await nextNumber("DIS", "diesel_issue");
  const info = await d.prepare(
    `INSERT INTO diesel_issues (issue_no, plant_id, asset_id, litres, date, remarks)
       VALUES (?, ?, ?, ?, ?, ?)`
  ).run(no, p.plant_id, p.asset_id ?? null, litres(Number(p.litres)), p.date, p.remarks ?? "");
  return await d.prepare(`SELECT * FROM diesel_issues WHERE id = ?`).get(info.lastInsertRowid);
}
async function updateDieselIssue(p) {
  const d = getDb();
  if (!p.id) throw new Error("Missing issue id.");
  if (!(Number(p.litres) > 0)) throw new Error("Litres must be greater than 0.");
  await d.transaction(async () => {
    await d.prepare(
      `UPDATE diesel_issues SET plant_id=?, asset_id=?, litres=?, date=?, remarks=? WHERE id=?`
    ).run(p.plant_id, p.asset_id ?? null, litres(Number(p.litres)), p.date, p.remarks ?? "", p.id);
    if ((await stockOf(d, p.plant_id)).balance < 0)
      throw new Error("Edit would issue more diesel than is in stock.");
  });
  return await d.prepare(`SELECT * FROM diesel_issues WHERE id = ?`).get(p.id);
}
async function deleteDieselIssue(payload) {
  const d = getDb();
  await d.prepare(`DELETE FROM diesel_issues WHERE id = ?`).run(payload.id);
  return { ok: true };
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

// src/main/services/assets.ts
async function listAssets(payload = {}) {
  const d = getDb();
  const clause = payload.plant_id ? `WHERE (a.plant_id IS NULL OR a.plant_id = @plant_id)` : "";
  return await d.prepare(
    `SELECT a.*, p.name AS plant_name, b.name AS business_name
       FROM assets a
       LEFT JOIN plants p ON p.id = a.plant_id
       LEFT JOIN businesses b ON b.id = a.business_id
       ${clause}
       ORDER BY a.asset_type, a.name`
  ).all(payload);
}
async function createAsset(p) {
  const d = getDb();
  if (!p.name?.trim()) throw new Error("Name is required.");
  const info = await d.prepare(
    `INSERT INTO assets (name, asset_type, category, identifier, plant_id, business_id, status, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    properCase(p.name),
    p.asset_type || "machine",
    properCase(p.category),
    (p.identifier ?? "").trim().toUpperCase(),
    p.plant_id ?? null,
    p.business_id ?? null,
    p.status || "active",
    p.remarks ?? ""
  );
  return await d.prepare(`SELECT * FROM assets WHERE id = ?`).get(info.lastInsertRowid);
}
async function updateAsset(p) {
  const d = getDb();
  await d.prepare(
    `UPDATE assets SET name=?, asset_type=?, category=?, identifier=?, plant_id=?, business_id=?, status=?, remarks=? WHERE id=?`
  ).run(
    properCase(p.name),
    p.asset_type || "machine",
    properCase(p.category),
    (p.identifier ?? "").trim().toUpperCase(),
    p.plant_id ?? null,
    p.business_id ?? null,
    p.status || "active",
    p.remarks ?? "",
    p.id
  );
  return await d.prepare(`SELECT * FROM assets WHERE id = ?`).get(p.id);
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
  const money5 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const net = money5(exp.rent - dieselCost - exp.maintenance - exp.other - wages);
  return {
    asset_id: payload.id,
    asset_name: a.name,
    business_name: a.business_name,
    diesel_litres: money5(litres2),
    diesel_cost: money5(dieselCost),
    maintenance: money5(exp.maintenance),
    other_expense: money5(exp.other),
    wages: money5(wages),
    rent_income: money5(exp.rent),
    net
  };
}
async function deleteAsset(payload) {
  const d = getDb();
  const used = await d.prepare(`SELECT COUNT(*) AS c FROM plant_expenses WHERE asset_id = ?`).get(payload.id);
  if (used.c > 0) {
    return { ok: false, error: "Cannot delete: this asset has expense records." };
  }
  await d.prepare(`DELETE FROM assets WHERE id = ?`).run(payload.id);
  return { ok: true };
}

// src/main/services/plantExpenses.ts
function money2(n) {
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
      if (amount <= 0 && rate != null) amount = money2(units * rate);
      else if (amount > 0 && (rate == null || rate === 0)) rate = money2(amount / units);
    }
  } else {
    meter_open = null;
    meter_close = null;
  }
  if (cat === "tipper_rent" || cat === "equipment_rent") {
    if (amount <= 0 && hours != null && rate != null) amount = money2(hours * rate);
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
    amount: money2(amount),
    payment_status: derivePaymentStatus(amount, Number(p.paid_amount) || 0),
    paid_amount: money2(Number(p.paid_amount) || 0),
    date: p.date,
    remarks: p.remarks ?? ""
  };
}
async function createPlantExpense(p) {
  const d = getDb();
  const fields = resolve(p);
  const no = await nextNumber("PEX", "plant_expense");
  const info = await d.prepare(
    `INSERT INTO plant_expenses
        (expense_no, plant_id, category, title, asset_id, outsource_id, meter_open, meter_close, units, rate, hours,
         parts, amount, payment_status, paid_amount, date, remarks)
       VALUES (@expense_no,@plant_id,@category,@title,@asset_id,@outsource_id,@meter_open,@meter_close,@units,@rate,@hours,
         @parts,@amount,@payment_status,@paid_amount,@date,@remarks)`
  ).run({ expense_no: no, ...fields });
  return await d.prepare(`SELECT * FROM plant_expenses WHERE id = ?`).get(info.lastInsertRowid);
}
async function updatePlantExpense(p) {
  const d = getDb();
  if (!p.id) throw new Error("Missing expense id.");
  const fields = resolve(p);
  await d.prepare(
    `UPDATE plant_expenses SET plant_id=@plant_id, category=@category, title=@title, asset_id=@asset_id,
       outsource_id=@outsource_id,
       meter_open=@meter_open, meter_close=@meter_close, units=@units, rate=@rate, hours=@hours,
       parts=@parts, amount=@amount, payment_status=@payment_status, paid_amount=@paid_amount,
       date=@date, remarks=@remarks WHERE id=@id`
  ).run({ id: p.id, ...fields });
  return await d.prepare(`SELECT * FROM plant_expenses WHERE id = ?`).get(p.id);
}
async function deletePlantExpense(payload) {
  const d = getDb();
  await d.prepare(`DELETE FROM plant_expenses WHERE id = ?`).run(payload.id);
  return { ok: true };
}

// src/main/services/businesses.ts
async function listBusinesses() {
  return await getDb().prepare(`SELECT * FROM businesses ORDER BY name`).all();
}
async function createBusiness(p) {
  const d = getDb();
  if (!p.name?.trim()) throw new Error("Business name is required.");
  const info = await d.prepare(`INSERT INTO businesses (name, contact, remarks) VALUES (?, ?, ?)`).run(properCase(p.name), p.contact ?? "", p.remarks ?? "");
  return await d.prepare(`SELECT * FROM businesses WHERE id = ?`).get(info.lastInsertRowid);
}
async function updateBusiness(p) {
  const d = getDb();
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
  const info = await d.prepare(`INSERT INTO outsource (name, head, contact, remarks) VALUES (?, ?, ?, ?)`).run(properCase(p.name), properCase(p.head), p.contact ?? "", p.remarks ?? "");
  return await d.prepare(`SELECT * FROM outsource WHERE id = ?`).get(info.lastInsertRowid);
}
async function updateOutsource(p) {
  const d = getDb();
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
  "production_outputs",
  "productions",
  "rack_sales",
  "rack_expenses",
  "rack_unloadings",
  "rack_loadings",
  "stock_movements",
  "dispatches",
  "purchases",
  "payments",
  "finished_goods_opening",
  "production_settings",
  "wage_entries",
  "employees",
  "diesel_issues",
  "diesel_purchases",
  "plant_expenses",
  "assets",
  "stock_locations",
  "racks",
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
  await d.transaction(async () => {
    for (const t of DATA_TABLES) await d.prepare(`DELETE FROM ${t}`).run();
  });
  if (dbKind() === "sqlite") await getDb().run("VACUUM");
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
function money3(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
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
  const earned = emp.wage_type === "monthly" ? workingDays > 0 ? money3(emp.monthly_salary / workingDays * daysWorked) : 0 : money3(emp.daily_wage * daysWorked);
  const otHours = Number(p.ot_hours) || 0;
  const otRate = p.ot_rate == null || p.ot_rate === "" ? emp.ot_rate : Number(p.ot_rate);
  const otAmount = money3(otHours * otRate);
  const deduction = money3(Number(p.deduction) || 0);
  const gross = money3(earned + otAmount);
  const amount = money3(gross - deduction);
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
    paid_amount: money3(Number(p.paid_amount) || 0),
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
function money4(row) {
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
       WHERE m.material_type='finished'${mAnd} GROUP BY m.product_name HAVING qty <> 0 ORDER BY m.product_name`
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
    await d.prepare(`SELECT COALESCE(SUM(qty_cm),0) AS q FROM dispatches${plWhere}`).get()
  );
  const pendingSupplierPayment = money4(
    await d.prepare(`SELECT COALESCE(SUM(COALESCE(amount,0) - paid_amount),0) AS q FROM purchases WHERE payment_status <> 'paid'${plAnd}`).get()
  );
  const pendingDeliveries = (await d.prepare(`SELECT COUNT(*) AS q FROM dispatches WHERE delivery_status='pending'${plAnd}`).get()).q;
  const deliveredNoRate = (await d.prepare(`SELECT COUNT(*) AS q FROM dispatches WHERE delivery_status='delivered' AND rate IS NULL${plAnd}`).get()).q;
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
  const rackSalesAmount = money4(
    await d.prepare(`SELECT COALESCE(SUM(amount),0) AS q FROM rack_sales`).get()
  );
  const rackTransportCost = money4(
    await d.prepare(
      `SELECT (SELECT COALESCE(SUM(amount),0) FROM rack_loadings)
            + (SELECT COALESCE(SUM(amount),0) FROM rack_unloadings) AS q`
    ).get()
  );
  const totalRackExpenses = money4(
    await d.prepare(`SELECT COALESCE(SUM(amount),0) AS q FROM rack_expenses`).get()
  );
  const rackProfit = money4({ q: rackSalesAmount - rackTransportCost - totalRackExpenses });
  const custSalesExpr = pid ? `COALESCE((SELECT SUM(amount) FROM dispatches WHERE customer_id=c.id AND plant_id=${pid} AND amount IS NOT NULL),0)` : `COALESCE((SELECT SUM(amount) FROM rack_sales WHERE customer_id=c.id AND amount IS NOT NULL),0) +
       COALESCE((SELECT SUM(amount) FROM dispatches WHERE customer_id=c.id AND amount IS NOT NULL),0)`;
  const topCustomers = (await d.prepare(
    `SELECT c.name AS name, ${custSalesExpr} AS amount
         FROM customers c ORDER BY amount DESC LIMIT 5`
  ).all()).filter((r) => r.amount > 0).map((r) => ({ name: r.name, amount: money4({ q: r.amount }) }));
  const monthlySrc = pid ? `SELECT substr(date,1,7) AS month, COALESCE(amount,0) AS amount FROM dispatches WHERE amount IS NOT NULL AND plant_id=${pid}` : `SELECT substr(date,1,7) AS month, COALESCE(amount,0) AS amount FROM rack_sales WHERE amount IS NOT NULL
       UNION ALL
       SELECT substr(date,1,7) AS month, COALESCE(amount,0) AS amount FROM dispatches WHERE amount IS NOT NULL`;
  const monthlySales = (await d.prepare(
    `SELECT month, SUM(amount) AS amount FROM (${monthlySrc}) AS t GROUP BY month ORDER BY month DESC LIMIT 6`
  ).all()).map((r) => ({ month: r.month, amount: money4({ q: r.amount }) })).reverse();
  const custRow = await (pid ? d.prepare(
    `SELECT COALESCE(SUM(COALESCE(amount,0)
             + CASE WHEN transport_billed=1 THEN transport_charge ELSE 0 END
             + CASE WHEN other_billed=1 THEN other_charge ELSE 0 END
             - paid_amount),0) AS q FROM dispatches WHERE plant_id = ${pid}`
  ) : d.prepare(
    `SELECT
            (SELECT COALESCE(SUM(COALESCE(amount,0)
                + CASE WHEN transport_billed=1 THEN transport_charge ELSE 0 END
                + CASE WHEN other_billed=1 THEN other_charge ELSE 0 END
                - paid_amount),0) FROM dispatches) +
            (SELECT COALESCE(SUM(amount),0) FROM rack_sales WHERE amount IS NOT NULL) +
            (SELECT COALESCE(SUM(amount),0) FROM payments WHERE party_type='customer' AND direction='out') -
            (SELECT COALESCE(SUM(amount),0) FROM payments WHERE party_type='customer' AND direction='in') AS q`
  )).get();
  const customerReceivable = money4(custRow);
  const transRow = await (pid ? d.prepare(
    `SELECT COALESCE(SUM(COALESCE(amount,0) - COALESCE(diesel_amount,0)),0) AS q FROM rack_loadings WHERE plant_id = ${pid}`
  ) : d.prepare(
    `SELECT
            (SELECT COALESCE(SUM(COALESCE(amount,0) - COALESCE(diesel_amount,0)),0) FROM rack_loadings) +
            (SELECT COALESCE(SUM(COALESCE(amount,0) - COALESCE(diesel_amount,0)),0) FROM rack_unloadings) -
            (SELECT COALESCE(SUM(amount),0) FROM payments WHERE party_type='transporter' AND direction='out') +
            (SELECT COALESCE(SUM(amount),0) FROM payments WHERE party_type='transporter' AND direction='in') AS q`
  )).get();
  const transporterPayable = money4(transRow);
  const counts = {
    plants: (await d.prepare(`SELECT COUNT(*) AS q FROM plants`).get()).q,
    suppliers: (await d.prepare(`SELECT COUNT(*) AS q FROM suppliers`).get()).q,
    customers: (await d.prepare(`SELECT COUNT(*) AS q FROM customers`).get()).q,
    transporters: (await d.prepare(`SELECT COUNT(*) AS q FROM transporters`).get()).q,
    companies: (await d.prepare(`SELECT COUNT(*) AS q FROM companies`).get()).q,
    racks: (await d.prepare(`SELECT COUNT(*) AS q FROM racks`).get()).q
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
    pendingSupplierPayment,
    pendingDeliveries,
    deliveredNoRate,
    rackStockCm,
    openRacks,
    rackShortageCm,
    rackSalesAmount,
    totalRackExpenses,
    rackTransportCost,
    rackProfit,
    customerReceivable,
    transporterPayable,
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
  "purchases.list": listPurchases,
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
  "dispatches.create": createDispatch,
  "dispatches.update": updateDispatch,
  "dispatches.setRate": setRate,
  "dispatches.setDelivery": setDelivery,
  "dispatches.setPayment": setPayment,
  "dispatches.delete": deleteDispatch,
  "movements.list": listMovements,
  "movements.transfer": transferStock,
  "movements.deleteTransfer": deleteTransfer,
  "transporters.list": listTransporters,
  "transporters.create": createTransporter,
  "transporters.update": updateTransporter,
  "transporters.delete": deleteTransporter,
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
  "racks.updateSale": updateSale,
  "racks.deleteSale": deleteSale,
  "racks.listSales": listSales,
  "ledgers.get": getLedger,
  "ledgers.balances": getPartyBalances,
  "ledgers.allDues": getAllDues,
  "assets.list": listAssets,
  "assets.create": createAsset,
  "assets.update": updateAsset,
  "assets.delete": deleteAsset,
  "assets.report": assetReport,
  "businesses.list": listBusinesses,
  "businesses.create": createBusiness,
  "businesses.update": updateBusiness,
  "businesses.delete": deleteBusiness,
  "outsource.list": listOutsource,
  "outsource.create": createOutsource,
  "outsource.update": updateOutsource,
  "outsource.delete": deleteOutsource,
  "plantExpenses.list": listPlantExpenses,
  "plantExpenses.totals": expenseTotals,
  "plantExpenses.create": createPlantExpense,
  "plantExpenses.update": updatePlantExpense,
  "plantExpenses.delete": deletePlantExpense,
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
      if (!user2) return res.json({ result: { ok: false } });
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
