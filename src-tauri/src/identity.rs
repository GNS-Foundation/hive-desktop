// Ed25519 keypair management. Generates a new keypair on first run and
// persists it to ~/Library/Application Support/geiant-hive/identity.json
// (macOS) or ~/.config/geiant-hive/identity.json (Linux).

use anyhow::{anyhow, Context, Result};
use ed25519_dalek::{Signature, Signer, SigningKey};
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

const APP_DIR_NAME: &str = "geiant-hive";
const IDENTITY_FILE: &str = "identity.json";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Identity {
    pub pk: String,
    pub sk: String,
    pub created_at_ms: u64,
    #[serde(default)]
    pub source: Option<String>,
}

impl Identity {
    pub fn generate() -> Self {
        let signing_key = SigningKey::generate(&mut OsRng);
        let verifying_key = signing_key.verifying_key();
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        Self {
            pk: hex::encode(verifying_key.to_bytes()),
            sk: hex::encode(signing_key.to_bytes()),
            created_at_ms: now_ms,
            source: Some("hive-desktop generate".to_string()),
        }
    }

    pub fn signing_key(&self) -> Result<SigningKey> {
        let bytes = hex::decode(&self.sk).context("identity.sk is not valid hex")?;
        if bytes.len() != 32 {
            return Err(anyhow!(
                "identity.sk must decode to 32 bytes (seed), got {}",
                bytes.len()
            ));
        }
        let seed: [u8; 32] = bytes
            .try_into()
            .map_err(|_| anyhow!("invalid seed length"))?;
        Ok(SigningKey::from_bytes(&seed))
    }

    pub fn sign(&self, msg: &str) -> Result<String> {
        let signing_key = self.signing_key()?;
        let sig: Signature = signing_key.sign(msg.as_bytes());
        Ok(hex::encode(sig.to_bytes()))
    }
}

pub fn identity_path() -> Result<PathBuf> {
    let base = dirs::config_dir()
        .ok_or_else(|| anyhow!("could not determine user config directory"))?;
    Ok(base.join(APP_DIR_NAME).join(IDENTITY_FILE))
}

pub fn load_identity() -> Result<Option<Identity>> {
    let path = identity_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(&path)
        .with_context(|| format!("failed to read {}", path.display()))?;
    let id: Identity = serde_json::from_str(&contents).context("identity.json malformed")?;
    Ok(Some(id))
}

pub fn save_identity(id: &Identity) -> Result<PathBuf> {
    let path = identity_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
        #[cfg(unix)]
        {
            let mut perms = fs::metadata(parent)?.permissions();
            perms.set_mode(0o700);
            fs::set_permissions(parent, perms)?;
        }
    }
    let json = serde_json::to_string_pretty(id)?;
    fs::write(&path, json + "\n")?;
    #[cfg(unix)]
    {
        let mut perms = fs::metadata(&path)?.permissions();
        perms.set_mode(0o600);
        fs::set_permissions(&path, perms)?;
    }
    Ok(path)
}

pub fn get_or_create_identity() -> Result<Identity> {
    if let Some(existing) = load_identity()? {
        return Ok(existing);
    }
    let new_id = Identity::generate();
    save_identity(&new_id)?;
    Ok(new_id)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Registration {
    pub device_id: String,
    pub device_pk: String,
    pub tier: String,
    pub registered_at_ms: u64,
}

pub fn registration_path() -> Result<PathBuf> {
    let base = dirs::config_dir()
        .ok_or_else(|| anyhow!("could not determine user config directory"))?;
    Ok(base.join(APP_DIR_NAME).join("registration.json"))
}

pub fn save_registration(reg: &Registration) -> Result<()> {
    let path = registration_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(reg)?;
    fs::write(path, json)?;
    Ok(())
}

pub fn load_registration() -> Result<Option<Registration>> {
    let path = registration_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(&path)?;
    // Malformed JSON → treat as "no registration" so user falls back to wizard
    match serde_json::from_str::<Registration>(&contents) {
        Ok(reg) => Ok(Some(reg)),
        Err(_) => Ok(None),
    }
}
