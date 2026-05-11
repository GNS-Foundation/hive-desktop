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
    api::register_worker(&id, &hw, &geo, &invitation_code)
        .await
        .map_err(|e| format!("register: {:?}", e))
}
