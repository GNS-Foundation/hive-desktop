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

// ===========================================================================
// v0.3 viral chain: signed requests to /hive/invitations/*
//
// Signing contract matches the backend's signedRequest middleware:
//   canonical = "<domain>:<timestamp>:<sha256(rawBody)>"
//   headers: X-GNS-PublicKey, X-GNS-Signature, X-GNS-Timestamp
// ===========================================================================

use sha2::{Sha256, Digest};
use rand_core::{OsRng, RngCore};

const INVITE_BASE_URL: &str = "https://hive.geiant.com/invite";

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct QuotaInfo {
    #[serde(default)]
    pub success: bool,
    #[serde(default)]
    pub quota_total: Option<i32>,
    #[serde(default)]
    pub quota_used: Option<i32>,
    #[serde(default)]
    pub remaining: Option<i32>,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct DisplayNameResponse {
    #[serde(default)]
    pub success: bool,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct InvitationData {
    pub code: String,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub inviter_pk: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct IssueInvitationResponse {
    #[serde(default)]
    pub success: bool,
    #[serde(default)]
    pub invitation: Option<InvitationData>,
    #[serde(default)]
    pub invite_url: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub detail: Option<serde_json::Value>,
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn now_unix_ms() -> Result<u64> {
    Ok(SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64)
}

pub async fn get_quota(identity: &Identity) -> Result<QuotaInfo> {
    let timestamp = now_unix_ms()?;
    let body_hash = sha256_hex(&[]);
    let canonical = format!("gns-quota-get-v1:{}:{}", timestamp, body_hash);
    let signature = identity.sign(&canonical)?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()?;
    let url = format!("{}/hive/invitations/quota", BACKEND_URL);
    let resp = client.get(&url)
        .header("X-GNS-PublicKey", &identity.pk)
        .header("X-GNS-Signature", &signature)
        .header("X-GNS-Timestamp", timestamp.to_string())
        .send()
        .await
        .context("GET /hive/invitations/quota failed")?;
    let status = resp.status();
    let text = resp.text().await.context("response body read failed")?;
    let parsed: QuotaInfo = serde_json::from_str(&text)
        .with_context(|| format!("non-JSON response (status {}): {}", status, text))?;
    Ok(parsed)
}

pub async fn set_display_name(identity: &Identity, name: &str) -> Result<DisplayNameResponse> {
    let timestamp = now_unix_ms()?;
    let body_obj = serde_json::json!({ "display_name": name });
    let body_bytes = serde_json::to_vec(&body_obj)?;
    let body_hash = sha256_hex(&body_bytes);
    let canonical = format!("gns-quota-set-name-v1:{}:{}", timestamp, body_hash);
    let signature = identity.sign(&canonical)?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()?;
    let url = format!("{}/hive/invitations/display-name", BACKEND_URL);
    let resp = client.patch(&url)
        .header("Content-Type", "application/json")
        .header("X-GNS-PublicKey", &identity.pk)
        .header("X-GNS-Signature", &signature)
        .header("X-GNS-Timestamp", timestamp.to_string())
        .body(body_bytes)
        .send()
        .await
        .context("PATCH /hive/invitations/display-name failed")?;
    let status = resp.status();
    let text = resp.text().await.context("response body read failed")?;
    let parsed: DisplayNameResponse = serde_json::from_str(&text)
        .with_context(|| format!("non-JSON response (status {}): {}", status, text))?;
    Ok(parsed)
}

fn generate_invitation_code() -> String {
    // Skip easily-confused chars: 0/O, 1/I/L
    let alphabet = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let mut buf = [0u8; 8];
    OsRng.fill_bytes(&mut buf);
    let suffix: String = buf.iter()
        .map(|&b| alphabet[(b as usize) % alphabet.len()] as char)
        .collect();
    format!("GEIANT-{}", suffix)
}

pub async fn issue_invitation(identity: &Identity) -> Result<IssueInvitationResponse> {
    // Generate code
    let code = generate_invitation_code();

    // Inner signature: gns-invitation-v1:<code>:<inviter_pk>
    let inviter_canonical = format!("gns-invitation-v1:{}:{}", code, identity.pk);
    let inviter_signature = identity.sign(&inviter_canonical)?;

    // Body
    let body_obj = serde_json::json!({
        "code": code.clone(),
        "inviter_signature": inviter_signature,
    });
    let body_bytes = serde_json::to_vec(&body_obj)?;

    // Outer HTTP signature: gns-invitation-create-v1:<ts>:<bodyHash>
    let timestamp = now_unix_ms()?;
    let body_hash = sha256_hex(&body_bytes);
    let request_canonical = format!("gns-invitation-create-v1:{}:{}", timestamp, body_hash);
    let request_signature = identity.sign(&request_canonical)?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()?;
    let url = format!("{}/hive/invitations", BACKEND_URL);
    let resp = client.post(&url)
        .header("Content-Type", "application/json")
        .header("X-GNS-PublicKey", &identity.pk)
        .header("X-GNS-Signature", &request_signature)
        .header("X-GNS-Timestamp", timestamp.to_string())
        .body(body_bytes)
        .send()
        .await
        .context("POST /hive/invitations failed")?;
    let status = resp.status();
    let text = resp.text().await.context("response body read failed")?;
    let mut parsed: IssueInvitationResponse = serde_json::from_str(&text)
        .with_context(|| format!("non-JSON response (status {}): {}", status, text))?;

    // Synthesize invite_url if backend didn't (it doesn't today)
    if parsed.invite_url.is_none() {
        if let Some(inv) = &parsed.invitation {
            parsed.invite_url = Some(format!("{}/{}", INVITE_BASE_URL, inv.code));
        }
    }
    Ok(parsed)
}

// === v0.4.0 chat completion ===

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ChatChoice {
    pub message: ChatMessage,
    #[serde(default)]
    pub finish_reason: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ChatUsage {
    #[serde(default)]
    pub prompt_tokens: Option<u32>,
    #[serde(default)]
    pub completion_tokens: Option<u32>,
    #[serde(default)]
    pub total_tokens: Option<u32>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct HiveExtension {
    pub job_id: String,
    #[serde(default)]
    pub tokens_per_second: Option<f64>,
    pub h3_cell: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct ChatCompletionResponse {
    pub id: String,
    pub model: String,
    pub choices: Vec<ChatChoice>,
    #[serde(default)]
    pub usage: Option<ChatUsage>,
    #[serde(default)]
    pub hive: Option<HiveExtension>,
}

pub async fn chat_completion(
    identity: &Identity,
    messages: Vec<ChatMessage>,
    model: Option<String>,
) -> Result<ChatCompletionResponse> {
    let model = model.unwrap_or_else(|| "tinyllama".to_string());

    let body_obj = serde_json::json!({
        "model": model,
        "messages": messages,
        "max_tokens": 200,
        "temperature": 0.7,
        "stream": false,
    });
    let body_bytes = serde_json::to_vec(&body_obj)?;
    let body_hash = sha256_hex(&body_bytes);
    let timestamp = now_unix_ms()?;
    let canonical = format!("gns-chat-v1:{}:{}", timestamp, body_hash);
    let signature = identity.sign(&canonical)?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()?;
    let url = format!("{}/hive/v1/chat/completions", BACKEND_URL);
    let resp = client.post(&url)
        .header("Content-Type", "application/json")
        .header("X-GNS-PublicKey", &identity.pk)
        .header("X-GNS-Signature", &signature)
        .header("X-GNS-Timestamp", timestamp.to_string())
        .body(body_bytes)
        .send()
        .await
        .context("POST /hive/v1/chat/completions failed")?;

    let status = resp.status();
    let text = resp.text().await.context("response body read failed")?;
    let parsed: ChatCompletionResponse = serde_json::from_str(&text)
        .with_context(|| {
            let preview: String = text.chars().take(300).collect();
            format!("non-JSON response (status {}): {}", status, preview)
        })?;
    Ok(parsed)
}

