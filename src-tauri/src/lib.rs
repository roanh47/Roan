//! Roan desktop/mobile shell.
//!
//! The UI is a static bundle taken from `build.frontendDist` (`web/dist`) and
//! compiled into the binary by `tauri::generate_context!()`. Nothing is fetched
//! from a dev server, so the app opens standalone on first launch.
//!
//! Desktop only: the app *is* a node, so it starts its own daemon as a sidecar
//! the moment the window opens, and stops it when the app exits. Without this
//! the bundle ships a daemon nobody runs and the window opens onto "connecting".

use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Where the running sidecar lives, so exit can stop it.
struct DaemonChild(std::sync::Mutex<Option<CommandChild>>);

#[cfg(desktop)]
fn stop_daemon(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<DaemonChild>() {
        if let Some(mut child) = state.0.lock().ok().and_then(|mut guard| guard.take()) {
            let _ = child.kill();
        }
    }
}

#[cfg(desktop)]
fn spawn_daemon(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let (mut rx, child) = app.shell().sidecar("roan-daemon")?.spawn()?;
    app.manage(DaemonChild(std::sync::Mutex::new(Some(child))));
    // The daemon's own output, forwarded: an installed app has no console, but
    // debug builds and CI both read stderr.
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => eprintln!("[daemon] {}", String::from_utf8_lossy(&line)),
                CommandEvent::Stderr(line) => eprintln!("[daemon] {}", String::from_utf8_lossy(&line)),
                _ => {}
            }
        }
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        // The updater reads `plugins.updater.endpoints` from the config and
        // checks the signature against the public key before it installs.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(desktop)]
            spawn_daemon(app)?;
            Ok(())
        });

    #[cfg(desktop)]
    {
        builder = builder.on_window_event(|window, event| {
            // No orphan on 7411: when the window goes, the agent goes with it.
            if matches!(event, tauri::WindowEvent::Destroyed) {
                stop_daemon(window.app_handle());
            }
        });
    }

    builder
        .build(tauri::generate_context!())
        .expect("error while building Roan")
        .run(|app_handle, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                #[cfg(desktop)]
                stop_daemon(app_handle);
            }
        });
}
