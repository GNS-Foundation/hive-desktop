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
