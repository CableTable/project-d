// No console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod balloons;
use tauri_plugin_fs::FsExt;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let scope = app.fs_scope();
            let sidecars = scope.clone();
            // Dialogs grant only the chosen file; its balloon file needs its own exact grant.
            scope.listen(move |event| {
                if let tauri::fs::Event::PathAllowed(path) = event {
                    if !path.is_dir() {
                        if let Some(sidecar) = balloons::sidecar_path(path) {
                            if let Err(error) = sidecars.allow_file(&sidecar) {
                                eprintln!("Balloon file scope: {}: {}", sidecar.display(), error);
                            }
                        }
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Project D");
}
