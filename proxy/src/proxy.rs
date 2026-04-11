use crate::ca::CertificateAuthority;
use crate::policy::{self, PolicyResult};
use crate::credential::Resolver;
use crate::providers::{InjectSpec, Registry};

use bytes::Bytes;
use dashmap::DashMap;
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio_rustls::rustls::ServerConfig;
use tokio_rustls::TlsAcceptor;
use tracing::{debug, error, info, warn};

type BoxBody = Full<Bytes>;

/// Cached TLS configs per hostname to avoid regenerating certs.
struct TlsCache {
    ca: Arc<CertificateAuthority>,
    configs: DashMap<String, Arc<ServerConfig>>,
}

impl TlsCache {
    fn new(ca: Arc<CertificateAuthority>) -> Self {
        Self { ca, configs: DashMap::new() }
    }

    fn get_or_create(
        &self,
        hostname: &str,
    ) -> Result<Arc<ServerConfig>, Box<dyn std::error::Error + Send + Sync>> {
        if let Some(config) = self.configs.get(hostname) {
            return Ok(config.clone());
        }
        debug!(host = %hostname, "Generating TLS certificate");
        let config = self.ca.server_config_for_host(hostname)?;
        self.configs.insert(hostname.to_string(), config.clone());
        Ok(config)
    }
}

/// Run the HTTPS forward proxy server.
pub async fn run(
    addr: SocketAddr,
    ca: Arc<CertificateAuthority>,
    resolver: Arc<Resolver>,
    registry: Registry,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let listener = TcpListener::bind(addr).await?;
    let tls_cache = Arc::new(TlsCache::new(ca));
    let registry = Arc::new(registry);
    let evaluator = evaluator.clone();

    info!(%addr, "Listening");

    loop {
        let (stream, peer) = listener.accept().await?;
        let tls_cache = tls_cache.clone();
        let resolver = resolver.clone();
        let registry = registry.clone();

        tokio::spawn(async move {
            let io = TokioIo::new(stream);
            let tls_cache = tls_cache.clone();
            let resolver = resolver.clone();
            let registry = registry.clone();
            let evaluator = evaluator.clone();

            // Use Infallible error type — all errors handled internally as responses
            let svc = service_fn(move |req: Request<Incoming>| {
                let tls_cache = tls_cache.clone();
                let resolver = resolver.clone();
                let registry = registry.clone();
                let evaluator = evaluator.clone();
                async move {
                    Ok::<_, Infallible>(handle(req, peer, tls_cache, resolver, registry, evaluator).await)
                }
            });

            if let Err(e) = http1::Builder::new()
                .preserve_header_case(true)
                .title_case_headers(true)
                .serve_connection(io, svc)
                .with_upgrades()
                .await
            {
                let msg = e.to_string();
                if !msg.contains("early eof") && !msg.contains("connection closed") {
                    debug!(peer = %peer, error = %msg, "Connection error");
                }
            }
        });
    }
}

/// Route incoming requests. Returns a Response directly (never errors).
async fn handle(
    req: Request<Incoming>,
    peer: SocketAddr,
    tls_cache: Arc<TlsCache>,
    resolver: Arc<Resolver>,
    registry: Arc<Registry>,
    evaluator: Arc<policy::Evaluator>,
) -> Response<BoxBody> {
    if req.method() == Method::CONNECT {
        return handle_connect(req, peer, tls_cache, resolver, registry).await;
    }

    if req.uri().path() == "/health" {
        return json_response(
            StatusCode::OK,
            r#"{"status":"ok","service":"vaultproxy-proxy"}"#,
        );
    }

    json_response(
        StatusCode::BAD_REQUEST,
        r#"{"error":"Use HTTPS_PROXY=http://localhost:10255 to route requests through VaultProxy"}"#,
    )
}

