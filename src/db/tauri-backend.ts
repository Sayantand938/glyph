/** The SQLite connection of the Tauri app (see src-tauri/src/sql.rs). */
import { invoke } from "@tauri-apps/api/core"

import type { SqlBackend, SqlRow } from "./sql"

export const tauriBackend: SqlBackend = {
  select: (sql, params = []) => invoke<SqlRow[]>("sql_select", { sql, params }),
  execute: (sql, params = []) => invoke<number>("sql_execute", { sql, params }),
  executeMany: (sql, rows) => invoke<number>("sql_execute_many", { sql, rows }),
  script: (sql) => invoke<void>("sql_script", { sql }),
}
