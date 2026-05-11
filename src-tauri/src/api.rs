// HTTP client for the GEIANT backend.

use crate::geo::GeoProfile;
use crate::hardware::HardwareProfile;
use crate::identity::Identity;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

pub const BACKEND_URL: &str = "https://gns-browser-production.up.railway.app";

#[derive(Debug, Serialize)]
struct RegisterRequest<'a> {
    device_pk: &'a str,
    invitation_code: &'a str,
    device_signature: String,
    timestamp: u64,
    hardware: HardwarePayload<'a>,
    h3_cell_r10: &'a str,
    h3_cell_r7: &'a str,
    device_name: Option<&'a str>,
}

#[derive(Debug, Serialize)]
struct HardwarePayload<'a> {
    platform: &'a str,
    gpu: &'a str,
    gpu_name: Option<&'a str>,
    gpu_vram_mb: u64,
    mem_bandwidth_gbs: f64,
    ram_total_mb: u64,
    ram_available_mb: u64,
    cpu_cores: usize,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct RegisterResponse {
    #[serde(default)]
    pub success: bool,
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default)]
    pub device_pk: Option<String>,
    #[serde(default)]
    pub tier: Option<String>,
    #[serde(default)]
    pub quota_total: Option<i32>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub detail: Option<String>,
}

pub async fn register_worker(
    identity: &Identity,
    hardware: &HardwareProfile,
    geo: &GeoProfile,
    invitation_code: &str,
) -> Result<RegisterResponse> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)?
        .as_millis() as u64;

    let canonical = format!(
        "gns-worker-register-v1:{}:{}:{}",
        invitation_code, identity.pk, timestamp
    );
    let device_signature = identity.sign(&canonical)?;

    let device_name = hardware.hostname.as_deref();

    let payload = RegisterRequest {
        device_pk: &identity.pk,
        invitation_code,
        device_signature,
        timestamp,
        hardware: HardwarePayload {
            platform: hardware.platform,
            gpu: hardware.gpu,
            gpu_name: hardware.gpu_name.as_deref(),
            gpu_vram_mb: hardware.gpu_vram_mb,
            mem_bandwidth_gbs: hardware.mem_bandwidth_gbs,
            ram_total_mb: hardware.ram_total_mb,
            ram_available_mb: hardware.ram_available_mb,
            cpu_cores: hardware.cpu_cores,
        },
        h3_cell_r10: &geo.h3_cell_r10,
        h3_cell_r7: &geo.h3_cell_r7,
        device_name,
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()?;

    let url = format!("{}/hive/workers/register", BACKEND_URL);
    let resp = client
        .post(&url)
        .json(&payload)
        .send()
        .await
        .context("POST /hive/workers/register failed")?;

    let status = resp.status();
    let text = resp.text().await.context("response body read failed")?;

    let parsed: RegisterResponse = serde_json::from_str(&text)
        .with_context(|| format!("non-JSON response (status {}): {}", status, text))?;

    Ok(parsed)
}
