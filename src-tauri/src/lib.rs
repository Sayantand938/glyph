mod sql;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      let db = sql::open(app.handle())?;
      tauri::Manager::manage(app, db);
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      sql::sql_select,
      sql::sql_execute,
      sql::sql_execute_many,
      sql::sql_script
    ])
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
