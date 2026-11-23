//! A thin SQLite bridge: the app's data layer is written in TypeScript (schema,
//! migrations, queries), and these commands only run SQL on one connection.
//! The front end serializes its calls (one transaction at a time), so
//! `BEGIN` ... `COMMIT` sent as separate calls land on the same connection
//! with nothing in between.

use std::sync::Mutex;

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde_json::{Map, Number, Value};
use tauri::{Manager, State};

pub struct Db(Mutex<Connection>);

/// Opens (creating if needed) `glyph.db` in the app data directory.
pub fn open(app: &tauri::AppHandle) -> Result<Db, Box<dyn std::error::Error>> {
  let dir = app.path().app_data_dir()?;
  std::fs::create_dir_all(&dir)?;
  let conn = Connection::open(dir.join("glyph.db"))?;
  conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")?;
  Ok(Db(Mutex::new(conn)))
}

fn to_sql(value: &Value) -> SqlValue {
  match value {
    Value::Null => SqlValue::Null,
    Value::Bool(b) => SqlValue::Integer(i64::from(*b)),
    Value::Number(n) => match n.as_i64() {
      Some(i) => SqlValue::Integer(i),
      None => SqlValue::Real(n.as_f64().unwrap_or(0.0)),
    },
    Value::String(s) => SqlValue::Text(s.clone()),
    other => SqlValue::Text(other.to_string()),
  }
}

fn from_sql(value: ValueRef) -> Value {
  match value {
    ValueRef::Null => Value::Null,
    ValueRef::Integer(i) => Value::Number(i.into()),
    ValueRef::Real(f) => Number::from_f64(f).map_or(Value::Null, Value::Number),
    ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
    ValueRef::Blob(_) => Value::Null,
  }
}

fn lock<'a>(
  state: &'a State<Db>,
) -> Result<std::sync::MutexGuard<'a, Connection>, String> {
  state.0.lock().map_err(|e| e.to_string())
}

/// Runs a query and returns its rows as objects keyed by column name.
#[tauri::command]
pub async fn sql_select(
  state: State<'_, Db>,
  sql: String,
  params: Vec<Value>,
) -> Result<Vec<Map<String, Value>>, String> {
  let conn = lock(&state)?;
  let mut stmt = conn.prepare_cached(&sql).map_err(|e| e.to_string())?;
  let names: Vec<String> = stmt.column_names().map(|n| n.to_string()).collect();
  let mut rows = stmt
    .query(params_from_iter(params.iter().map(to_sql)))
    .map_err(|e| e.to_string())?;
  let mut out = Vec::new();
  while let Some(row) = rows.next().map_err(|e| e.to_string())? {
    let mut object = Map::new();
    for (i, name) in names.iter().enumerate() {
      object.insert(name.clone(), from_sql(row.get_ref(i).map_err(|e| e.to_string())?));
    }
    out.push(object);
  }
  Ok(out)
}

/// Runs one statement; returns the number of rows it changed.
#[tauri::command]
pub async fn sql_execute(
  state: State<'_, Db>,
  sql: String,
  params: Vec<Value>,
) -> Result<usize, String> {
  let conn = lock(&state)?;
  let mut stmt = conn.prepare_cached(&sql).map_err(|e| e.to_string())?;
  stmt
    .execute(params_from_iter(params.iter().map(to_sql)))
    .map_err(|e| e.to_string())
}

/// Runs one statement once per row of parameters (a bulk write in one call).
/// The caller wraps it in a transaction.
#[tauri::command]
pub async fn sql_execute_many(
  state: State<'_, Db>,
  sql: String,
  rows: Vec<Vec<Value>>,
) -> Result<usize, String> {
  let conn = lock(&state)?;
  let mut stmt = conn.prepare_cached(&sql).map_err(|e| e.to_string())?;
  let mut changed = 0;
  for params in &rows {
    changed += stmt
      .execute(params_from_iter(params.iter().map(to_sql)))
      .map_err(|e| e.to_string())?;
  }
  Ok(changed)
}

/// Runs several statements without parameters (the schema).
#[tauri::command]
pub async fn sql_script(state: State<'_, Db>, sql: String) -> Result<(), String> {
  lock(&state)?.execute_batch(&sql).map_err(|e| e.to_string())
}
