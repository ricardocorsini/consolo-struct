// Consulta e atualização do ConsoloStruct pelo catálogo assinado do OpenStruct.
//
// Fluxo: `update_check` consulta o catálogo (nunca baixa nada). `update_download` só roda
// após o clique em Atualizar: reconsulta o catálogo, confirma que a versão escolhida ainda é
// a oferecida, baixa e confere o pacote. `update_apply` só roda depois que a interface
// protegeu o trabalho do usuário; ela confere o arquivo de novo, inicia a instalação e
// encerra o aplicativo. Instalações do Struct Launcher nunca são alteradas aqui.
pub mod catalog;
pub mod install;
pub mod net;

use catalog::{CatalogError, Offer, Selection, Target, Trust};
use install::{InstallInfo, InstallMode, Probe};
use net::{Client, NetError};
use semver::Version;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter, Manager, State};

pub const PRODUCT_ID: &str = "consolostruct";
const CATALOG_URL: &str =
    "https://raw.githubusercontent.com/ricardocorsini/openstruct-catalog/main/catalog.signed.json";
const CATALOG_HOSTS: &[&str] = &["raw.githubusercontent.com"];
/// GitHub responde às URLs de download com redirecionamento para o armazenamento de assets.
const DOWNLOAD_HOSTS: &[&str] = &[
    "github.com",
    "release-assets.githubusercontent.com",
    "objects.githubusercontent.com",
];
const CHECK_TIMEOUT: Duration = Duration::from_secs(20);
/// Resultado reaproveitado pela consulta automática para evitar requisições repetidas.
const CACHE_TTL: Duration = Duration::from_secs(10 * 60);
const STALE_LOCK: Duration = Duration::from_secs(2 * 60 * 60);

