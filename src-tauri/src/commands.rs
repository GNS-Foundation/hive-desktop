// Tauri commands exposed to the JS frontend via window.__TAURI__.invoke.

use crate::api;
use crate::geo;
use crate::hardware;
use crate::identity;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct OnboardingPreview {
    pub identity_pk: String,
    pub hardware: hardware::HardwareProfile,
    pub geo: geo::GeoProfile,
}

#[tauri::command]
pub async fn onboarding_preview() -> Result<OnboardingPreview, String> {
    let id = identity::get_or_create_identity().map_err(|e| format!("identity: {:?}", e))?;
    let hw = hardware::detect().map_err(|e| format!("hardware: {:?}", e))?;
    let geo = geo::detect().await.map_err(|e| format!("geo: {:?}", e))?;
    Ok(OnboardingPreview {
        identity_pk: id.pk,
        hardware: hw,
        geo,
    })
}

#[tauri::command]
pub async fn redeem_invitation(invitation_code: String) -> Result<api::RegisterResponse, String> {
    let id = identity::get_or_create_identity().map_err(|e| format!("identity: {:?}", e))?;
    let hw = hardware::detect().map_err(|e| format!("hardware: {:?}", e))?;
    let geo = geo::detect().await.map_err(|e| format!("geo: {:?}", e))?;
    let resp = api::register_worker(&id, &hw, &geo, &invitation_code)
        .await
        .map_err(|e| format!("register: {:?}", e))?;

    // Persist on success so subsequent launches skip the wizard
    if resp.success {
        if let (Some(device_id), Some(tier)) = (&resp.device_id, &resp.tier) {
            let reg = identity::Registration {
                device_id: device_id.clone(),
                device_pk: id.pk.clone(),
                tier: tier.clone(),
                registered_at_ms: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0),
            };
            let _ = identity::save_registration(&reg);
        }
    }
    Ok(resp)
}

#[tauri::command]
pub fn close_setup_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_existing_registration() -> Result<Option<identity::Registration>, String> {
    identity::load_registration().map_err(|e| format!("load_registration: {:?}", e))
}

#[tauri::command]
pub fn open_dashboard(app: tauri::AppHandle, device_id: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let url = format!("https://hive.geiant.com/dashboard?me={}", device_id);
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_quota() -> Result<api::QuotaInfo, String> {
    let id = identity::get_or_create_identity().map_err(|e| format!("identity: {:?}", e))?;
    api::get_quota(&id).await.map_err(|e| format!("get_quota: {:?}", e))
}

#[tauri::command]
pub async fn set_display_name(name: String) -> Result<api::DisplayNameResponse, String> {
    let id = identity::get_or_create_identity().map_err(|e| format!("identity: {:?}", e))?;
    api::set_display_name(&id, &name).await.map_err(|e| format!("set_display_name: {:?}", e))
}

#[tauri::command]
pub async fn issue_invitation() -> Result<api::IssueInvitationResponse, String> {
    let id = identity::get_or_create_identity().map_err(|e| format!("identity: {:?}", e))?;
    api::issue_invitation(&id).await.map_err(|e| format!("issue_invitation: {:?}", e))
}

// === v0.4.0 chat completion command ===

#[tauri::command]
pub async fn chat_completion(messages: Vec<api::ChatMessage>) -> Result<api::ChatCompletionResponse, String> {
    let id = identity::get_or_create_identity().map_err(|e| format!("identity: {:?}", e))?;
    api::chat_completion(&id, messages, None).await.map_err(|e| format!("chat_completion: {:?}", e))
}

// === v0.4.4: open the download/update page in the user's default browser ===
#[tauri::command]
pub fn open_download_page(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url("https://hive.geiant.com/download", None::<&str>)
        .map_err(|e| e.to_string())
}
