// Identifica como esta cópia do ConsoloStruct foi instalada e se ela pode se atualizar.
//
// A decisão é tomada a partir do caminho real do executável (ou do AppImage), nunca do
// atalho usado para abri-lo. Instalações do Struct Launcher são marcadas por
// `.openstruct-managed.json` ao lado do executável; nelas o aplicativo não executa um
// instalador próprio, para não competir com o inventário e os atalhos do Launcher.
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const MANAGED_MARKER: &str = ".openstruct-managed.json";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InstallMode {
    /// Instalada e atualizada pelo Struct Launcher.
    Launcher { dir: PathBuf },
    /// Instalador NSIS independente (Windows), com desinstalador na pasta do executável.
    WindowsNsis { dir: PathBuf },
    /// AppImage independente; `path` é o arquivo real informado pelo runtime do AppImage.
    LinuxAppImage { path: PathBuf },
    /// Formatos sem atualização interna. `reason` explica o caminho seguro.
    Unsupported { kind: &'static str, reason: String },
}

/// Resumo serializado para a interface.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstallInfo {
    /// `launcher`, `nsis`, `appimage`, `development`, `package`, `portable` ou `unsupported`.
    pub mode: String,
    pub can_install: bool,
    pub message: String,
    pub path: String,
    pub launcher_available: bool,
}

#[derive(Deserialize)]
struct Marker {
    #[serde(rename = "appId")]
    app_id: String,
}

fn managed(dir: &Path, product_id: &str) -> bool {
    std::fs::read(dir.join(MANAGED_MARKER))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Marker>(&bytes).ok())
        .is_some_and(|marker| marker.app_id == product_id)
}

/// Entradas da detecção, separadas do ambiente para permitir testes.
pub struct Probe<'a> {
    pub os: &'a str,
    pub debug: bool,
    pub exe: &'a Path,
    /// Valor de `$APPIMAGE` (Linux).
    pub appimage: Option<&'a Path>,
    pub product_id: &'a str,
}

pub fn detect(probe: &Probe) -> InstallMode {
    if probe.debug {
        return InstallMode::Unsupported {
            kind: "development",
            reason: "Compilação de desenvolvimento: a consulta funciona, mas a instalação \
                     só é feita pelos pacotes oficiais."
                .into(),
        };
    }
    match probe.os {
        "windows" => {
            let Some(dir) = probe.exe.parent() else {
                return unsupported_portable();
            };
            if managed(dir, probe.product_id) {
                InstallMode::Launcher {
                    dir: dir.to_path_buf(),
                }
            } else if dir.join("uninstall.exe").is_file() {
                InstallMode::WindowsNsis {
                    dir: dir.to_path_buf(),
                }
            } else {
                unsupported_portable()
            }
        }
        "linux" => match probe.appimage.filter(|p| p.is_absolute() && p.is_file()) {
            Some(path) => match path.parent() {
                Some(dir) if managed(dir, probe.product_id) => InstallMode::Launcher {
                    dir: dir.to_path_buf(),
                },
                Some(_) => InstallMode::LinuxAppImage {
                    path: path.to_path_buf(),
                },
                None => unsupported_portable(),
            },
            None if probe.exe.starts_with("/usr") || probe.exe.starts_with("/opt") => {
                InstallMode::Unsupported {
                    kind: "package",
                    reason: "Instalado por pacote do sistema (.deb ou similar). Atualize pelo \
                             gerenciador de pacotes que o instalou, ou passe a usar o AppImage \
                             oficial pelo Struct Launcher. O aplicativo não troca o método de \
                             instalação sozinho."
                        .into(),
                }
            }
            None => unsupported_portable(),
        },
        _ => InstallMode::Unsupported {
            kind: "unsupported",
            reason: "Não há pacote oficial do ConsoloStruct para este sistema.".into(),
        },
    }
}

fn unsupported_portable() -> InstallMode {
    InstallMode::Unsupported {
        kind: "portable",
        reason: "Executável avulso, fora de um instalador oficial. Baixe e instale a nova versão \
                 pelo Struct Launcher ou pela página de releases; o arquivo em uso não é \
                 substituído."
            .into(),
    }
}

/// Struct Launcher instalado pelo NSIS por usuário (caminho padrão do produto).
pub fn launcher_executable() -> Option<PathBuf> {
    if cfg!(windows) {
        let path = PathBuf::from(std::env::var_os("LOCALAPPDATA")?)
            .join("Struct Launcher")
            .join("struct-launcher.exe");
        path.is_file().then_some(path)
    } else {
        None
    }
}