/// Chaves públicas de `distribution.json` do openstruct-catalog (sem chaves privadas).
pub fn official_trust() -> Trust<'static> {
    Trust {
        catalog_key_id: "catalog-v1",
        catalog_key: "pvQL4rdeFWW/T+uG4ObGiZalkc+PF70CakS0Kt/0Hq4=",
        product_id: PRODUCT_ID,
        package_key_id: "consolostruct-packages-v1",
        package_key: "EcKYvaqUSR7jZa8oNUZKkrQA90tlyhjuBCTaMbR0UA8=",
        release_prefix: "https://github.com/ricardocorsini/consolo-struct/releases/download/",
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateError {
    /// `offline`, `timeout`, `http`, `catalog`, `signature`, `notListed`, `package`,
    /// `integrity`, `permission`, `space`, `io`, `busy`, `changed`, `unsupported`,
    /// `cancelled`, `state`, `relaunch`.
    pub kind: String,
    pub message: String,
    /// Versão agora oferecida, quando `kind == "changed"`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

fn error(kind: &str, message: impl Into<String>) -> UpdateError {
    UpdateError {
        kind: kind.into(),
        message: message.into(),
        version: None,
    }
}

impl From<NetError> for UpdateError {
    fn from(e: NetError) -> Self {
        let kind = match e {
            NetError::Offline(_) => "offline",
            NetError::Timeout => "timeout",
            NetError::Http(_) | NetError::TooLarge => "http",
            NetError::Untrusted(_) => "signature",
            NetError::Integrity(_) => "integrity",
            NetError::Permission(_) => "permission",
            NetError::Space => "space",
            NetError::Io(_) => "io",
            NetError::Cancelled => "cancelled",
        };
        error(kind, capitalize(&e.to_string()))
    }
}

impl From<CatalogError> for UpdateError {
    fn from(e: CatalogError) -> Self {
        let kind = match e {
            CatalogError::Signature(_) => "signature",
            CatalogError::NotListed => "notListed",
            CatalogError::InvalidPackage { .. } => "package",
            CatalogError::Malformed(_) | CatalogError::UnsupportedSchema(_) => "catalog",
        };
        error(kind, capitalize(&e.to_string()))
    }
}

fn capitalize(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OfferInfo {
    pub version: String,
    pub notes: String,
    pub published_at: String,
    pub size: u64,
    pub file_name: String,
    pub platform: String,
    pub arch: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CheckReport {
    pub current: String,
    /// `upToDate`, `available` ou `incompatible`.
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offer: Option<OfferInfo>,
    /// Maior versão estável publicada (informativo).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest: Option<String>,
    pub target: String,
    pub install: InstallInfo,
    pub checked_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadyInfo {
    pub version: String,
    pub mode: String,
}

#[derive(Clone, Serialize)]
struct Progress {
    received: u64,
    total: u64,
}

#[allow(clippy::large_enum_variant)]
enum Job {
    Idle,
    Downloading,
    Ready {
        offer: Offer,
        path: PathBuf,
        mode: InstallMode,
    },
    Applying,
}

pub struct Updater {
    checking: Mutex<bool>,
    cache: Mutex<Option<(Instant, CheckReport)>>,
    job: Mutex<Job>,
    cancel: AtomicBool,
}

impl Default for Updater {
    fn default() -> Self {
        Self {
            checking: Mutex::new(false),
            cache: Mutex::new(None),
            job: Mutex::new(Job::Idle),
            cancel: AtomicBool::new(false),
        }
    }
}

fn target() -> Target<'static> {
    let platform = std::env::consts::OS;
    let kind = match platform {
        "windows" => "nsis",
        "linux" => "appimage",
        _ => "unsupported",
    };
    Target {
        platform,
        arch: std::env::consts::ARCH,
        kind,
    }
}

fn current_version(app: &AppHandle) -> Result<Version, UpdateError> {
    Version::parse(&app.package_info().version.to_string())
        .map_err(|_| error("state", "Versão em execução inválida"))
}

fn install_mode() -> InstallMode {
    // Sem canonicalize: no Windows ele devolve caminhos \\?\ que o instalador não aceita.
    let exe = std::env::current_exe().unwrap_or_default();
    let appimage = std::env::var_os("APPIMAGE").map(PathBuf::from);
    install::detect(&Probe {
        os: std::env::consts::OS,
        debug: cfg!(debug_assertions),
        exe: &exe,
        appimage: appimage.as_deref(),
        product_id: PRODUCT_ID,
    })
}

fn client(app: &AppHandle) -> Client {
    Client::new(&format!(
        "ConsoloStruct/{} (update-check)",
        app.package_info().version
    ))
}

/// Consulta o catálogo e escolhe a oferta. Bloqueante: chamar fora da thread da interface.
fn resolve(app: &AppHandle, current: &Version) -> Result<Selection, UpdateError> {
    resolve_with(&client(app), current)
}

fn resolve_with(client: &Client, current: &Version) -> Result<Selection, UpdateError> {
    let bytes = client.fetch_small(CATALOG_URL, CATALOG_HOSTS, CHECK_TIMEOUT)?;
    let trust = official_trust();
    let payload = catalog::open_envelope(&bytes, &trust)?;
    Ok(catalog::select(&payload, &trust, current, target())?)
}

/// Segundos desde a época; a interface formata a data local.
fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default()
}

fn report(current: &Version, selection: Selection, mode: &InstallMode) -> CheckReport {
    let t = target();
    let (status, offer, latest) = match selection {
        Selection::UpToDate { latest } => ("upToDate", None, latest.map(|v| v.to_string())),
        Selection::Incompatible { newest } => ("incompatible", None, Some(newest.to_string())),
        Selection::Available(offer) => (
            "available",
            Some(OfferInfo {
                version: offer.version.to_string(),
                notes: offer.notes,
                published_at: offer.published_at,
                size: offer.asset.size,
                file_name: offer.file_name,
                platform: offer.asset.platform,
                arch: offer.asset.arch,
                kind: offer.asset.kind,
            }),
            None,
        ),
    };
    CheckReport {
        current: current.to_string(),
        status: status.into(),
        latest: latest.or_else(|| offer.as_ref().map(|o| o.version.clone())),
        offer,
        target: format!("{}/{}/{}", t.platform, t.arch, t.kind),
        install: install::describe(mode, install::launcher_executable().is_some()),
        checked_at: now_secs(),
    }
}

struct Flag<'a>(&'a Mutex<bool>);
impl Drop for Flag<'_> {
    fn drop(&mut self) {
        *self.0.lock().unwrap_or_else(|e| e.into_inner()) = false;
    }
}

/// Consulta não bloqueante. `manual` ignora o cache da consulta automática.
#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    state: State<'_, Updater>,
    manual: bool,
) -> Result<CheckReport, UpdateError> {
    if !manual {
        let cached = state
            .cache
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .filter(|(at, _)| at.elapsed() < CACHE_TTL)
            .map(|(_, report)| report.clone());
        if let Some(report) = cached {
            return Ok(report);
        }
    }
    {
        let mut checking = state.checking.lock().unwrap_or_else(|e| e.into_inner());
        if *checking {
            return Err(error(
                "busy",
                "Uma consulta de atualização já está em andamento.",
            ));
        }
        *checking = true;
    }
    let _flag = Flag(&state.checking);
    let current = current_version(&app)?;
    let handle = app.clone();
    let worker_current = current.clone();
    let selection = tauri::async_runtime::spawn_blocking(move || resolve(&handle, &worker_current))
        .await
        .map_err(|_| error("state", "A consulta foi interrompida."))??;
    let result = report(&current, selection, &install_mode());
    *state.cache.lock().unwrap_or_else(|e| e.into_inner()) = Some((Instant::now(), result.clone()));
    Ok(result)
}

