// No console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod balloons;
use tauri_plugin_fs::FsExt;

#[tauri::command]
fn grant_balloon_sidecar(app: tauri::AppHandle, path: std::path::PathBuf) -> Result<(), String> {
    let scope = app.fs_scope();
    if !path.is_absolute() || path.is_dir() || !scope.is_allowed(&path) {
        return Err("The source file is outside the allowed scope".into());
    }
    let sidecar = balloons::sidecar_path(&path).ok_or("The source has no file name")?;
    scope.allow_file(sidecar).map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![grant_balloon_sidecar])
        .run(tauri::generate_context!())
        .expect("error while running Project D");
}
