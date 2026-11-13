// Leitura do catálogo assinado do OpenStruct e escolha da versão oferecida.
//
// Este módulo é puro: não acessa rede nem disco. Recebe os bytes do catálogo, as chaves
// confiáveis e o alvo da instalação atual, e devolve a decisão. Os contratos replicam
// `scripts/security.mjs` e `scripts/distribution/release-lib.mjs` do openstruct-catalog.
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, VerifyingKey};
use semver::Version;
use serde::Deserialize;
use serde_json::Value;

/// Maior tamanho aceito para um pacote, igual ao limite do catálogo (2 GiB).
pub const MAX_PACKAGE_SIZE: u64 = 2_147_483_648;

/// Chaves e identidades confiáveis, fixadas no binário.
pub struct Trust<'a> {
    pub catalog_key_id: &'a str,
    pub catalog_key: &'a str,
    pub product_id: &'a str,
    pub package_key_id: &'a str,
    pub package_key: &'a str,
    /// Prefixo obrigatório das URLs dos pacotes, terminando em `/releases/download/`.
    pub release_prefix: &'a str,
}

/// Sistema, arquitetura e formato de pacote da instalação em execução.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Target<'a> {
    pub platform: &'a str,
    pub arch: &'a str,
    pub kind: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CatalogError {
    /// JSON inválido, campo ausente ou estrutura inesperada.
    Malformed(String),
    /// Assinatura do catálogo ausente, de outra chave ou que não confere.
    Signature(String),
    /// Esquema que esta versão não sabe interpretar.
    UnsupportedSchema(u64),
    /// O produto não consta do catálogo.
    NotListed,
    /// Há versão mais nova para este alvo, mas seu pacote foi recusado.
    InvalidPackage { version: String, reason: String },
}