/// Pasta de trabalho do download: ao lado do AppImage (para troca atômica) ou temporária.
fn staging_dir(mode: &InstallMode) -> Result<PathBuf, UpdateError> {
    match mode {
        InstallMode::LinuxAppImage { path } => path
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| error("state", "Caminho do AppImage inválido.")),
        _ => Ok(std::env::temp_dir().join("consolostruct-update")),
    }
}

/// Trava entre processos: impede duas janelas/cópias de instalar ao mesmo tempo.
struct ProcessLock(PathBuf);
impl ProcessLock {
    fn acquire(dir: &Path) -> Result<Self, UpdateError> {
        let path = dir.join(".consolostruct-update.lock");
        let stale = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|m| m.elapsed().ok())
            .is_some_and(|age| age > STALE_LOCK);
        if stale {
            let _ = std::fs::remove_file(&path);
        }
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(_) => Ok(Self(path)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Err(error(
                "busy",
                "Outra cópia do ConsoloStruct já está baixando ou instalando uma atualização.",
            )),
            Err(e) => Err(NetError::from_io(e).into()),
        }
    }
}
impl Drop for ProcessLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

impl NetError {
    fn from_io(e: std::io::Error) -> Self {
        net::io_error(e)
    }
}

/// Baixa e confere a versão escolhida pelo usuário. Não instala nem reinicia.
#[tauri::command]
pub async fn update_download(
    app: AppHandle,
    state: State<'_, Updater>,
    version: String,
) -> Result<ReadyInfo, UpdateError> {
    let mode = install_mode();
    let info = install::describe(&mode, false);
    if !info.can_install {
        return Err(error("unsupported", info.message));
    }
    {
        let mut job = state.job.lock().unwrap_or_else(|e| e.into_inner());
        match std::mem::replace(&mut *job, Job::Downloading) {
            Job::Idle => {}
            // Um novo pedido descarta o pacote anterior antes de baixar outra vez.
            Job::Ready { path, .. } => {
                let _ = std::fs::remove_file(path);
            }
            busy => {
                *job = busy;
                return Err(error("busy", "A atualização já está em andamento."));
            }
        }
    }
    state.cancel.store(false, Ordering::SeqCst);
    let current = current_version(&app)?;
    let handle = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let updater = handle.state::<Updater>();
        download_blocking(&handle, &updater, &current, &version, mode)
    })
    .await
    .map_err(|_| error("state", "O download foi interrompido."))
    .and_then(|r| r);
    let mut job = state.job.lock().unwrap_or_else(|e| e.into_inner());
    match result {
        Ok((offer, path, mode)) => {
            let ready = ReadyInfo {
                version: offer.version.to_string(),
                mode: install::describe(&mode, false).mode,
            };
            *job = Job::Ready { offer, path, mode };
            Ok(ready)
        }
        Err(e) => {
            *job = Job::Idle;
            Err(e)
        }
    }
}

