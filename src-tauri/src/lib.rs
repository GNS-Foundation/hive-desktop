mod api;
mod commands;
mod geo;
mod hardware;
mod identity;

// === v0.4.3 heartbeat ===
use std::time::Duration;

/// Background task: every 30s, ping /hive/workers/heartbeat so that
/// hive_devices.last_heartbeat reflects whether this desktop is actually
/// running. Errors are logged to stderr and swallowed — the loop never
/// crashes the app.
async fn heartbeat_loop() {
    // Stagger the first tick so we don't race with onboarding flow.
    tokio::time::sleep(Duration::from_secs(10)).await;

    loop {
        match identity::get_or_create_identity() {
            Ok(identity) => {
                let payload = api::HeartbeatPayload::online();
                match api::send_heartbeat(&identity, &payload).await {
                    Ok(_) => {
                        // Quiet success
                    }
                    Err(e) => {
                        let msg = e.to_string();
                        if msg.contains("device_not_registered") {
                            // User hasn't registered yet — retry quietly.
                            eprintln!("[heartbeat] device not registered yet");
                        } else {
                            eprintln!("[heartbeat] failed: {}", msg);
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("[heartbeat] identity not available: {}", e);
            }
        }

        tokio::time::sleep(Duration::from_secs(30)).await;
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|_app| {
            // Spawn background heartbeat task — pings backend every 30s
            // so hive_devices.last_heartbeat reflects reality.
            tauri::async_runtime::spawn(heartbeat_loop());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::onboarding_preview,
            commands::redeem_invitation,
            commands::close_setup_window,
            commands::get_existing_registration,
            commands::open_dashboard,
            commands::get_quota,
            commands::set_display_name,
            commands::issue_invitation,
            commands::chat_completion,
            commands::open_download_page,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
