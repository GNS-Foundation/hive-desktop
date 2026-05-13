mod api;
mod commands;
mod geo;
mod hardware;
mod identity;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::onboarding_preview,
            commands::redeem_invitation,
            commands::close_setup_window,
            commands::get_existing_registration,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