fn download_blocking(
    app: &AppHandle,
    state: &Updater,
    current: &Version,
    requested: &str,
    mode: InstallMode,
) -> Result<(Offer, PathBuf, InstallMode), UpdateError> {
    // Revalida no catálogo: nunca instala silenciosamente outra versão.
    let offer = match resolve(app, current)? {
        Selection::Available(offer) if offer.version.to_string() == requested => offer,
        Selection::Available(offer) => {
            return Err(UpdateError {
                kind: "changed".into(),
                message: format!(
                    "A versão disponível mudou para {}. Confira as novidades antes de atualizar.",
                    offer.version
                ),
                version: Some(offer.version.to_string()),
            })
        }
        _ => {
            return Err(error(
                "changed",
                format!("A versão {requested} não é mais oferecida para este computador."),
            ))
        }
    };
    let dir = staging_dir(&mode)?;
    std::fs::create_dir_all(&dir).map_err(NetError::from_io)?;
    let _lock = ProcessLock::acquire(&dir)?;
    let dest = match &mode {
        InstallMode::LinuxAppImage { .. } => dir.join(format!(".{}.part", offer.file_name)),
        _ => dir.join(&offer.file_name),
    };
    let mut emit = |received: u64, total: u64| {
        let _ = app.emit("update://progress", Progress { received, total });
    };
    client(app).download(
        &offer.asset.url,
        DOWNLOAD_HOSTS,
        &dest,
        offer.asset.size,
        &offer.asset.sha256,
        &state.cancel,
        &mut emit,
    )?;
    Ok((offer, dest, mode))
}

#[tauri::command]
pub fn update_cancel(state: State<'_, Updater>) {
    state.cancel.store(true, Ordering::SeqCst);
}

/// Descarta um pacote baixado e não aplicado (por exemplo, ao cancelar o reinício).
#[tauri::command]
pub fn update_discard(state: State<'_, Updater>) {
    let mut job = state.job.lock().unwrap_or_else(|e| e.into_inner());
    match std::mem::replace(&mut *job, Job::Idle) {
        Job::Ready { path, .. } => {
            let _ = std::fs::remove_file(path);
        }
        // Um download em curso é interrompido por update_cancel, não por aqui.
        other => *job = other,
    }
}

/// Aplica o pacote conferido e encerra o aplicativo. Chamar somente depois de proteger o
/// trabalho do usuário; em caso de erro o aplicativo continua aberto e utilizável.
#[tauri::command(async)]
pub fn update_apply(app: AppHandle, state: State<'_, Updater>) -> Result<(), UpdateError> {
    let (offer, path, mode) = {
        let mut job = state.job.lock().unwrap_or_else(|e| e.into_inner());
        match std::mem::replace(&mut *job, Job::Applying) {
            Job::Ready { offer, path, mode } => (offer, path, mode),
            previous => {
                *job = previous;
                return Err(error("state", "Nenhuma atualização conferida está pronta."));
            }
        }
    };
    let outcome = apply(&offer, &path, &mode);
    match outcome {
        Ok(()) => {
            app.exit(0);
            Ok(())
        }
        Err(e) => {
            let mut job = state.job.lock().unwrap_or_else(|e| e.into_inner());
            *job = if e.kind == "relaunch" || !path.exists() {
                Job::Idle
            } else {
                Job::Ready { offer, path, mode }
            };
            Err(e)
        }
    }
}