impl std::fmt::Display for CatalogError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Malformed(reason) => write!(f, "catálogo inválido: {reason}"),
            Self::Signature(reason) => write!(f, "assinatura do catálogo recusada: {reason}"),
            Self::UnsupportedSchema(v) => write!(f, "esquema de catálogo {v} não suportado"),
            Self::NotListed => write!(f, "o produto não consta do catálogo"),
            Self::InvalidPackage { version, reason } => {
                write!(f, "pacote da versão {version} recusado: {reason}")
            }
        }
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct Asset {
    pub platform: String,
    pub arch: String,
    pub kind: String,
    pub url: String,
    pub size: u64,
    pub sha256: String,
    pub signature: String,
    #[serde(rename = "keyId")]
    pub key_id: String,
    #[serde(default)]
    pub executable: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct Release {
    version: String,
    channel: String,
    #[serde(rename = "publishedAt")]
    published_at: String,
    notes: String,
    assets: Vec<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Offer {
    pub version: Version,
    pub notes: String,
    pub published_at: String,
    pub asset: Asset,
    /// Nome do arquivo no fim da URL, já validado.
    pub file_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(clippy::large_enum_variant)]
pub enum Selection {
    /// Nenhuma versão estável mais nova. `latest` é a maior estável publicada, se houver.
    UpToDate {
        latest: Option<Version>,
    },
    Available(Offer),
    /// Existe versão estável mais nova, mas nenhuma com pacote para este alvo.
    Incompatible {
        newest: Version,
    },
}

pub fn decode_key(b64: &str) -> Result<VerifyingKey, CatalogError> {
    let bytes = STANDARD
        .decode(b64)
        .map_err(|_| CatalogError::Signature("chave pública inválida".into()))?;
    let raw: [u8; 32] = bytes
        .try_into()
        .map_err(|_| CatalogError::Signature("chave pública com tamanho inválido".into()))?;
    VerifyingKey::from_bytes(&raw)
        .map_err(|_| CatalogError::Signature("chave pública inválida".into()))
}

fn verify(message: &[u8], signature_b64: &str, key: &VerifyingKey) -> bool {
    let Ok(bytes) = STANDARD.decode(signature_b64) else {
        return false;
    };
    let Ok(raw) = <[u8; 64]>::try_from(bytes.as_slice()) else {
        return false;
    };
    key.verify_strict(message, &Signature::from_bytes(&raw))
        .is_ok()
}

/// Mensagem assinada de cada pacote (`packageMessage` do catálogo).
pub fn package_message(app_id: &str, version: &str, asset: &Asset) -> String {
    format!(
        "OPENSTRUCT-PACKAGE-V1\n{app_id}\n{version}\n{}\n{}\n{}\n{}\n{}\n{}",
        asset.platform,
        asset.arch,
        asset.kind,
        asset.size,
        asset.sha256,
        asset.executable.as_deref().unwrap_or("")
    )
}

/// Confere o envelope `{payload, signature, keyId}` e devolve o payload interpretado.
pub fn open_envelope(bytes: &[u8], trust: &Trust) -> Result<Value, CatalogError> {
    #[derive(Deserialize)]
    struct Envelope {
        payload: String,
        signature: String,
        #[serde(rename = "keyId")]
        key_id: String,
    }
    let envelope: Envelope = serde_json::from_slice(bytes)
        .map_err(|e| CatalogError::Malformed(format!("envelope ilegível ({e})")))?;
    if envelope.key_id != trust.catalog_key_id {
        return Err(CatalogError::Signature(format!(
            "chave inesperada {}",
            envelope.key_id
        )));
    }
    let key = decode_key(trust.catalog_key)?;
    if !verify(envelope.payload.as_bytes(), &envelope.signature, &key) {
        return Err(CatalogError::Signature("assinatura não confere".into()));
    }
    let payload: Value = serde_json::from_str(&envelope.payload)
        .map_err(|e| CatalogError::Malformed(format!("conteúdo ilegível ({e})")))?;
    match payload.get("schemaVersion").and_then(Value::as_u64) {
        Some(1) => Ok(payload),
        Some(other) => Err(CatalogError::UnsupportedSchema(other)),
        None => Err(CatalogError::Malformed("schemaVersion ausente".into())),
    }
}

/// Versão estável canônica: SemVer sem `v`, sem pré-lançamento e sem build metadata.
fn stable_version(release: &Release) -> Result<Version, String> {
    let version = Version::parse(&release.version).map_err(|_| "versão não é SemVer")?;
    if version.to_string() != release.version || !version.build.is_empty() {
        return Err("versão fora do formato canônico".into());
    }
    if release.channel != "stable" || !version.pre.is_empty() {
        return Err("fora do canal estável".into());
    }
    Ok(version)
}

fn is_hex_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Valida um pacote já filtrado para o alvo e devolve o nome do arquivo.
fn validate_asset(
    asset: &Asset,
    version: &str,
    trust: &Trust,
    key: &VerifyingKey,
) -> Result<String, String> {
    if asset.key_id != trust.package_key_id {
        return Err(format!("assinado por outra chave ({})", asset.key_id));
    }
    if asset.size == 0 || asset.size > MAX_PACKAGE_SIZE {
        return Err("tamanho declarado inválido".into());
    }
    if !is_hex_sha256(&asset.sha256) {
        return Err("SHA-256 declarado inválido".into());
    }
    let prefix = format!("{}v{version}/", trust.release_prefix);
    let file_name = asset
        .url
        .strip_prefix(&prefix)
        .ok_or("URL fora da release oficial desta versão")?;
    let suffix = match asset.kind.as_str() {
        "nsis" => ".exe",
        "appimage" => ".AppImage",
        _ => return Err("formato de pacote desconhecido".into()),
    };
    if file_name.is_empty()
        || file_name.starts_with('.')
        || !file_name.ends_with(suffix)
        || !file_name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'.' || b == b'-')
    {
        return Err("nome de arquivo inválido".into());
    }
    match (asset.kind.as_str(), asset.executable.as_deref()) {
        ("nsis", Some(exe))
            if exe.ends_with(".exe")
                && !exe.contains(['/', '\\', ':', '\0'])
                && !exe.starts_with('.') => {}
        ("appimage", None) => {}
        _ => return Err("executável declarado incompatível com o formato".into()),
    }
    if !verify(
        package_message(trust.product_id, version, asset).as_bytes(),
        &asset.signature,
        key,
    ) {
        return Err("assinatura do pacote não confere".into());
    }
    Ok(file_name.to_string())
}

/// Escolhe a maior versão estável mais nova que `current` com pacote válido para `target`.
pub fn select(
    payload: &Value,
    trust: &Trust,
    current: &Version,
    target: Target,
) -> Result<Selection, CatalogError> {
    let apps = payload
        .get("apps")
        .and_then(Value::as_array)
        .ok_or_else(|| CatalogError::Malformed("lista de aplicativos ausente".into()))?;
    let mut matches = apps
        .iter()
        .filter(|app| app.get("id").and_then(Value::as_str) == Some(trust.product_id));
    let app = matches.next().ok_or(CatalogError::NotListed)?;
    if matches.next().is_some() {
        return Err(CatalogError::Malformed("produto duplicado".into()));
    }
    let releases = app
        .get("releases")
        .and_then(Value::as_array)
        .ok_or_else(|| CatalogError::Malformed("lista de versões ausente".into()))?;
    let key = decode_key(trust.package_key)?;

    let mut latest: Option<Version> = None;
    let mut newer: Vec<(Version, Release)> = Vec::new();
    for raw in releases {
        // Uma versão ilegível ou fora do canal estável nunca é oferecida, mas não
        // impede a leitura das demais.
        let Ok(release) = serde_json::from_value::<Release>(raw.clone()) else {
            continue;
        };
        let Ok(version) = stable_version(&release) else {
            continue;
        };
        if latest.as_ref().is_none_or(|l| &version > l) {
            latest = Some(version.clone());
        }
        if &version > current {
            newer.push((version, release));
        }
    }
    if newer.is_empty() {
        return Ok(Selection::UpToDate { latest });
    }
    newer.sort_by(|a, b| b.0.cmp(&a.0));
    if newer.windows(2).any(|w| w[0].0 == w[1].0) {
        return Err(CatalogError::Malformed("versão duplicada".into()));
    }

    let mut first_rejection: Option<CatalogError> = None;
    for (version, release) in &newer {
        let candidates: Vec<Asset> = release
            .assets
            .iter()
            .filter_map(|a| serde_json::from_value::<Asset>(a.clone()).ok())
            .filter(|a| {
                a.platform == target.platform && a.arch == target.arch && a.kind == target.kind
            })
            .collect();
        if candidates.is_empty() {
            continue;
        }
        let rejection = if candidates.len() > 1 {
            Err("pacote duplicado para este sistema".to_string())
        } else {
            validate_asset(&candidates[0], &release.version, trust, &key)
        };
        match rejection {
            Ok(file_name) => {
                if first_rejection.is_some() {
                    // Uma versão mais nova foi recusada: não oferecer silenciosamente outra.
                    break;
                }
                return Ok(Selection::Available(Offer {
                    version: version.clone(),
                    notes: release.notes.clone(),
                    published_at: release.published_at.clone(),
                    asset: candidates[0].clone(),
                    file_name,
                }));
            }
            Err(reason) => {
                first_rejection.get_or_insert(CatalogError::InvalidPackage {
                    version: version.to_string(),
                    reason,
                });
            }
        }
    }
    if let Some(error) = first_rejection {
        return Err(error);
    }
    Ok(Selection::Incompatible {
        newest: newer[0].0.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use serde_json::json;

    const PREFIX: &str = "https://github.com/ricardocorsini/consolo-struct/releases/download/";
    const WIN: Target = Target {
        platform: "windows",
        arch: "x86_64",
        kind: "nsis",
    };
    const LINUX: Target = Target {
        platform: "linux",
        arch: "x86_64",
        kind: "appimage",
    };

    fn signer(seed: u8) -> SigningKey {
        SigningKey::from_bytes(&[seed; 32])
    }
    fn public(key: &SigningKey) -> String {
        STANDARD.encode(key.verifying_key().to_bytes())
    }
    struct Keys {
        catalog: SigningKey,
        package: SigningKey,
        catalog_pub: String,
        package_pub: String,
    }
    fn keys() -> Keys {
        let catalog = signer(1);
        let package = signer(2);
        Keys {
            catalog_pub: public(&catalog),
            package_pub: public(&package),
            catalog,
            package,
        }
    }
    fn trust(k: &Keys) -> Trust<'_> {
        Trust {
            catalog_key_id: "catalog-v1",
            catalog_key: &k.catalog_pub,
            product_id: "consolostruct",
            package_key_id: "consolostruct-packages-v1",
            package_key: &k.package_pub,
            release_prefix: PREFIX,
        }
    }
    fn asset(k: &SigningKey, version: &str, platform: &str) -> Value {
        let (kind, name, exe) = if platform == "windows" {
            (
                "nsis",
                format!("consolostruct-{version}-windows-x86_64.exe"),
                Some("consolostruct.exe"),
            )
        } else {
            (
                "appimage",
                format!("consolostruct-{version}-linux-x86_64.AppImage"),
                None,
            )
        };
        let mut a = Asset {
            platform: platform.into(),
            arch: "x86_64".into(),
            kind: kind.into(),
            url: format!("{PREFIX}v{version}/{name}"),
            size: 1234,
            sha256: "ab".repeat(32),
            signature: String::new(),
            key_id: "consolostruct-packages-v1".into(),
            executable: exe.map(String::from),
        };
        a.signature = STANDARD.encode(
            k.sign(package_message("consolostruct", version, &a).as_bytes())
                .to_bytes(),
        );
        json!({
            "platform": a.platform, "arch": a.arch, "kind": a.kind, "url": a.url,
            "size": a.size, "sha256": a.sha256, "signature": a.signature, "keyId": a.key_id,
            "minLauncherVersion": "0.2.0", "executable": a.executable,
        })
    }
    fn release(k: &SigningKey, version: &str) -> Value {
        json!({
            "version": version,
            "channel": if version.contains('-') { "beta" } else { "stable" },
            "publishedAt": "2026-11-07T12:22:31Z",
            "notes": format!("Novidades da {version}"),
            "assets": [asset(k, version, "windows"), asset(k, version, "linux")],
        })
    }
    fn payload(releases: Vec<Value>) -> Value {
        json!({
            "schemaVersion": 1,
            "publishedAt": "2026-11-12T22:23:25.868Z",
            "apps": [
                { "id": "molastruct", "releases": [release(&signer(9), "9.9.9")] },
                { "id": "consolostruct", "releases": releases },
            ],
        })
    }
    fn seal(k: &SigningKey, payload: &Value) -> Vec<u8> {
        let text = payload.to_string();
        let signature = STANDARD.encode(k.sign(text.as_bytes()).to_bytes());
        json!({ "payload": text, "signature": signature, "keyId": "catalog-v1" })
            .to_string()
            .into_bytes()
    }
    fn v(s: &str) -> Version {
        Version::parse(s).unwrap()
    }

    #[test]
    fn offers_the_highest_newer_stable_version_for_the_target() {
        let k = keys();
        let p = payload(vec![
            release(&k.package, "0.7.1"),
            release(&k.package, "0.9.0"),
            release(&k.package, "0.8.0"),
            release(&k.package, "1.0.0-beta.1"),
        ]);
        let opened = open_envelope(&seal(&k.catalog, &p), &trust(&k)).unwrap();
        let Selection::Available(offer) = select(&opened, &trust(&k), &v("0.7.1"), LINUX).unwrap()
        else {
            panic!("esperava oferta")
        };
        assert_eq!(offer.version, v("0.9.0"));
        assert_eq!(offer.asset.kind, "appimage");
        assert_eq!(offer.file_name, "consolostruct-0.9.0-linux-x86_64.AppImage");
        assert_eq!(offer.notes, "Novidades da 0.9.0");
        let Selection::Available(win) = select(&opened, &trust(&k), &v("0.7.1"), WIN).unwrap()
        else {
            panic!("esperava oferta")
        };
        assert_eq!(win.asset.executable.as_deref(), Some("consolostruct.exe"));
    }

    #[test]
    fn same_or_newer_running_version_is_never_offered_a_downgrade() {
        let k = keys();
        let p = payload(vec![
            release(&k.package, "0.7.0"),
            release(&k.package, "0.7.1"),
        ]);
        for current in ["0.7.1", "0.8.0", "0.7.2-beta.1"] {
            assert_eq!(
                select(&p, &trust(&k), &v(current), WIN).unwrap(),
                Selection::UpToDate {
                    latest: Some(v("0.7.1"))
                },
                "{current}"
            );
        }
    }

    #[test]
    fn semver_comparison_is_numeric_and_prerelease_aware() {
        let k = keys();
        let p = payload(vec![
            release(&k.package, "0.10.0"),
            release(&k.package, "0.9.9"),
        ]);
        let Selection::Available(offer) = select(&p, &trust(&k), &v("0.9.10"), WIN).unwrap() else {
            panic!()
        };
        assert_eq!(offer.version, v("0.10.0"));
        // Uma beta instalada recebe a estável correspondente.
        let p = payload(vec![release(&k.package, "1.0.0")]);
        assert!(matches!(
            select(&p, &trust(&k), &v("1.0.0-beta.2"), WIN).unwrap(),
            Selection::Available(_)
        ));
    }

    #[test]
    fn only_the_consolostruct_product_is_considered() {
        let k = keys();
        let p = payload(vec![]);
        // molastruct 9.9.9 existe no mesmo hub e não pode ser oferecido.
        assert_eq!(
            select(&p, &trust(&k), &v("0.7.1"), WIN).unwrap(),
            Selection::UpToDate { latest: None }
        );
        let missing = json!({ "schemaVersion": 1, "apps": [] });
        assert_eq!(
            select(&missing, &trust(&k), &v("0.7.1"), WIN),
            Err(CatalogError::NotListed)
        );
    }

    #[test]
    fn rejects_catalog_with_wrong_signature_key_or_schema() {
        let k = keys();
        let p = payload(vec![release(&k.package, "0.9.0")]);
        let forged = seal(&signer(7), &p);
        assert!(matches!(
            open_envelope(&forged, &trust(&k)),
            Err(CatalogError::Signature(_))
        ));
        let mut wrong_id: Value = serde_json::from_slice(&seal(&k.catalog, &p)).unwrap();
        wrong_id["keyId"] = json!("launcher-packages-v1");
        assert!(matches!(
            open_envelope(wrong_id.to_string().as_bytes(), &trust(&k)),
            Err(CatalogError::Signature(_))
        ));
        let mut tampered: Value = serde_json::from_slice(&seal(&k.catalog, &p)).unwrap();
        tampered["payload"] = json!(tampered["payload"]
            .as_str()
            .unwrap()
            .replace("0.9.0", "0.9.1"));
        assert!(matches!(
            open_envelope(tampered.to_string().as_bytes(), &trust(&k)),
            Err(CatalogError::Signature(_))
        ));
        let schema2 = json!({ "schemaVersion": 2, "apps": [] });
        assert_eq!(
            open_envelope(&seal(&k.catalog, &schema2), &trust(&k)),
            Err(CatalogError::UnsupportedSchema(2))
        );
        for junk in [&b""[..], b"<html>", b"{}", b"{\"payload\":1}"] {
            assert!(open_envelope(junk, &trust(&k)).is_err());
        }
    }

    #[test]
    fn package_with_invalid_signature_is_an_error_not_up_to_date() {
        let k = keys();
        // Pacote assinado pela chave de outro produto.
        let p = payload(vec![release(&signer(5), "0.9.0")]);
        let result = select(&p, &trust(&k), &v("0.7.1"), WIN);
        assert!(
            matches!(result, Err(CatalogError::InvalidPackage { ref version, .. }) if version == "0.9.0")
        );
    }

    #[test]
    fn a_rejected_newest_version_does_not_silently_fall_back_to_an_older_one() {
        let k = keys();
        let p = payload(vec![
            release(&signer(5), "0.9.0"),
            release(&k.package, "0.8.0"),
        ]);
        assert!(matches!(
            select(&p, &trust(&k), &v("0.7.1"), WIN),
            Err(CatalogError::InvalidPackage { .. })
        ));
    }

    #[test]
    fn tampered_fields_invalidate_the_package_signature() {
        let k = keys();
        let mutations: Vec<(&str, Value)> = vec![
            ("size", json!(999)),
            ("sha256", json!("cd".repeat(32))),
            ("executable", json!("outro.exe")),
            ("url", json!("https://example.com/v0.9.0/x.exe")),
            (
                "url",
                json!(format!(
                    "{PREFIX}v0.8.0/consolostruct-0.9.0-windows-x86_64.exe"
                )),
            ),
            ("url", json!(format!("{PREFIX}v0.9.0/../x.exe"))),
            ("keyId", json!("launcher-packages-v1")),
            ("sha256", json!("AB".repeat(32))),
            ("signature", json!("bm90LWEtc2lnbmF0dXJl")),
        ];
        for (field, value) in mutations {
            let mut r = release(&k.package, "0.9.0");
            r["assets"][0][field] = value.clone();
            let p = payload(vec![r]);
            assert!(
                matches!(
                    select(&p, &trust(&k), &v("0.7.1"), WIN),
                    Err(CatalogError::InvalidPackage { .. })
                ),
                "{field} = {value}"
            );
        }
    }

    #[test]
    fn incompatible_platform_or_arch_is_reported() {
        let k = keys();
        let p = payload(vec![release(&k.package, "0.9.0")]);
        let arm = Target {
            platform: "linux",
            arch: "aarch64",
            kind: "appimage",
        };
        assert_eq!(
            select(&p, &trust(&k), &v("0.7.1"), arm).unwrap(),
            Selection::Incompatible { newest: v("0.9.0") }
        );
        let deb = Target {
            platform: "linux",
            arch: "x86_64",
            kind: "deb",
        };
        assert!(matches!(
            select(&p, &trust(&k), &v("0.7.1"), deb).unwrap(),
            Selection::Incompatible { .. }
        ));
    }

    #[test]
    fn duplicated_versions_or_packages_are_refused() {
        let k = keys();
        let p = payload(vec![
            release(&k.package, "0.9.0"),
            release(&k.package, "0.9.0"),
        ]);
        assert!(matches!(
            select(&p, &trust(&k), &v("0.7.1"), WIN),
            Err(CatalogError::Malformed(_))
        ));
        let mut r = release(&k.package, "0.9.0");
        let copy = r["assets"][0].clone();
        r["assets"].as_array_mut().unwrap().push(copy);
        assert!(matches!(
            select(&payload(vec![r]), &trust(&k), &v("0.7.1"), WIN),
            Err(CatalogError::InvalidPackage { .. })
        ));
    }

    #[test]
    fn noncanonical_or_beta_versions_are_ignored() {
        let k = keys();
        let mut prefixed = release(&k.package, "0.9.0");
        prefixed["version"] = json!("v0.9.0");
        let mut mislabeled = release(&k.package, "0.9.1-rc.1");
        mislabeled["channel"] = json!("stable");
        let p = payload(vec![prefixed, mislabeled, json!({ "version": 3 })]);
        assert_eq!(
            select(&p, &trust(&k), &v("0.7.1"), WIN).unwrap(),
            Selection::UpToDate { latest: None }
        );
    }

    /// O catálogo real publicado precisa ser aceito com as chaves fixadas no binário.
    #[test]
    fn accepts_the_published_catalog_snapshot_with_pinned_keys() {
        let bytes = include_bytes!("../../tests/fixtures/catalog.signed.json");
        let trust = crate::update::official_trust();
        let opened = open_envelope(bytes, &trust).expect("catálogo oficial");
        let Selection::Available(offer) = select(&opened, &trust, &v("0.7.0"), WIN).unwrap() else {
            panic!("0.7.1 deveria ser oferecida à 0.7.0")
        };
        assert_eq!(offer.version, v("0.7.1"));
        assert_eq!(offer.file_name, "consolostruct-0.7.1-windows-x86_64.exe");
        let Selection::Available(linux) = select(&opened, &trust, &v("0.6.0"), LINUX).unwrap()
        else {
            panic!()
        };
        assert_eq!(linux.version, v("0.7.1"));
        assert_eq!(
            select(&opened, &trust, &v("0.7.1"), WIN).unwrap(),
            Selection::UpToDate {
                latest: Some(v("0.7.1"))
            }
        );
    }
}
