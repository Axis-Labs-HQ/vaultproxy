use dashmap::DashMap;
use serde::Deserialize;
use std::time::{Duration, Instant};
use tracing::{debug, warn};

const RESOLVE_TIMEOUT_MS: u64 = 5000;
const CACHE_TTL_SECS: u64 = 30;
const MAX_STALE_SECS: u64 = 60;

#[derive(Clone, Debug)]
pub struct ResolvedCredential {
    pub key: String,
    pub auth_header: String,
    resolved_at: Instant,
}

#[derive(Deserialize)]
struct ResolveResponse {
    key: String,
    #[serde(default)]
    target_url: Option<String>,
}

/// Resolves hostnames to credentials via the control plane's resolve-by-host endpoint.
pub struct Resolver {
    control_plane_url: String,
    proxy_token: String,
    client: reqwest::Client,
    cache: DashMap<String, ResolvedCredential>,
}

impl Resolver {
    pub fn new(control_plane_url: String, proxy_token: String) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(RESOLVE_TIMEOUT_MS))
            .build()
            .expect("failed to build HTTP client");

        Self {
            control_plane_url,
            proxy_token,
            client,
            cache: DashMap::new(),
        }
    }

    /// Resolve a hostname to a credential. Returns None if no key is configured
    /// for this host (the proxy should pass through transparently).
    pub async fn resolve_by_host(&self, hostname: &str) -> Option<ResolvedCredential> {
        // Check cache first
        if let Some(cached) = self.cache.get(hostname) {
            if cached.resolved_at.elapsed() < Duration::from_secs(CACHE_TTL_SECS) {
                debug!(host = %hostname, "Cache hit");
                return Some(cached.clone());
            }
        }

        // Call control plane
        let url = format!(
            "{}/internal/resolve-by-host/{}",
            self.control_plane_url,
            urlencoding::encode(hostname)
        );

        match self.client
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.proxy_token))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                match resp.json::<ResolveResponse>().await {
                    Ok(data) => {
                        let cred = ResolvedCredential {
                            key: data.key,
                            auth_header: "Authorization".to_string(),
                            resolved_at: Instant::now(),
                        };
                        self.cache.insert(hostname.to_string(), cred.clone());
                        debug!(host = %hostname, "Resolved from control plane");
                        Some(cred)
                    }
                    Err(e) => {
                        warn!(host = %hostname, error = %e, "Failed to parse resolve response");
                        self.stale_fallback(hostname)
                    }
                }
            }
            Ok(resp) if resp.status().as_u16() == 404 => {
                // No credential for this host — transparent pass-through
                debug!(host = %hostname, "No credential configured");
                None
            }
            Ok(resp) => {
                warn!(host = %hostname, status = %resp.status(), "Control plane error");
                self.stale_fallback(hostname)
            }
            Err(e) => {
                warn!(host = %hostname, error = %e, "Control plane unreachable");
                self.stale_fallback(hostname)
            }
        }
    }

    fn stale_fallback(&self, hostname: &str) -> Option<ResolvedCredential> {
        if let Some(cached) = self.cache.get(hostname) {
            if cached.resolved_at.elapsed() < Duration::from_secs(MAX_STALE_SECS) {
                return Some(cached.clone());
            }
        }
        None
    }
}
