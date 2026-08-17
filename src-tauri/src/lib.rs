use tauri::Manager;

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    eprintln!("[teleprompter] exit_app invoked, terminating");
    app.exit(0);
}

#[tauri::command]
fn floating_bridge(app: tauri::AppHandle, action: String, payload: String) -> bool {
    // Write to the app-private cache dir so it works on real devices without root.
    // On Android this resolves to Context.getCacheDir(), matching Kotlin's cacheDir.
    let cache_dir = match app.path().app_cache_dir() {
        Ok(dir) => dir.join("teleprompter_bridge"),
        Err(_) => return false,
    };
    if std::fs::create_dir_all(&cache_dir).is_err() {
        return false;
    }
    let marker = cache_dir.join("floating_bridge.json");
    // serde_json escapes control chars (like \x1F) properly so Kotlin's JSONObject can parse it.
    let content = serde_json::json!({
        "action": action,
        "payload": payload,
    })
    .to_string();
    std::fs::write(marker, content).is_ok()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![exit_app, floating_bridge])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
