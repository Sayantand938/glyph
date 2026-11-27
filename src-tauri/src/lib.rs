mod discovery;
mod sql;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default();
  // Must be the first plugin, and desktop-only: the crate is empty on mobile.
  // A second launch focuses the first window instead of opening another writer
  // on the same SQLite file.
  #[cfg(desktop)]
  let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
    if let Some(window) = tauri::Manager::get_webview_window(app, "main") {
      let _ = window.unminimize();
      let _ = window.show();
      let _ = window.set_focus();
    }
  }));
  builder
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .manage(discovery::Discovery::default())
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
      sql::sql_script,
      discovery::discovery_start,
      discovery::discovery_stop,
      discovery::discovery_connect,
      discovery::discovery_send,
      discovery::discovery_close
    ])
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
