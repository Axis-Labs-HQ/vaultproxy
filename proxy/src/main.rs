mod ca;
mod credential;
mod proxy;
mod policy;
mod providers;

// Re-export so other modules can use types like DynamicRule as crate::providers::DynamicRule
pub use providers::{DynamicRule, InjectSpec, InjectionAction, Provider, Registry};

use clap::Parser;
use std::net::SocketAddr;
use std::sync::Arc;
use tracing::{error, info};

#[derive(Parser)]
#[command(name = "vaultproxy-proxy", about = "HTTPS forward proxy with credential injection")]
struct Cli {
    /// Port to listen on
    #[arg(short, long, default_value = "10255", env = "PORT")]
    port: u16,

    /// Control plane URL for credential resolution
    #[arg(long, default_value = "http://localhost:8080", env = "CONTROL_PLANE_URL")]
    control_plane_url: String,

    /// Proxy token for authenticating to the control plane
    #[arg(long, env = "PROXY_TOKEN")]
    proxy_token: String,

    /// Directory for CA certificate storage (auto-generated if missing)
    #[arg(long, default_value_t = default_ca_dir(), env = "VP_CA_DIR")]
    ca_dir: String,
}

fn default_ca_dir() -> String {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    format!("{}/.vaultproxy/ca", home)
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "vaultproxy_proxy=info".parse().unwrap()),
        )
        .init();

    let cli = Cli::parse();

    let ca = match ca::CertificateAuthority::load_or_create(&cli.ca_dir) {
        Ok(ca) => {
            info!(path = %cli.ca_dir, "CA certificate ready");
            Arc::new(ca)
        }
        Err(e) => {
            error!(error = %e, "Failed to initialize CA");
            std::process::exit(1);
        }
    };

    let resolver = Arc::new(credential::Resolver::new(
        cli.control_plane_url.clone(),
        cli.proxy_token.clone(),
    ));

    let registry = providers::Registry::new();
    let evaluator = Arc::new(policy::Evaluator::new(
        cli.control_plane_url.clone(),
        cli.proxy_token.clone(),
    ));

    let addr = SocketAddr::from(([0, 0, 0, 0], cli.port));
    info!(%addr, control_plane = %cli.control_plane_url, "VaultProxy HTTPS proxy starting");
    info!("Trust the CA cert: {}/ca.crt", cli.ca_dir);

    if let Err(e) = proxy::run(addr, ca, resolver, registry, evaluator).await {
        error!(error = %e, "Proxy server failed");
        std::process::exit(1);
    }
}
