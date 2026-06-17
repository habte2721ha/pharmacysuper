import { drizzle } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
import mysql from 'mysql2/promise';
import * as schema from './schema';

const { Pool } = pkg;

// Detect database dialect (Postgres vs MySQL)
const host = process.env.SQL_HOST || '';
const port = process.env.SQL_PORT || '';
const isMySql = host.toLowerCase().includes('mysql') || 
                 host.includes(':3306') || 
                 host.includes(':32636') || 
                 port === '3306' || 
                 port === '32636' || 
                 process.env.DB_TYPE === 'mysql';

// Parse host and port gracefully
let dbHost = host;
let dbPort = isMySql ? 3306 : 5432;

if (host.includes(':')) {
  const parts = host.split(':');
  dbHost = parts[0];
  dbPort = parseInt(parts[1], 10) || (isMySql ? 3306 : 5432);
} else if (port) {
  dbPort = parseInt(port, 10) || (isMySql ? 3306 : 5432);
}

// Database client instance variables
let pgPoolInstance: any = null;
let mysqlPoolInstance: any = null;
let pgDrizzleInstance: any = null;

// Initialize Postgres Pool
export const createPool = () => {
  if (isMySql) {
    return null; // MySQL doesn't use the pg Pool
  }
  if (!pgPoolInstance) {
    pgPoolInstance = new Pool({
      host: dbHost,
      port: dbPort,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      connectionTimeoutMillis: 15000,
    });
    pgPoolInstance.on('error', (err: any) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return pgPoolInstance;
};

// Initialize MySQL Connection Pool
export const getMysqlPool = () => {
  if (!mysqlPoolInstance) {
    mysqlPoolInstance = mysql.createPool({
      host: dbHost,
      port: dbPort,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      connectionLimit: 10,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      connectTimeout: 15000
    });
  }
  return mysqlPoolInstance;
};

// Auto-create/bootstrap schema on startup to prevent table errors
export async function bootstrapDatabaseSchema() {
  if (!process.env.SQL_HOST) return;
  
  try {
    if (isMySql) {
      const pool = getMysqlPool();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS app_data (
          \`key\` VARCHAR(255) PRIMARY KEY,
          \`value\` LONGTEXT NOT NULL
        )
      `);
      console.log("[DB] MySQL app_data schema validated/created successfully.");
    } else {
      const p = createPool();
      if (p) {
        await p.query(`
          CREATE TABLE IF NOT EXISTS app_data (
            key TEXT PRIMARY KEY,
            value JSONB NOT NULL
          )
        `);
        console.log("[DB] PostgreSQL app_data schema validated/created successfully.");
      }
    }
  } catch (err: any) {
    console.error("[DB] Failed to bootstrap database schema:", err.message || err);
  }
}

// Extract string key from general Drizzle where() clauses
function extractKeyFromWhere(whereClause: any): string {
  if (!whereClause) return '';
  if (typeof whereClause === 'string') return whereClause;
  if (whereClause.keyVal) return whereClause.keyVal;
  
  const seen = new Set();
  const findString = (obj: any): string => {
    if (!obj || seen.has(obj)) return '';
    if (typeof obj === 'string') {
      if (obj.startsWith('pharma_') || obj.includes('receipt') || obj.includes('counter')) {
        return obj;
      }
    }
    if (typeof obj === 'object') {
      seen.add(obj);
      for (const k of Object.keys(obj)) {
        try {
          const res = findString(obj[k]);
          if (res) return res;
        } catch (e) {}
      }
    }
    return '';
  };
  return findString(whereClause);
}

// Fluent DB wrapper mapping Drizzle syntax to MySQL/Postgres
export const dbWrapper: any = {
  select: () => {
    if (!isMySql) {
      if (!pgDrizzleInstance) {
        pgDrizzleInstance = drizzle(createPool(), { schema });
      }
      return pgDrizzleInstance.select();
    }

    return {
      from: (table: any) => {
        return {
          limit: async (num: number) => {
            const pool = getMysqlPool();
            const [rows]: any = await pool.query('SELECT `key`, `value` FROM app_data LIMIT ?', [num]);
            return rows.map((r: any) => ({
              key: r.key,
              value: typeof r.value === 'string' ? JSON.parse(r.value) : r.value
            }));
          },
          where: (whereClause: any) => {
            return {
              limit: async (num: number) => {
                const keyVal = extractKeyFromWhere(whereClause);
                const pool = getMysqlPool();
                const [rows]: any = await pool.query('SELECT `key`, `value` FROM app_data WHERE `key` = ? LIMIT ?', [keyVal, num]);
                return rows.map((r: any) => ({
                  key: r.key,
                  value: typeof r.value === 'string' ? JSON.parse(r.value) : r.value
                }));
              }
            };
          }
        };
      }
    };
  },
  delete: (table: any) => {
    if (!isMySql) {
      if (!pgDrizzleInstance) {
        pgDrizzleInstance = drizzle(createPool(), { schema });
      }
      return pgDrizzleInstance.delete(table);
    }

    return {
      where: (whereClause: any) => {
        return {
          then: async (resolve?: any) => {
            const keyVal = extractKeyFromWhere(whereClause);
            const pool = getMysqlPool();
            await pool.query('DELETE FROM app_data WHERE `key` = ?', [keyVal]);
            if (resolve) resolve();
          }
        };
      }
    };
  },
  insert: (table: any) => {
    if (!isMySql) {
      if (!pgDrizzleInstance) {
        pgDrizzleInstance = drizzle(createPool(), { schema });
      }
      return pgDrizzleInstance.insert(table);
    }

    return {
      values: (data: any) => {
        return {
          onConflictDoUpdate: async (config: any) => {
            const pool = getMysqlPool();
            const strVal = JSON.stringify(data.value);
            await pool.query(
              'INSERT INTO app_data (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = ?',
              [data.key, strVal, strVal]
            );
          }
        };
      }
    };
  }
};

export const db = dbWrapper;
export const pool = isMySql ? null : createPool();
