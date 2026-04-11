//! Provider registry — maps hostnames to auth strategies and per-path injection rules.
//!
//! OneCLI has 25+ providers with host+path auth strategies. We follow the same pattern:
//! - Bearer tokens for most APIs (GitHub, Google Workspace, etc.)
//! - Basic auth for older providers (Resend, generic)
//! - Path-based disambiguation for shared hosts (e.g. www.googleapis.com)
//!
//! Injection types:
//!   SetHeader  — always inject this header (overwrites if present)
//!   ReplaceHeader — only inject if header is already present
//!   RemoveHeader  — remove the header entirely

use serde::Deserialize;
use std::collections::HashMap;

/// Auth strategy for a provider.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AuthStrategy {
    Bearer,
    Basic,
    None,
}

/// What to do with a header during injection.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum InjectionAction {
    /// Always inject this header value (overwrites any existing).
    SetHeader(String),
    /// Only inject if the header is already present in the request.
    ReplaceHeader(String),
    /// Remove this header from the forwarded request.
    RemoveHeader,
}

/// A path pattern with its injection rules.
/// Supports prefix matching (e.g. "/gmail/v1/").
#[derive(Clone, Debug)]
pub struct PathRule {
    /// URL path prefix to match.
    pub prefix: String,
    /// Header actions to apply when this path matches.
    pub injections: Vec<(&'static str, InjectionAction)>,
}

/// Provider metadata for a single hostname.
#[derive(Clone, Debug)]
pub struct Provider {
    /// Stable identifier, e.g. "github", "google-gmail".
    pub id: &'static str,
    /// Human-readable name.
    pub name: &'static str,
    /// Auth strategy.
    pub auth: AuthStrategy,
    /// Ordered list of path rules (first match wins).
    pub rules: Vec<PathRule>,
}

impl Provider {
    /// Returns injection rules matching the given path, or the default rule if none match.
    pub fn rules_for_path(&self, path: &str) -> &[(&'static str, InjectionAction)] {
        for rule in &self.rules {
            if path.starts_with(rule.prefix.as_str()) {
                return &rule.injections;
            }
        }
        &[]
    }
}

/// The global provider registry.
pub struct Registry {
    by_host: HashMap<&'static str, Provider>,
}

impl Registry {
    pub fn new() -> Self {
        let mut by_host = HashMap::new();
        populate(&mut by_host);
        Self { by_host }
    }

    /// Look up a provider by hostname.
    /// Returns None for unknown hosts (transparent passthrough).
    pub fn get(&self, host: &str) -> Option<&Provider> {
        self.by_host.get(host)
    }