pub fn describe(mode: &InstallMode, launcher: bool) -> InstallInfo {
    match mode {
        InstallMode::Launcher { dir } => InstallInfo {
            mode: "launcher".into(),
            can_install: false,
            message: if launcher {
                "Esta instalação é gerenciada pelo Struct Launcher. Feche o ConsoloStruct e \
                 atualize pelo Launcher para manter o inventário e os atalhos coerentes."
            } else {
                "Esta instalação é gerenciada pelo Struct Launcher. Feche o ConsoloStruct, \
                 abra o Struct Launcher e use Atualizar."
            }
            .into(),
            path: dir.display().to_string(),
            launcher_available: launcher,
        },
        InstallMode::WindowsNsis { dir } => InstallInfo {
            mode: "nsis".into(),
            can_install: true,
            message: "Instalação independente do Windows: o instalador oficial atualiza esta \
                      mesma pasta e reabre o aplicativo."
                .into(),
            path: dir.display().to_string(),
            launcher_available: launcher,
        },
        InstallMode::LinuxAppImage { path } => InstallInfo {
            mode: "appimage".into(),
            can_install: true,
            message: "AppImage independente: o arquivo é substituído somente depois de baixado \
                      e conferido, e o aplicativo é reaberto."
                .into(),
            path: path.display().to_string(),
            launcher_available: launcher,
        },
        InstallMode::Unsupported { kind, reason } => InstallInfo {
            mode: (*kind).into(),
            can_install: false,
            message: reason.clone(),
            path: String::new(),
            launcher_available: launcher,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "consolostruct-install-test-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }
    fn probe<'a>(os: &'a str, exe: &'a Path, appimage: Option<&'a Path>) -> Probe<'a> {
        Probe {
            os,
            debug: false,
            exe,
            appimage,
            product_id: "consolostruct",
        }
    }

    #[test]
    fn launcher_marker_wins_over_nsis_uninstaller() {
        let dir = temp("launcher");
        fs::write(dir.join("uninstall.exe"), b"").unwrap();
        fs::write(
            dir.join(MANAGED_MARKER),
            br#"{"appId":"consolostruct","schemaVersion":1}"#,
        )
        .unwrap();
        let exe = dir.join("consolostruct.exe");
        assert!(matches!(
            detect(&probe("windows", &exe, None)),
            InstallMode::Launcher { .. }
        ));
    }

    #[test]
    fn marker_of_another_product_is_not_trusted() {
        let dir = temp("other");
        fs::write(dir.join("uninstall.exe"), b"").unwrap();
        fs::write(dir.join(MANAGED_MARKER), br#"{"appId":"molastruct"}"#).unwrap();
        let exe = dir.join("consolostruct.exe");
        assert!(matches!(
            detect(&probe("windows", &exe, None)),
            InstallMode::WindowsNsis { .. }
        ));
    }

    #[test]
    fn windows_without_installer_is_portable() {
        let dir = temp("portable");
        let exe = dir.join("consolostruct.exe");
        assert!(matches!(
            detect(&probe("windows", &exe, None)),
            InstallMode::Unsupported {
                kind: "portable",
                ..
            }
        ));
    }

    #[test]
    fn linux_uses_the_real_appimage_path() {
        let dir = temp("appimage");
        let image = dir.join("ConsoloStruct.AppImage");
        fs::write(&image, b"").unwrap();
        let mounted = Path::new("/tmp/.mount_Consol/usr/bin/consolostruct");
        assert_eq!(
            detect(&probe("linux", mounted, Some(image.as_path()))),
            InstallMode::LinuxAppImage {
                path: image.clone()
            }
        );
        fs::write(dir.join(MANAGED_MARKER), br#"{"appId":"consolostruct"}"#).unwrap();
        assert!(matches!(
            detect(&probe("linux", mounted, Some(image.as_path()))),
            InstallMode::Launcher { .. }
        ));
    }

    #[test]
    fn linux_package_manager_and_development_builds_do_not_self_install() {
        assert!(matches!(
            detect(&probe("linux", Path::new("/usr/bin/consolostruct"), None)),
            InstallMode::Unsupported {
                kind: "package",
                ..
            }
        ));
        let missing = Path::new("/nao/existe.AppImage");
        assert!(matches!(
            detect(&probe(
                "linux",
                Path::new("/home/u/consolostruct"),
                Some(missing)
            )),
            InstallMode::Unsupported {
                kind: "portable",
                ..
            }
        ));
        let mut debug = probe("windows", Path::new("C:/x/consolostruct.exe"), None);
        debug.debug = true;
        assert!(matches!(
            detect(&debug),
            InstallMode::Unsupported {
                kind: "development",
                ..
            }
        ));
        assert!(matches!(
            detect(&probe("macos", Path::new("/Applications/x"), None)),
            InstallMode::Unsupported {
                kind: "unsupported",
                ..
            }
        ));
    }

    #[test]
    fn only_independent_installs_can_install() {
        let dir = PathBuf::from("x");
        assert!(!describe(&InstallMode::Launcher { dir: dir.clone() }, true).can_install);
        assert!(describe(&InstallMode::WindowsNsis { dir: dir.clone() }, false).can_install);
        assert!(describe(&InstallMode::LinuxAppImage { path: dir }, false).can_install);
    }
}
