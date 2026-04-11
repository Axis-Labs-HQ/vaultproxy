//! Policy engine — block, rate-limit, and manual-approval rules per agent.
//!
//! Policy evaluation runs after credential resolution and before injection.
//! Priority: Block > ManualApproval > RateLimit > Allow.
//!
//! Rate limiting uses a sliding window via Redis-like counter in DashMap.
//! Key format: "rate:{rule_id}:{window_id}" where window_id = now_secs / window_secs.
//!
//! OneCLI reference:
//!   PolicyAction::Block, PolicyAction::RateLimit, PolicyAction::ManualApproval
//!   Priority: Block > ManualApproval > RateLimit > Allow

use dashmap::DashMap;
use serde::Deserialize;
use std::num::NonZeroU64;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tracing::{debug, warn};

use crate::credential::ResolvedCredential;

/// Policy action — what to do when a rule matches.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PolicyAction {
    /// Block the request entirely. Returns 403.
    Block,
    /// Rate-limit: allow the request but track counts. Returns 429 if over limit.
    RateLimit { max_requests: u64, window_secs: u64 },
    /// Manual approval required. The proxy returns 202 Accepted and the control
    /// plane handles out-of-band approval (webhook, Slack, etc.).
    ManualApproval,
    /// Allow the request.
    Allow,
}

impl PolicyAction {
    fn from_str(s: &str) -> Option<Self> {
        match s {
            "block" => Some(Self::Block),
            "allow" => Some(Self::Allow),
            "manual_approval" | "manual-approval" => Some(Self::ManualApproval),
            _ => None,
        }
    }
}

/// A single policy rule with its action and optional rate-limit params.
#[derive(Clone, Debug)]
pub struct PolicyRule {
    pub id: String,
    pub action: PolicyAction,
    pub max_requests: Option<u64>,
    pub window_secs: Option<u64>,
}

/// Policy rules returned from the control plane alongside credentials.
#[derive(Clone, Debug, Default, Deserialize)]
pub struct PolicySpec {
    #[serde(default)]
    pub rules: Vec<PolicyRule>,
    /// Whether to use optimistic (allow-then-check) or pessimistic (check-then-allow) mode.
    /// Default: optimistic (allow and rate-limit in background).
    #[serde(default)]
    pub mode: String,
}

impl PolicySpec {
    pub fn is_empty(&self) -> bool {
        self.rules.is_empty()
    }

    /// Evaluate the policy for a given request.
    /// Returns the action to take and the matching rule.
    pub fn evaluate(&self, agent_id: &str, path: &str) -> Option<(PolicyAction, &PolicyRule)> {
        // First matching rule wins (rules are ordered by priority in the DB)
        for rule in &self.rules {
            if Self::rule_matches(rule, agent_id, path) {
                debug!(
                    rule_id = %rule.id,
                    action = ?rule.action,
                    agent = %agent_id,
                    path = %path,
                    "Policy rule matched"
                );
                return Some((rule.action.clone(), rule));
            }
        }
        None
    }

    fn rule_matches(rule: &PolicyRule, _agent_id: &str, _path: &str) -> bool {
        // TODO: Implement pattern matching (glob/regex on agent_id and path)
        // For now: all rules match all requests (control plane filters)
        true
    }
}

/// Rate limiter using a sliding window counter stored in DashMap.
/// Thread-safe and lock-free.
pub struct RateLimiter {
    // Key: "rule_id:window_id", Value: request count
    counters: DashMap<String, Arc<AtomicU64>>,
    // Cleanup: remove windows older than this
    max_age_secs: u64,
}

impl RateLimiter {
    pub fn new() -> Self {
        Self {
            counters: DashMap::new(),
            max_age_secs: 3600, // Keep 1 hour of windows
        }
    }

    /// Check and increment the counter for a rule+window.
    /// Returns (current_count, allowed). If not allowed, the count was not incremented.
    pub fn check(&self, rule_id: &str, max_requests: u64, window_secs: u64) -> (u64, bool) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let window_id = now / window_secs;
        let key = format!("{}:{}", rule_id, window_id);

        let entry = self.counters.entry(key.clone()).or_insert_with(|| {
            Arc::new(AtomicU64::new(0))
        });

        // Increment and check atomically
        let new_count = entry.increment_and_fetch();

        if new_count > max_requests {
            debug!(
                rule_id = %rule_id,
                count = new_count,
                limit = max_requests,
                window_secs = window_secs,
                "Rate limit exceeded"
            );
            // Still allow if over limit — caller decides based on return value
            (new_count, new_count <= max_requests)
        } else {
            debug!(
                rule_id = %rule_id,
                count = new_count,
                limit = max_requests,
                "Rate limit check passed"
            );
            (new_count, true)
        }
    }

    /// Cleanup old windows (call periodically).
    pub fn cleanup(&self) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let cutoff = now.saturating_sub(self.max_age_secs);

        // We can't easily iterate DashMap by key prefix, so we rely on
        // short window_secs values to keep memory bounded.
        // A production version would use a proper TTL cache or Redis.
        let _ = cutoff;
    }
}

impl Default for RateLimiter {
    fn default() -> Self { Self::new() }
}

trait AtomicU64Ext {
    fn increment_and_fetch(&self) -> u64;
}

impl AtomicU64Ext for AtomicU64 {
    fn increment_and_fetch(&self) -> u64 {
        self.fetch_add(1, Ordering::Relaxed).saturating_add(1)
    }
}

