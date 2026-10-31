import initSqlJs, { Database } from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

let db: Database | null = null;

export async function loadDatabase(dbUrl: string): Promise<Database> {
  const SQL = await initSqlJs({
    locateFile: () => sqlWasmUrl,
  });

  const response = await fetch(dbUrl);
  if (!response.ok) {
    throw new Error(`Failed to load database: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  db = new SQL.Database(new Uint8Array(buffer));
  return db;
}

export function getDatabase(): Database {
  if (!db) throw new Error('Database not loaded. Call loadDatabase() first.');
  return db;
}

export function query<T>(sql: string, params?: any[]): T[] {
  const database = getDatabase();
  const stmt = database.prepare(sql);
  if (params) stmt.bind(params);

  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return results;
}

export function queryOne<T>(sql: string, params?: any[]): T | null {
  const results = query<T>(sql, params);
  return results.length > 0 ? results[0] : null;
}
