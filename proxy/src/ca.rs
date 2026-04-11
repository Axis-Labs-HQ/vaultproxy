use rcgen::{BasicConstraints, CertificateParams, DnType, IsCa, KeyPair, KeyUsagePurpose};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use std::fs;
use std::path::Path;
use std::sync::Arc;
use tokio_rustls::rustls;
use tracing::info;

/// Self-signed CA that generates per-host certificates for TLS interception.
/// Stores the key pair and raw DER bytes — avoids the rcgen ownership issues
/// by only using CertificateParams transiently during signing operations.
pub struct CertificateAuthority {
    ca_key_pem: String,
    ca_cert_pem: String,
    ca_cert_der: CertificateDer<'static>,
}

impl CertificateAuthority {
    pub fn load_or_create(dir: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let dir = Path::new(dir);
        let cert_path = dir.join("ca.crt");
        let key_path = dir.join("ca.key");

        if cert_path.exists() && key_path.exists() {
            info!("Loading existing CA certificate");
            let key_pem = fs::read_to_string(&key_path)?;
            let cert_pem = fs::read_to_string(&cert_path)?;
            let cert_der = pem_to_der(&cert_pem)?;
            Ok(Self {
                ca_key_pem: key_pem,
                ca_cert_pem: cert_pem,
                ca_cert_der: CertificateDer::from(cert_der),
            })
        } else {
            info!("Generating new CA certificate");
            let ca = Self::generate()?;
            fs::create_dir_all(dir)?;
            fs::write(&cert_path, &ca.ca_cert_pem)?;
            fs::write(&key_path, &ca.ca_key_pem)?;
            info!(path = %dir.display(), "CA certificate saved");
            Ok(ca)
        }
    }

    fn generate() -> Result<Self, Box<dyn std::error::Error>> {
        let key_pair = KeyPair::generate()?;

        let mut params = CertificateParams::default();
        params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        params.distinguished_name.push(DnType::CommonName, "VaultProxy CA");
        params.distinguished_name.push(DnType::OrganizationName, "VaultProxy");
        params.key_usages.push(KeyUsagePurpose::KeyCertSign);
        params.key_usages.push(KeyUsagePurpose::CrlSign);

        let ca_cert = params.self_signed(&key_pair)?;
        let cert_pem = ca_cert.pem();
        let key_pem = key_pair.serialize_pem();
        let cert_der = CertificateDer::from(ca_cert.der().to_vec());

        Ok(Self {
            ca_key_pem: key_pem,
            ca_cert_pem: cert_pem,
            ca_cert_der: cert_der,
        })
    }

    /// Generate a TLS server config for a specific hostname, signed by this CA.
    pub fn server_config_for_host(
        &self,
        hostname: &str,
    ) -> Result<Arc<rustls::ServerConfig>, Box<dyn std::error::Error + Send + Sync>> {
        // Re-parse the CA key and cert from PEM each time (avoids ownership issues
        // with rcgen's consuming APIs). The TlsConfigCache ensures this only happens
        // once per unique hostname.
        let ca_key = KeyPair::from_pem(&self.ca_key_pem)
            .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { Box::new(e) })?;

        // Rebuild CA params for signing
        let mut ca_params = CertificateParams::default();
        ca_params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        ca_params.distinguished_name.push(DnType::CommonName, "VaultProxy CA");
        ca_params.distinguished_name.push(DnType::OrganizationName, "VaultProxy");
        ca_params.key_usages.push(KeyUsagePurpose::KeyCertSign);
        ca_params.key_usages.push(KeyUsagePurpose::CrlSign);
        let ca_cert = ca_params.self_signed(&ca_key)
            .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { Box::new(e) })?;

        // Generate server cert for this hostname
        let server_key = KeyPair::generate()
            .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { Box::new(e) })?;
        let mut server_params = CertificateParams::new(vec![hostname.to_string()])
            .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { Box::new(e) })?;
        server_params.distinguished_name.push(DnType::CommonName, hostname);

        let server_cert = server_params.signed_by(&server_key, &ca_cert, &ca_key)
            .map_err(|e| -> Box<dyn std::error::Error + Send + Sync> { Box::new(e) })?;

        let server_cert_der = CertificateDer::from(server_cert.der().to_vec());
        let server_key_der = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(server_key.serialize_der()));

        let mut config = rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(
                vec![server_cert_der, self.ca_cert_der.clone()],
                server_key_der,
            )?;
        config.alpn_protocols = vec![b"http/1.1".to_vec()];

        Ok(Arc::new(config))
    }
}

fn pem_to_der(pem: &str) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let mut reader = std::io::BufReader::new(pem.as_bytes());
    let certs = rustls_pemfile::certs(&mut reader).collect::<Result<Vec<_>, _>>()?;
    certs
        .into_iter()
        .next()
        .map(|c| c.to_vec())
        .ok_or_else(|| "No certificate found in PEM".into())
}