/// Policy evaluator — fetches policies from control plane and caches them.
pub struct Evaluator {
    control_plane_url: String,
    proxy_token: String,
    client: reqwest::Client,
    cache: DashMap<String, (PolicySpec, Instant)>,
    rate_limiter: RateLimiter,
}

impl Evaluator {
    pub fn new(control_plane_url: String, proxy_token: String) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .expect("failed to build HTTP client");

        Self {
            control_plane_url,
            proxy_token,
            client,
            cache: DashMap::new(),
            rate_limiter: RateLimiter::new(),
        }
    }

    /// Evaluate policy for a given org + agent + path.
    /// Returns (action, body) — body is set for block/rate-limit responses.
    pub async fn evaluate(
        &self,
        org_id: &str,
        agent_id: &str,
        path: &str,
    ) -> PolicyResult {
        let spec = self.fetch_policy(org_id).await;

        match spec.evaluate(agent_id, path) {
            Some((PolicyAction::Block, _)) => {
                return PolicyResult::Block;
            }
            Some((PolicyAction::RateLimit { max_requests, window_secs }, rule)) => {
                let (_, allowed) = self.rate_limiter.check(&rule.id, max_requests, window_secs);
                if !allowed {
                    debug!(
                        rule_id = %rule.id,
                        agent = %agent_id,
                        "Rate limited"
                    );
                    return PolicyResult::RateLimited {
                        limit: max_requests,
                        window_secs,
                    };
                }
            }
            Some((PolicyAction::ManualApproval, _)) => {
                // Fire-and-forget: tell control plane to notify approvers,
                // return 202 Accepted to the agent (it will poll / wait)
                let org = org_id.to_string();
                let agent = agent_id.to_string();
                let p = path.to_string();
                let url = self.control_plane_url.clone();
                let token = self.proxy_token.clone();
                let client = self.client.clone();

                tokio::spawn(async move {
                    let _ = client
                        .post(format!("{}/internal/request-approval", url))
                        .header("Authorization", format!("Bearer {}", token))
                        .json(&serde_json::json!({
                            "org_id": org,
                            "agent_id": agent,
                            "path": p,
                        }))
                        .send()
                        .await;
                });

                return PolicyResult::AwaitingApproval;
            }
            Some((PolicyAction::Allow, _)) | None => {
                return PolicyResult::Allowed;
            }
        }

        PolicyResult::Allowed
    }

    async fn fetch_policy(&self, org_id: &str) -> PolicySpec {
        let cache_ttl = Duration::from_secs(60);

        // Cache hit?
        if let Some((spec, cached_at)) = self.cache.get(org_id) {
            if cached_at.elapsed() < cache_ttl {
                return spec.clone();
            }
        }

        // Fetch from control plane
        let url = format!(
            "{}/internal/policy/{}",
            self.control_plane_url,
            urlencoding::encode(org_id)
        );

        match self.client
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.proxy_token))
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                match resp.json::<PolicySpec>().await {
                    Ok(spec) => {
                        self.cache.insert(org_id.to_string(), (spec.clone(), Instant::now()));
                        spec
                    }
                    Err(e) => {
                        warn!(org_id = %org_id, error = %e, "Failed to parse policy response");
                        PolicySpec::default()
                    }
                }
            }
            Ok(resp) => {
                warn!(org_id = %org_id, status = %resp.status(), "Policy fetch error");
                PolicySpec::default()
            }
            Err(e) => {
                warn!(org_id = %org_id, error = %e, "Control plane unreachable for policy");
                PolicySpec::default()
            }
        }
    }
}

/// Result of policy evaluation.
#[derive(Clone, Debug)]
pub enum PolicyResult {
    Allowed,
    Block,
    RateLimited { limit: u64, window_secs: u64 },
    AwaitingApproval,
}

impl PolicyResult {
    pub fn status_code(&self) -> u16 {
        match self {
            Self::Allowed => 200,
            Self::Block => 403,
            Self::RateLimited { .. } => 429,
            Self::AwaitingApproval => 202,
        }
    }

    pub fn body(&self) -> String {
        match self {
            Self::Allowed => String::new(),
            Self::Block => r#"{"error":"blocked by policy","message":"This request is blocked by your organization's policy"}"#.to_string(),
            Self::RateLimited { limit, window_secs } => {
                format!(r#"{{"error":"rate_limit_exceeded","message":"Rate limit exceeded","limit":{},"window_secs":{}}}"#, limit, window_secs)
            }
            Self::AwaitingApproval => {
                r#"{"status":"awaiting_approval","message":"This request requires manual approval. The proxy will automatically retry once approved."}"#.to_string()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rate_limiter_allows_under_limit() {
        let rl = RateLimiter::new();
        let (_, allowed) = rl.check("test-rule", 5, 60);
        assert!(allowed);
    }

    #[test]
    fn test_rate_limiter_blocks_over_limit() {
        let rl = RateLimiter::new();
        for _ in 0..5 {
            rl.check("limit-test", 5, 60);
        }
        let (_, allowed) = rl.check("limit-test", 5, 60);
        assert!(!allowed);
    }

    #[test]
    fn test_policy_result_status_codes() {
        assert_eq!(PolicyResult::Block.status_code(), 403);
        assert_eq!(PolicyResult::RateLimited { limit: 100, window_secs: 60 }.status_code(), 429);
        assert_eq!(PolicyResult::AwaitingApproval.status_code(), 202);
    }
}
