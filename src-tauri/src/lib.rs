//! Roan desktop/mobile shell.
//!
//! The UI is a static bundle taken from `build.frontendDist` (`web/dist`) and
//! compiled into the binary by `tauri::generate_context!()`. Nothing is fetched
//! from a dev server, so the app opens standalone on first launch.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Roan");
}
