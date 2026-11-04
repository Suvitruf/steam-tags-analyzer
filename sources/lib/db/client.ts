import initSqlJs, { Database } from 'sql.js';
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { fetchBytes } from '../fetch-progress';

let db: Database | null = null;

export type DatabaseLoadEvent =
  | { phase: 'download'; loaded: number; total: number | null }
  | { phase: 'open' };
export type DatabaseLoadProgress = (event: DatabaseLoadEvent) => void;

export async function loadDatabase(dbUrl: string, onProgress?: DatabaseLoadProgress): Promise<Database> {
  const SQL = await initSqlJs({
    locateFile: () => sqlWasmUrl,
  });

  const bytes = await fetchBytes(
    dbUrl,
    onProgress && ((loaded, total) => onProgress({ phase: 'download', loaded, total })),
    'database'
  );
  // sql.js adopts the buffer without copying; the first queries pay the parse.
  onProgress?.({ phase: 'open' });
  db = new SQL.Database(bytes);
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