    /// Look up a provider by hostname, with case-insensitive matching.
    pub fn get_ignore_case(&self, host: &str) -> Option<&Provider> {
        let lower = host.to_lowercase();
        // Try exact match first
        self.by_host.get(host)
            .or_else(|| self.by_host.get(lower.as_str()))
            .or_else(|| {
                // Try stripping www. prefix
                let stripped = lower.strip_prefix("www.").unwrap_or(&lower);
                self.by_host.get(stripped)
            })
    }
}

impl Default for Registry {
    fn default() -> Self { Self::new() }
}

fn populate(map: &mut HashMap<&'static str, Provider>) {
    // ─── GitHub ───────────────────────────────────────────────────────────────
    map.insert("api.github.com", Provider {
        id: "github",
        name: "GitHub",
        auth: AuthStrategy::Bearer,
        rules: vec![PathRule {
            prefix: "/".to_string(),
            injections: vec![
                ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
                ("accept", InjectionAction::SetHeader("application/vnd.github+json".to_string())),
            ],
        }],
    });

    // ─── Google Workspace ─────────────────────────────────────────────────────
    // www.googleapis.com is shared by Gmail, Calendar, Drive, Docs, Sheets,
    // Slides, Tasks, Forms, Classroom, Admin, Analytics, SearchConsole, Meet, Photos.
    // Path prefixes disambiguate each API.
    map.insert("www.googleapis.com", Provider {
        id: "google-workspace",
        name: "Google Workspace",
        auth: AuthStrategy::Bearer,
        rules: vec![
            // Gmail
            PathRule {
                prefix: "/gmail/v1/".to_string(),
                injections: vec![
                    ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
                ],
            },
            PathRule {
                prefix: "/gmail/".to_string(),
                injections: vec![
                    ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
                ],
            },
            // Google Calendar
            PathRule {
                prefix: "/calendar/v3/".to_string(),
                injections: vec![
                    ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
                ],
            },
            PathRule {
                prefix: "/calendar/".to_string(),
                injections: vec![
                    ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
                ],
            },
            // Google Drive
            PathRule {
                prefix: "/drive/v3/".to_string(),
                injections: vec![
                    ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
                ],
            },
            PathRule {
                prefix: "/upload/drive/".to_string(),
                injections: vec![
                    ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
                ],
            },
            // Google Docs
            PathRule {
                prefix: "/documents/v1/".to_string(),
                injections: vec![
                    ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
                ],
            },
            // Google Sheets
            PathRule {
                prefix: "/v4/spreadsheets/".to_string(),
                injections: vec![
                    ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
                ],
            },
            PathRule {
                prefix: "/feeds/sheets/".to_string(),
                injections: vec![
                    ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
                ],
            },
            // Google Slides
            PathRule {
                prefix: "/presentations/v1/".to_string(),
                injections: vec![
                    ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
                ],
            },
            // Google Tasks
            PathRule {
                prefix: "/tasks/v1/".to_string(),
                injections: vec![
                    ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
                ],
            },
            // Google Forms
            PathRule {
                prefix: "/forms/v1/".to_string(),
                injections: vec![
                    ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
                ],
            },
            // Google Classroom
            PathRule {
                prefix: "/classroom/v1/".to_string(),
                injections: vec![
                    ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
                ],
            },
            // Google Admin SDK
            PathRule {
                prefix: "/admin/directory/v1/".to_string(),
                injections: vec![
                    ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
                ],
            },
            PathRule {
                prefix: "/admin/reports/v1/".to_string(),
                injections: vec![
                    ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
                ],
            },
            // Google Analytics
            PathRule {
                prefix: "/analytics/v3/".to_string(),
                injections: vec![
                    ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
                ],
            },
            PathRule {
                prefix: "/analyticsdata/v1beta/".to_string(),
                injections: vec![
                    ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
                ],
            },
            // Google Search Console
            PathRule {
                prefix: "/webmasters/v3/".to_string(),
                injections: vec![
                    ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
                ],
            },
            // Google Meet / Duo
            PathRule {
                prefix: "/v1alpha/".to_string(),
                injections: vec![
                    ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
                ],
            },
            // Google Photos Library
            PathRule {
                prefix: "/v1/".to_string(),
                injections: vec![
                    ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
                ],
            },
            // Default fallback for other www.googleapis.com paths
            PathRule {
                prefix: "/".to_string(),
                injections: vec![
                    ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
                ],
            },
        ],
    });

    // OAuth token endpoint — uses Basic auth (client_id:client_secret)
    map.insert("oauth2.googleapis.com", Provider {
        id: "google-oauth",
        name: "Google OAuth",
        auth: AuthStrategy::Basic,
        rules: vec![PathRule {
            prefix: "/".to_string(),
            injections: vec![
                // No authorization header injection — Basic is for the token endpoint
            ],
        }],
    });

    // ─── Anthropic ─────────────────────────────────────────────────────────────
    map.insert("api.anthropic.com", Provider {
        id: "anthropic",
        name: "Anthropic",
        auth: AuthStrategy::Bearer,
        rules: vec![PathRule {
            prefix: "/".to_string(),
            injections: vec![
                ("x-api-key", InjectionAction::SetHeader("{token}".to_string())),
                ("anthropic-version", InjectionAction::SetHeader("2023-06-01".to_string())),
            ],
        }],
    });

    // ─── OpenAI / Azure OpenAI ─────────────────────────────────────────────────
    map.insert("api.openai.com", Provider {
        id: "openai",
        name: "OpenAI",
        auth: AuthStrategy::Bearer,
        rules: vec![PathRule {
            prefix: "/".to_string(),
            injections: vec![
                ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
            ],
        }],
    });

    // Azure OpenAI — uses API key in a header, not Bearer
    map.insert("{your-resource-name}.openai.azure.com", Provider {
        id: "azure-openai",
        name: "Azure OpenAI",
        auth: AuthStrategy::None,
        rules: vec![PathRule {
            prefix: "/".to_string(),
            injections: vec![
                ("api-key", InjectionAction::SetHeader("{token}".to_string())),
            ],
        }],
    });

    // ─── Resend ────────────────────────────────────────────────────────────────
    map.insert("api.resend.com", Provider {
        id: "resend",
        name: "Resend",
        auth: AuthStrategy::Basic,
        rules: vec![PathRule {
            prefix: "/".to_string(),
            injections: vec![
                ("authorization", InjectionAction::SetHeader("Basic {token}".to_string())),
            ],
        }],
    });

    // ─── Stripe ───────────────────────────────────────────────────────────────
    map.insert("api.stripe.com", Provider {
        id: "stripe",
        name: "Stripe",
        auth: AuthStrategy::Bearer,
        rules: vec![PathRule {
            prefix: "/".to_string(),
            injections: vec![
                ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
            ],
        }],
    });

    // ─── Twilio ────────────────────────────────────────────────────────────────
    map.insert("api.twilio.com", Provider {
        id: "twilio",
        name: "Twilio",
        auth: AuthStrategy::Basic,
        rules: vec![PathRule {
            prefix: "/".to_string(),
            injections: vec![
                ("authorization", InjectionAction::SetHeader("Basic {token}".to_string())),
            ],
        }],
    });

    // ─── Slack ────────────────────────────────────────────────────────────────
    map.insert("slack.com", Provider {
        id: "slack",
        name: "Slack",
        auth: AuthStrategy::Bearer,
        rules: vec![PathRule {
            prefix: "/api/".to_string(),
            injections: vec![
                ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
            ],
        }],
    });
    map.insert("api.slack.com", Provider {
        id: "slack",
        name: "Slack",
        auth: AuthStrategy::Bearer,
        rules: vec![PathRule {
            prefix: "/".to_string(),
            injections: vec![
                ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
            ],
        }],
    });

    // ─── Vercel ───────────────────────────────────────────────────────────────
    map.insert("api.vercel.com", Provider {
        id: "vercel",
        name: "Vercel",
        auth: AuthStrategy::Bearer,
        rules: vec![PathRule {
            prefix: "/".to_string(),
            injections: vec![
                ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
            ],
        }],
    });

    // ─── Railway ───────────────────────────────────────────────────────────────
    map.insert("backboard.railway.app", Provider {
        id: "railway",
        name: "Railway",
        auth: AuthStrategy::Bearer,
        rules: vec![PathRule {
            prefix: "/".to_string(),
            injections: vec![
                ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
            ],
        }],
    });

    // ─── Render ───────────────────────────────────────────────────────────────
    map.insert("api.render.com", Provider {
        id: "render",
        name: "Render",
        auth: AuthStrategy::Bearer,
        rules: vec![PathRule {
            prefix: "/".to_string(),
            injections: vec![
                ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
            ],
        }],
    });

    // ─── Netlify ───────────────────────────────────────────────────────────────
    map.insert("api.netlify.com", Provider {
        id: "netlify",
        name: "Netlify",
        auth: AuthStrategy::Bearer,
        rules: vec![PathRule {
            prefix: "/".to_string(),
            injections: vec![
                ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
            ],
        }],
    });

    // ─── Fly.io ────────────────────────────────────────────────────────────────
    map.insert("api.fly.io", Provider {
        id: "fly",
        name: "Fly.io",
        auth: AuthStrategy::Bearer,
        rules: vec![PathRule {
            prefix: "/".to_string(),
            injections: vec![
                ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
            ],
        }],
    });

    // ─── AWS ───────────────────────────────────────────────────────────────────
    map.insert("iam.amazonaws.com", Provider {
        id: "aws-iam",
        name: "AWS IAM",
        auth: AuthStrategy::Bearer,
        rules: vec![PathRule {
            prefix: "/".to_string(),
            injections: vec![
                ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
            ],
        }],
    });
    map.insert("s3.amazonaws.com", Provider {
        id: "aws-s3",
        name: "AWS S3",
        auth: AuthStrategy::Bearer,
        rules: vec![PathRule {
            prefix: "/".to_string(),
            injections: vec![
                ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
            ],
        }],
    });

    // ─── Datadog ───────────────────────────────────────────────────────────────
    map.insert("api.datadoghq.com", Provider {
        id: "datadog",
        name: "Datadog",
        auth: AuthStrategy::Bearer,
        rules: vec![PathRule {
            prefix: "/".to_string(),
            injections: vec![
                ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
                ("dd-api-key", InjectionAction::SetHeader("{token}".to_string())),
            ],
        }],
    });

    // ─── Cloudflare ─────────────────────────────────────────────────────────────
    map.insert("api.cloudflare.com", Provider {
        id: "cloudflare",
        name: "Cloudflare",
        auth: AuthStrategy::Bearer,
        rules: vec![PathRule {
            prefix: "/".to_string(),
            injections: vec![
                ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
            ],
        }],
    });

    // ─── GitLab ────────────────────────────────────────────────────────────────
    map.insert("gitlab.com", Provider {
        id: "gitlab",
        name: "GitLab",
        auth: AuthStrategy::Bearer,
        rules: vec![PathRule {
            prefix: "/api/v4/".to_string(),
            injections: vec![
                ("PRIVATE-TOKEN", InjectionAction::SetHeader("{token}".to_string())),
            ],
        }],
    });
    map.insert("api.gitlab.com", Provider {
        id: "gitlab",
        name: "GitLab",
        auth: AuthStrategy::Bearer,
        rules: vec![PathRule {
            prefix: "/".to_string(),
            injections: vec![
                ("PRIVATE-TOKEN", InjectionAction::SetHeader("{token}".to_string())),
            ],
        }],
    });

    // ─── Linear ────────────────────────────────────────────────────────────────
    map.insert("api.linear.app", Provider {
        id: "linear",
        name: "Linear",
        auth: AuthStrategy::Bearer,
        rules: vec![PathRule {
            prefix: "/".to_string(),
            injections: vec![
                ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
            ],
        }],
    });

    // ─── Notion ───────────────────────────────────────────────────────────────
    map.insert("api.notion.com", Provider {
        id: "notion",
        name: "Notion",
        auth: AuthStrategy::Bearer,
        rules: vec![PathRule {
            prefix: "/v1/".to_string(),
            injections: vec![
                ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
                ("notion-version", InjectionAction::SetHeader("2022-06-28".to_string())),
            ],
        }],
    });

    // ─── SendGrid ──────────────────────────────────────────────────────────────
    map.insert("api.sendgrid.com", Provider {
        id: "sendgrid",
        name: "SendGrid",
        auth: AuthStrategy::Bearer,
        rules: vec![PathRule {
            prefix: "/".to_string(),
            injections: vec![
                ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
            ],
        }],
    });

    // ─── Supabase ──────────────────────────────────────────────────────────────
    map.insert("supabase.com", Provider {
        id: "supabase",
        name: "Supabase",
        auth: AuthStrategy::Bearer,
        rules: vec![PathRule {
            prefix: "/rest/v1/".to_string(),
            injections: vec![
                ("apikey", InjectionAction::SetHeader("{token}".to_string())),
                ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
            ],
        }],
    });
    map.insert("db.supabase.co", Provider {
        id: "supabase-pg",
        name: "Supabase Postgres",
        auth: AuthStrategy::None,
        rules: vec![PathRule {
            prefix: "/".to_string(),
            injections: vec![
                ("apikey", InjectionAction::SetHeader("{token}".to_string())),
            ],
        }],
    });

    // ─── Firebase ─────────────────────────────────────────────────────────────
    map.insert("firebase.googleapis.com", Provider {
        id: "firebase",
        name: "Firebase",
        auth: AuthStrategy::Bearer,
        rules: vec![PathRule {
            prefix: "/".to_string(),
            injections: vec![
                ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
            ],
        }],
    });

    // ─── HubSpot ──────────────────────────────────────────────────────────────
    map.insert("api.hubapi.com", Provider {
        id: "hubspot",
        name: "HubSpot",
        auth: AuthStrategy::Bearer,
        rules: vec![PathRule {
            prefix: "/".to_string(),
            injections: vec![
                ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
            ],
        }],
    });

    // ─── Shopify ───────────────────────────────────────────────────────────────
    map.insert("{shop}.myshopify.com", Provider {
        id: "shopify",
        name: "Shopify",
        auth: AuthStrategy::Bearer,
        rules: vec![PathRule {
            prefix: "/admin/api/".to_string(),
            injections: vec![
                ("X-Shopify-Access-Token", InjectionAction::SetHeader("{token}".to_string())),
            ],
        }],
    });

    // ─── PagerDuty ────────────────────────────────────────────────────────────
    map.insert("api.pagerduty.com", Provider {
        id: "pagerduty",
        name: "PagerDuty",
        auth: AuthStrategy::Bearer,
        rules: vec![PathRule {
            prefix: "/".to_string(),
            injections: vec![
                ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
            ],
        }],
    });

    // ─── Intercom ─────────────────────────────────────────────────────────────
    map.insert("api.intercom.io", Provider {
        id: "intercom",
        name: "Intercom",
        auth: AuthStrategy::Bearer,
        rules: vec![PathRule {
            prefix: "/".to_string(),
            injections: vec![
                ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
                ("accept", InjectionAction::SetHeader("application/json".to_string())),
            ],
        }],
    });

    // ─── Zoom ─────────────────────────────────────────────────────────────────
    map.insert("api.zoom.us", Provider {
        id: "zoom",
        name: "Zoom",
        auth: AuthStrategy::Bearer,
        rules: vec![PathRule {
            prefix: "/v2/".to_string(),
            injections: vec![
                ("authorization", InjectionAction::SetHeader("Bearer {token}".to_string())),
            ],
        }],
    });
}

/// Injection rules returned to the proxy from the control plane.
/// These override or augment the static provider registry.
#[derive(Clone, Debug, Deserialize)]
pub struct DynamicRule {
    /// URL path prefix to match.
    pub path_prefix: String,
    /// Header name to inject.
    pub header: String,
    /// Header value. Use "{token}" as a placeholder for the credential.
    pub value: String,
}

/// InjectSpec is the resolved set of injection rules for a request.
#[derive(Clone, Default)]
pub struct InjectSpec {
    /// Header name → value to set/replace/remove.
    pub actions: Vec<(&'static str, InjectionAction)>,
}

impl InjectSpec {
    /// Build from a static provider + dynamic rules from the control plane.
    pub fn from_provider_and_dynamic(
        provider: Option<&Provider>,
        dynamic_rules: &[DynamicRule],
        path: &str,
        token: &str,
    ) -> Self {
        let mut actions: Vec<(&'static str, InjectionAction)> = Vec::new();

        // Apply provider rules first
        if let Some(p) = provider {
            for (header, action) in p.rules_for_path(path) {
                let resolved = resolve_action(action, token);
                actions.push((header, resolved));
            }
        }

        // Dynamic rules override provider rules (append to end)
        for rule in dynamic_rules {
            if path.starts_with(&rule.path_prefix) {
                let value = rule.value.replace("{token}", token);
                actions.push((Box::leak(rule.header.into_boxed_str()) as &str, InjectionAction::SetHeader(value)));
            }
        }

        Self { actions }
    }

    /// Build a default spec with the standard Bearer injection.
    pub fn bearer(token: &str) -> Self {
        Self {
            actions: vec![(
                "authorization",
                InjectionAction::SetHeader(format!("Bearer {}", token)),
            )],
        }
    }
}

fn resolve_action(action: &InjectionAction, token: &str) -> InjectionAction {
    match action {
        InjectionAction::SetHeader(v) => {
            InjectionAction::SetHeader(v.replace("{token}", token))
        }
        InjectionAction::ReplaceHeader(v) => {
            InjectionAction::ReplaceHeader(v.replace("{token}", token))
        }
        InjectionAction::RemoveHeader => InjectionAction::RemoveHeader,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_google_gmail_path() {
        let reg = Registry::new();
        let p = reg.get("www.googleapis.com").unwrap();
        let injections = p.rules_for_path("/gmail/v1/users/me/messages");
        assert!(!injections.is_empty());
    }

    #[test]
    fn test_github_api() {
        let reg = Registry::new();
        let p = reg.get("api.github.com").unwrap();
        assert_eq!(p.id, "github");
        let injections = p.rules_for_path("/repos/owner/repo");
        assert!(!injections.is_empty());
    }

    #[test]
    fn test_anthropic_custom_header() {
        let reg = Registry::new();
        let p = reg.get("api.anthropic.com").unwrap();
        let injections = p.rules_for_path("/v1/messages");
        assert!(injections.iter().any(|(h, _)| *h == "x-api-key"));
    }

    #[test]
    fn test_unknown_host() {
        let reg = Registry::new();
        assert!(reg.get("random-api.example.com").is_none());
    }
}
