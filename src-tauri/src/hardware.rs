// Hardware detection. Returns a payload matching the backend's
// register_worker endpoint expectations.

use anyhow::Result;
use serde::Serialize;
use std::process::Command;
use sysinfo::System;

#[derive(Debug, Serialize, Clone)]
pub struct HardwareProfile {
    pub platform: &'static str,
    pub gpu: &'static str,
    pub gpu_name: Option<String>,
    pub gpu_vram_mb: u64,
    pub mem_bandwidth_gbs: f64,
    pub ram_total_mb: u64,
    pub ram_available_mb: u64,
    pub cpu_cores: usize,
    pub cpu_model: String,
    pub hostname: Option<String>,
}

pub fn detect() -> Result<HardwareProfile> {
    let mut sys = System::new_all();
    sys.refresh_all();

    let platform = current_platform();
    let cpu_cores = sys.cpus().len();
    let cpu_model = sys
        .cpus()
        .first()
        .map(|c| c.brand().to_string())
        .unwrap_or_else(|| "Unknown".to_string());
    let ram_total_mb = sys.total_memory() / 1_048_576;
    let ram_available_mb = sys.available_memory() / 1_048_576;
    let hostname = System::host_name();

    let (gpu_name, gpu_enum, gpu_vram_mb) = detect_gpu(platform);
    let mem_bandwidth_gbs = estimate_mem_bandwidth(&cpu_model, platform, gpu_name.as_deref());

    Ok(HardwareProfile {
        platform,
        gpu: gpu_enum,
        gpu_name,
        gpu_vram_mb,
        mem_bandwidth_gbs,
        ram_total_mb,
        ram_available_mb,
        cpu_cores,
        cpu_model,
        hostname,
    })
}

fn current_platform() -> &'static str {
    match std::env::consts::OS {
        "macos" => "macos",
        "linux" => "linux",
        "windows" => "windows",
        _ => "linux",
    }
}

fn detect_gpu(platform: &str) -> (Option<String>, &'static str, u64) {
    match platform {
        "macos" => detect_gpu_macos(),
        "linux" => detect_gpu_linux(),
        "windows" => detect_gpu_windows(),
        _ => (None, "none", 0),
    }
}

fn detect_gpu_macos() -> (Option<String>, &'static str, u64) {
    let output = Command::new("system_profiler")
        .arg("SPDisplaysDataType")
        .output();
    if let Ok(out) = output {
        if let Ok(text) = String::from_utf8(out.stdout) {
            let mut chipset: Option<String> = None;
            let mut vram_mb: u64 = 0;
            for line in text.lines() {
                let trimmed = line.trim();
                if let Some(rest) = trimmed.strip_prefix("Chipset Model:") {
                    chipset = Some(rest.trim().to_string());
                } else if let Some(rest) = trimmed.strip_prefix("VRAM (Total):") {
                    let parts: Vec<&str> = rest.trim().split_whitespace().collect();
                    if parts.len() >= 2 {
                        if let Ok(n) = parts[0].parse::<u64>() {
                            vram_mb = match parts[1].to_lowercase().as_str() {
                                "gb" => n * 1024,
                                "mb" => n,
                                _ => n,
                            };
                        }
                    }
                }
            }
            return (chipset, "metal", vram_mb);
        }
    }
    (None, "metal", 0)
}

fn detect_gpu_linux() -> (Option<String>, &'static str, u64) {
    let output = Command::new("nvidia-smi")
        .args(["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"])
        .output();
    if let Ok(out) = output {
        if out.status.success() {
            if let Ok(text) = String::from_utf8(out.stdout) {
                let first_line = text.lines().next().unwrap_or("").trim();
                let parts: Vec<&str> = first_line.split(',').collect();
                if parts.len() == 2 {
                    let name = parts[0].trim().to_string();
                    let vram: u64 = parts[1].trim().parse().unwrap_or(0);
                    return (Some(name), "cuda", vram);
                }
            }
        }
    }
    let output = Command::new("rocm-smi").arg("--showproductname").output();
    if let Ok(out) = output {
        if out.status.success() {
            if let Ok(text) = String::from_utf8(out.stdout) {
                for line in text.lines() {
                    if line.contains("Card series:") || line.contains("Card model:") {
                        let name = line.split(':').nth(1).map(|s| s.trim().to_string());
                        return (name, "rocm", 0);
                    }
                }
            }
        }
    }
    let output = Command::new("lspci").output();
    if let Ok(out) = output {
        if let Ok(text) = String::from_utf8(out.stdout) {
            for line in text.lines() {
                let lower = line.to_lowercase();
                if lower.contains("vga") || lower.contains("3d controller") {
                    let name = line.splitn(2, ':').nth(1).map(|s| s.trim().to_string());
                    return (name, "vulkan", 0);
                }
            }
        }
    }
    (None, "none", 0)
}

fn detect_gpu_windows() -> (Option<String>, &'static str, u64) {
    let output = Command::new("powershell")
        .args([
            "-Command",
            "(Get-CimInstance Win32_VideoController).Name; (Get-CimInstance Win32_VideoController).AdapterRAM",
        ])
        .output();
    if let Ok(out) = output {
        if let Ok(text) = String::from_utf8(out.stdout) {
            let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
            if !lines.is_empty() {
                let name = lines[0].trim().to_string();
                let mut vram_mb = 0u64;
                if lines.len() >= 2 {
                    if let Ok(ram_bytes) = lines[1].trim().parse::<u64>() {
                        vram_mb = ram_bytes / 1_048_576;
                    }
                }
                let gpu_enum = if name.to_lowercase().contains("nvidia") {
                    "cuda"
                } else if name.to_lowercase().contains("amd")
                    || name.to_lowercase().contains("radeon")
                {
                    "rocm"
                } else {
                    "vulkan"
                };
                return (Some(name), gpu_enum, vram_mb);
            }
        }
    }
    (None, "none", 0)
}

/// Rough memory bandwidth estimates (GB/s).
fn estimate_mem_bandwidth(_cpu_model: &str, platform: &str, gpu_name: Option<&str>) -> f64 {
    if let Some(name) = gpu_name {
        if name.contains("M4 Max") { return 546.0; }
        if name.contains("M4 Pro") { return 273.0; }
        if name.contains("M4") { return 120.0; }
        if name.contains("M3 Max") { return 400.0; }
        if name.contains("M3 Pro") { return 150.0; }
        if name.contains("M3") { return 100.0; }
        if name.contains("M2 Max") { return 400.0; }
        if name.contains("M2 Pro") { return 200.0; }
        if name.contains("M2") { return 100.0; }
        if name.contains("M1 Max") { return 400.0; }
        if name.contains("M1 Pro") { return 200.0; }
        if name.contains("M1") { return 68.0; }
        if name.contains("4090") { return 1008.0; }
        if name.contains("4080") { return 717.0; }
        if name.contains("4070") { return 504.0; }
        if name.contains("3090") { return 936.0; }
        if name.contains("3080") { return 760.0; }
        if name.contains("A100") { return 1555.0; }
        if name.contains("H100") { return 3350.0; }
    }
    match platform {
        "macos" => 100.0,
        _ => 50.0,
    }
}