fn apply(offer: &Offer, path: &Path, mode: &InstallMode) -> Result<(), UpdateError> {
    // O arquivo pode ter sido alterado entre o download e o reinício: conferir de novo.
    let (size, sha256) = net::file_sha256(path)?;
    if size != offer.asset.size || sha256 != offer.asset.sha256 {
        let _ = std::fs::remove_file(path);
        return Err(error(
            "integrity",
            "O pacote baixado foi alterado antes da instalação e foi descartado.",
        ));
    }
    match mode {
        InstallMode::WindowsNsis { dir } => launch_nsis(path, dir),
        InstallMode::LinuxAppImage { path: image } => replace_appimage(path, image),
        _ => Err(error(
            "unsupported",
            "Este formato de instalação não se atualiza pelo aplicativo.",
        )),
    }
}

#[cfg(windows)]
fn launch_nsis(installer: &Path, dir: &Path) -> Result<(), UpdateError> {
    use std::os::windows::process::CommandExt;
    let dir = dir.to_string_lossy();
    if dir.contains('"') {
        return Err(error("state", "Pasta de instalação inválida."));
    }
    // Instalador oficial do Tauri: /P passivo (mostra progresso), /R reabre o aplicativo,
    // /UPDATE preserva as escolhas de atalho e /D (sempre o último, sem aspas) fixa a
    // pasta desta mesma cópia, para que o atalho usado abra a versão nova.
    std::process::Command::new(installer)
        .raw_arg("/P")
        .raw_arg("/R")
        .raw_arg("/UPDATE")
        .raw_arg(format!("/D={dir}"))
        .spawn()
        .map(|_| ())
        .map_err(|e| NetError::from_io(e).into())
}

#[cfg(not(windows))]
fn launch_nsis(_: &Path, _: &Path) -> Result<(), UpdateError> {
    Err(error(
        "unsupported",
        "Instalador do Windows indisponível neste sistema.",
    ))
}

#[cfg(unix)]
fn replace_appimage(staged: &Path, image: &Path) -> Result<(), UpdateError> {
    use std::os::unix::fs::PermissionsExt;
    let mode = std::fs::metadata(image)
        .map(|m| m.permissions().mode() & 0o777)
        .unwrap_or(0o755)
        | 0o111;
    std::fs::set_permissions(staged, std::fs::Permissions::from_mode(mode))
        .map_err(NetError::from_io)?;
    // `rename` no mesmo diretório é atômico: o AppImage anterior continua íntegro até aqui
    // e o processo atual segue funcionando a partir da imagem já montada.
    std::fs::rename(staged, image).map_err(NetError::from_io)?;
    std::process::Command::new(image)
        .env_remove("APPIMAGE")
        .env_remove("APPDIR")
        .env_remove("ARGV0")
        .env_remove("OWD")
        .spawn()
        .map(|_| ())
        .map_err(|e| {
            error(
                "relaunch",
                format!(
                    "A nova versão foi instalada, mas não foi possível reabri-la ({e}). \
                     Feche e abra o ConsoloStruct novamente."
                ),
            )
        })
}

#[cfg(not(unix))]
fn replace_appimage(_: &Path, _: &Path) -> Result<(), UpdateError> {
    Err(error("unsupported", "AppImage indisponível neste sistema."))
}