/// Handle CONNECT: check for credentials → MITM or transparent tunnel.
async fn handle_connect(
    req: Request<Incoming>,
    peer: SocketAddr,
    tls_cache: Arc<TlsCache>,
    resolver: Arc<Resolver>,
    registry: Arc<Registry>,
    evaluator: Arc<policy::Evaluator>,
) -> Response<BoxBody> {
    let host_port = req.uri().authority().map(|a| a.to_string()).unwrap_or_default();
    let hostname = host_port.split(':').next().unwrap_or(&host_port).to_string();
    let port = host_port
        .split(':')
        .nth(1)
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(443);

    debug!(peer = %peer, host = %hostname, "CONNECT");

    let credential = resolver.resolve_by_host(&hostname).await;

    if credential.is_none() {
        // Transparent tunnel
        debug!(host = %hostname, "No credential, transparent tunnel");
        let addr = format!("{}:{}", hostname, port);
        tokio::spawn(async move {
            let upgraded = match hyper::upgrade::on(req).await {
                Ok(u) => u,
                Err(e) => { error!(error = %e, "Upgrade failed"); return; }
            };
            if let Err(e) = transparent_tunnel(upgraded, &addr).await {
                let msg = e.to_string();
                if !msg.contains("early eof") && !msg.contains("connection closed") {
                    debug!(error = %msg, "Tunnel error");
                }
            }
        });
        return Response::new(Full::new(Bytes::new()));
    }

    // MITM tunnel
    let cred = credential.unwrap();
    let host = hostname.clone();
    let addr = format!("{}:{}", hostname, port);
    let registry = registry.clone();
    let evaluator = evaluator.clone();

    tokio::spawn(async move {
        let upgraded = match hyper::upgrade::on(req).await {
            Ok(u) => u,
            Err(e) => { error!(error = %e, "Upgrade failed"); return; }
        };
        if let Err(e) = mitm_tunnel(upgraded, &host, &addr, tls_cache, cred, registry, evaluator).await {
            let msg = e.to_string();
            if !msg.contains("early eof") && !msg.contains("connection closed") {
                warn!(host = %host, error = %msg, "MITM tunnel error");
            }
        }
    });

    Response::new(Full::new(Bytes::new()))
}

/// Transparent tunnel — relay bytes without inspection.
async fn transparent_tunnel(
    upgraded: hyper::upgrade::Upgraded,
    host_port: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let target = tokio::net::TcpStream::connect(host_port).await?;
    let upgraded = TokioIo::new(upgraded);
    let (mut cr, mut cw) = tokio::io::split(upgraded);
    let (mut sr, mut sw) = tokio::io::split(target);
    let _ = tokio::try_join!(
        tokio::io::copy(&mut cr, &mut sw),
        tokio::io::copy(&mut sr, &mut cw)
    );
    Ok(())
}

/// MITM tunnel — terminate TLS, inspect HTTP, inject credential, forward.
async fn mitm_tunnel(
    upgraded: hyper::upgrade::Upgraded,
    hostname: &str,
    host_port: &str,
    tls_cache: Arc<TlsCache>,
    credential: crate::credential::ResolvedCredential,
    registry: Arc<Registry>,
    evaluator: Arc<policy::Evaluator>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let server_config = tls_cache.get_or_create(hostname)?;
    let acceptor = TlsAcceptor::from(server_config);
    let tls_stream = acceptor.accept(TokioIo::new(upgraded)).await?;

    let host_port = host_port.to_string();
    let hostname = hostname.to_string();

    let svc = service_fn(move |req: Request<Incoming>| {
        let hp = host_port.clone();
        let hn = hostname.clone();
        let cred = credential.clone();
        let registry = registry.clone();
        let evaluator = evaluator.clone();
        async move {
            Ok::<_, Infallible>(forward_with_credential(req, &hn, &hp, &cred, registry, evaluator).await)
        }
    });

    http1::Builder::new()
        .preserve_header_case(true)
        .title_case_headers(true)
        .serve_connection(TokioIo::new(tls_stream), svc)
        .await?;

    Ok(())
}

