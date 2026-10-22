// No console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod balloons;
mod launch;
use std::{path::PathBuf, sync::Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_fs::FsExt;

struct LaunchFiles(Mutex<Vec<PathBuf>>);

#[tauri::command]
fn take_launch_files(app: tauri::AppHandle, files: tauri::State<LaunchFiles>) -> Vec<(PathBuf, Option<String>)> {
    let scope = app.fs_scope();
    let paths = std::mem::take(&mut *files.0.lock().unwrap());
    paths.into_iter().map(|path| {
        let error = scope.allow_file(&path).err().map(|error| error.to_string());
        (path, error)
    }).collect()
}

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
    let cwd = std::env::current_dir().expect("could not read launch directory");
    tauri::Builder::default()
        .manage(LaunchFiles(Mutex::new(launch::file_paths(std::env::args(), &cwd))))
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let paths = launch::file_paths(args, std::path::Path::new(&cwd));
            app.state::<LaunchFiles>().0.lock().unwrap().extend(paths);
            // Keep paths queued if the web listener has not loaded yet.
            let _ = app.emit("open-launch-files", ());
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![grant_balloon_sidecar, take_launch_files])
        .run(tauri::generate_context!())
        .expect("error while running Project D");
}
