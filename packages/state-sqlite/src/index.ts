import { copyBytes, type MatrixStore } from "better-matrix-js";

export interface SQLiteDatabaseLike {
  exec(sql: string): unknown;
  prepare(sql: string): {
    all?(...params: unknown[]): unknown[];
    get?(...params: unknown[]): unknown;
    run?(...params: unknown[]): unknown;
  };
}

export interface SQLiteMatrixStoreOptions {
  tableName?: string;
}

export class SQLiteMatrixStore implements MatrixStore {
  readonly #database: SQLiteDatabaseLike;
  readonly #tableName: string;

  constructor(database: SQLiteDatabaseLike, options: SQLiteMatrixStoreOptions = {}) {
    this.#database = database;
    this.#tableName = options.tableName ?? "matrix_store";
    this.#ensureSchema();
  }

  async delete(key: string): Promise<void> {
    this.#database.prepare(`DELETE FROM ${this.#tableName} WHERE key = ?`).run?.(key);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const row = this.#database
      .prepare(`SELECT value FROM ${this.#tableName} WHERE key = ?`)
      .get?.(key) as { value?: ArrayBuffer | Uint8Array | number[] } | undefined;
    return row?.value ? copyBytes(row.value) : null;
  }

  async list(prefix: string): Promise<string[]> {
    const rows = this.#database
      .prepare(`SELECT key FROM ${this.#tableName} WHERE key LIKE ? ESCAPE '\\' ORDER BY key`)
      .all?.(escapeLike(prefix) + "%") as Array<{ key: string }> | undefined;
    return (rows ?? []).map((row) => row.key);
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    this.#database
      .prepare(
        `INSERT INTO ${this.#tableName} (key, value)
         VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run?.(key, copyBytes(value));
  }

  #ensureSchema(): void {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(this.#tableName)) {
      throw new Error("SQLiteMatrixStore tableName must be a valid SQLite identifier.");
    }
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS ${this.#tableName} (
        key TEXT PRIMARY KEY,
        value BLOB NOT NULL
      )
    `);
  }
}

export async function createSQLiteMatrixStore(
  filename: string,
  options: SQLiteMatrixStoreOptions = {}
): Promise<SQLiteMatrixStore> {
  const sqlite = await import("node:sqlite");
  return new SQLiteMatrixStore(new sqlite.DatabaseSync(filename), options);
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