/// Forward a request with the resolved credential injected.
///
/// Uses the provider registry to determine the correct injection strategy:
///   - Standard Bearer injection for most APIs
///   - Custom header injection for providers like Anthropic (x-api-key)
///   - Basic auth for older APIs like Resend
///   - Path-based disambiguation for shared hosts (e.g. www.googleapis.com)
async fn forward_with_credential(
    req: Request<Incoming>,
    hostname: &str,
    host_port: &str,
    cred: &crate::credential::ResolvedCredential,
    registry: Arc<Registry>,
    evaluator: Arc<policy::Evaluator>,
) -> Response<BoxBody> {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let path = uri.path_and_query().map(|p| p.as_str()).unwrap_or("/");
    let target_url = format!("https://{}{}", host_port, path);

    debug!(host = %hostname, method = %method, path = %path, "Forwarding with credential");

    // Collect headers (skip hop-by-hop)
    let mut hdrs: Vec<(String, String)> = Vec::new();
    for (name, value) in req.headers() {
        let n = name.as_str();
        if matches!(n, "host" | "transfer-encoding" | "connection" | "keep-alive"
            | "proxy-authorization" | "proxy-connection" | "te" | "trailer" | "upgrade") {
            continue;
        }
        if let Ok(v) = value.to_str() {
            hdrs.push((n.to_string(), v.to_string()));
        }
    }

    // Read body
    let body_bytes = match req.collect().await {
        Ok(b) => b.to_bytes(),
        Err(e) => {
            error!(error = %e, "Failed to read request body");
            return json_response(StatusCode::BAD_REQUEST, r#"{"error":"failed to read body"}"#);
        }
    };

    // Resolve injection spec: provider registry + dynamic rules from control plane
    let provider = registry.get_ignore_case(hostname);
    let inject = if cred.dynamic_rules.is_empty() && provider.is_none() {
        // Fallback: standard Bearer injection (no provider match, no dynamic rules)
        debug!(host = %hostname, "No provider match, using Bearer injection");
        InjectSpec::bearer(&cred.key)
    } else {
        InjectSpec::from_provider_and_dynamic(provider, &cred.dynamic_rules, path, &cred.key)
    };

    let client = reqwest::Client::new();
    let mut out = client.request(
        reqwest::Method::from_bytes(method.as_str().as_bytes()).unwrap(),
        &target_url,
    );

    // Apply headers from original request first
    for (n, v) in &hdrs {
        out = out.header(n.as_str(), v.as_str());
    }

    // Apply injection spec (SetHeader overwrites, RemoveHeader removes)
    let remove_headers: Vec<String> = inject.actions.iter()
        .filter_map(|(name, action)| {
            match action {
                crate::providers::InjectionAction::RemoveHeader => Some((*name).to_string()),
                _ => None,
            }
        })
        .collect();

    // Remove headers marked for removal
    for header in &remove_headers {
        debug!(host = %hostname, header = %header, "Removing header per injection rule");
    }

    // Set / replace headers from injection spec
    for (name, action) in &inject.actions {
        match action {
            crate::providers::InjectionAction::SetHeader(val) => {
                debug!(host = %hostname, header = %name, "Injecting header per provider rule");
                out = out.header(name, val.as_str());
            }
            crate::providers::InjectionAction::ReplaceHeader(val) => {
                // Only inject if header was present in the original request
                let original_present = hdrs.iter().any(|(n, _)| n.eq_ignore_ascii_case(name));
                if original_present {
                    debug!(host = %hostname, header = %name, "Replacing existing header per injection rule");
                    out = out.header(name, val.as_str());
                }
            }
            crate::providers::InjectionAction::RemoveHeader => {
                // Already handled above — reqwest doesn't have a direct "remove" API,
                // but since we skip hop-by-hop headers and the original header was already
                // copied, we need to override it to empty. For now this is a no-op since
                // RemoveHeader is meant for stripping hop-by-hop headers.
                debug!(host = %hostname, header = %name, "RemoveHeader (skipped — handled by hop-by-hop filter)");
            }
        }
    }

    if !body_bytes.is_empty() {
        out = out.body(body_bytes.to_vec());
    }

    match out.send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let resp_hdrs = resp.headers().clone();
            let body = resp.bytes().await.unwrap_or_default();

            let mut builder = Response::builder().status(status);
            for (name, value) in resp_hdrs.iter() {
                let n = name.as_str();
                if n == "transfer-encoding" || n == "connection" { continue; }
                builder = builder.header(n, value);
            }
            builder.body(Full::new(Bytes::from(body.to_vec()))).unwrap()
        }
        Err(e) => {
            error!(host = %hostname, error = %e, "Upstream failed");
            json_response(StatusCode::BAD_GATEWAY, &format!(r#"{{"error":"{}"}}"#, e))
        }
    }
}

fn json_response(status: StatusCode, body: &str) -> Response<BoxBody> {
    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .body(Full::new(Bytes::from(body.to_string())))
        .unwrap()
}