/// Abre o Struct Launcher (caminho fixo detectado) para atualizar instalações gerenciadas.
#[tauri::command(async)]
pub fn update_open_launcher() -> Result<(), UpdateError> {
    let launcher = install::launcher_executable().ok_or_else(|| {
        error(
            "unsupported",
            "Struct Launcher não encontrado neste computador.",
        )
    })?;
    std::process::Command::new(launcher)
        .spawn()
        .map(|_| ())
        .map_err(|e| NetError::from_io(e).into())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fluxo real contra o catálogo e as releases publicadas, sem instalar nada.
    /// Executar com  (exige internet).
    #[test]
    #[ignore = "acessa a rede"]
    fn online_official_offer_downloads_and_verifies_without_installing() {
        let client = Client::new("ConsoloStruct-test (update-check)");
        let current = Version::parse("0.7.0").unwrap();
        let Selection::Available(offer) = resolve_with(&client, &current).unwrap() else {
            panic!("o catálogo oficial deveria oferecer uma versão mais nova que 0.7.0")
        };
        assert!(offer.version > current);
        let t = target();
        assert_eq!(
            (offer.asset.platform.as_str(), offer.asset.kind.as_str()),
            (t.platform, t.kind)
        );
        let dest = std::env::temp_dir().join(format!("consolostruct-online-{}", offer.file_name));
        let mut steps = 0;
        client
            .download(
                &offer.asset.url,
                DOWNLOAD_HOSTS,
                &dest,
                offer.asset.size,
                &offer.asset.sha256,
                &AtomicBool::new(false),
                &mut |_: u64, _: u64| steps += 1,
            )
            .unwrap();
        assert_eq!(
            net::file_sha256(&dest).unwrap(),
            (offer.asset.size, offer.asset.sha256.clone())
        );
        assert!(steps >= 2);
        let _ = std::fs::remove_file(dest);
        // A versão atual publicada não recebe oferta (sem downgrade).
        let latest = Version::parse("999.0.0").unwrap();
        assert!(matches!(
            resolve_with(&client, &latest).unwrap(),
            Selection::UpToDate { .. }
        ));
    }

    #[test]
    fn errors_keep_a_stable_kind_for_the_interface() {
        assert_eq!(UpdateError::from(NetError::Timeout).kind, "timeout");
        assert_eq!(
            UpdateError::from(NetError::Offline("dns".into())).kind,
            "offline"
        );
        assert_eq!(UpdateError::from(NetError::Space).kind, "space");
        assert_eq!(UpdateError::from(CatalogError::NotListed).kind, "notListed");
        assert_eq!(
            UpdateError::from(CatalogError::Signature("x".into())).kind,
            "signature"
        );
        assert_eq!(
            UpdateError::from(CatalogError::InvalidPackage {
                version: "1.0.0".into(),
                reason: "x".into()
            })
            .kind,
            "package"
        );
    }

    #[test]
    fn process_lock_prevents_concurrent_installers() {
        let dir = std::env::temp_dir().join(format!("consolostruct-lock-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let first = ProcessLock::acquire(&dir).unwrap();
        assert_eq!(ProcessLock::acquire(&dir).err().unwrap().kind, "busy");
        drop(first);
        assert!(ProcessLock::acquire(&dir).is_ok());
    }

    #[test]
    fn target_matches_catalog_vocabulary() {
        let t = target();
        if cfg!(windows) {
            assert_eq!((t.platform, t.kind), ("windows", "nsis"));
        }
        if cfg!(target_os = "linux") {
            assert_eq!((t.platform, t.kind), ("linux", "appimage"));
        }
        if cfg!(target_arch = "x86_64") {
            assert_eq!(t.arch, "x86_64");
        }
    }

    #[cfg(unix)]
    #[test]
    fn appimage_replacement_keeps_the_original_when_staging_is_missing() {
        let dir =
            std::env::temp_dir().join(format!("consolostruct-appimage-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let image = dir.join("ConsoloStruct.AppImage");
        std::fs::write(&image, b"versao antiga").unwrap();
        let missing = dir.join(".nao-existe.part");
        assert!(replace_appimage(&missing, &image).is_err());
        assert_eq!(std::fs::read(&image).unwrap(), b"versao antiga");
    }
}
