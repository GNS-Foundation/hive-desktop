// IP-based geolocation and H3 cell derivation.

use anyhow::{Context, Result};
use h3o::{LatLng, Resolution};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Clone)]
pub struct GeoProfile {
    pub h3_cell_r10: String,
    pub h3_cell_r7: String,
    pub h3_cell_r6: String,
    pub lat: f64,
    pub lng: f64,
    pub city: String,
    pub country: String,
}

#[derive(Debug, Deserialize)]
struct IpApiResponse {
    latitude: Option<f64>,
    longitude: Option<f64>,
    city: Option<String>,
    country_name: Option<String>,
}

pub async fn detect() -> Result<GeoProfile> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()?;

    let (lat, lng, city, country) = match client
        .get("https://ipapi.co/json/")
        .header("User-Agent", "geiant-hive-desktop/0.1")
        .send()
        .await
        .and_then(|r| r.error_for_status())
    {
        Ok(resp) => {
            let data: IpApiResponse = resp.json().await.context("ipapi response not JSON")?;
            (
                data.latitude.unwrap_or(41.8919),
                data.longitude.unwrap_or(12.5113),
                data.city.unwrap_or_else(|| "Unknown".to_string()),
                data.country_name.unwrap_or_else(|| "Unknown".to_string()),
            )
        }
        Err(_) => (
            41.8919,
            12.5113,
            "Rome (fallback)".to_string(),
            "Italy".to_string(),
        ),
    };

    let latlng = LatLng::new(lat, lng).context("invalid lat/lng")?;
    let r10 = latlng.to_cell(Resolution::Ten).to_string();
    let r7 = latlng.to_cell(Resolution::Seven).to_string();
    let r6 = latlng.to_cell(Resolution::Six).to_string();

    Ok(GeoProfile {
        h3_cell_r10: r10,
        h3_cell_r7: r7,
        h3_cell_r6: r6,
        lat,
        lng,
        city,
        country,
    })
}
