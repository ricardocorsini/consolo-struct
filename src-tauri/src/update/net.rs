// Acesso HTTPS restrito às origens oficiais, com timeout e redirecionamentos conferidos.
//
// Nenhuma credencial é enviada e nenhum dado do projeto do usuário participa da consulta:
// a requisição contém apenas a URL fixa e o identificador do aplicativo no User-Agent.
use sha2::{Digest, Sha256};
use std::io::{self, Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use url::Url;

pub const MAX_CATALOG_BYTES: u64 = 2 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NetError {
    Offline(String),
    Timeout,
    Http(u16),
    Untrusted(String),
    TooLarge,
    Integrity(String),
    Permission(String),
    Space,
    Io(String),
    Cancelled,
}

impl std::fmt::Display for NetError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Offline(d) => write!(f, "sem conexão com o servidor de atualizações ({d})"),
            Self::Timeout => write!(f, "o servidor de atualizações não respondeu a tempo"),
            Self::Http(code) => write!(f, "o servidor respondeu com o código HTTP {code}"),
            Self::Untrusted(d) => write!(f, "origem não autorizada recusada ({d})"),
            Self::TooLarge => write!(f, "resposta maior que o esperado"),
            Self::Integrity(d) => write!(f, "o arquivo baixado não confere com o catálogo ({d})"),
            Self::Permission(d) => write!(f, "sem permissão de escrita ({d})"),
            Self::Space => write!(f, "espaço em disco insuficiente"),
            Self::Io(d) => write!(f, "falha de leitura ou gravação ({d})"),
            Self::Cancelled => write!(f, "operação cancelada"),
        }
    }
}

pub fn io_error(error: io::Error) -> NetError {
    // ENOSPC (Unix) e ERROR_DISK_FULL / ERROR_HANDLE_DISK_FULL (Windows).
    let full = if cfg!(windows) { [112, 39] } else { [28, 28] };
    match error.kind() {
        _ if error.raw_os_error().is_some_and(|c| full.contains(&c)) => NetError::Space,
        io::ErrorKind::PermissionDenied => NetError::Permission(error.to_string()),
        io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock => NetError::Timeout,
        _ => NetError::Io(error.to_string()),
    }
}

/// Garante HTTPS na porta padrão, sem credenciais e com host da lista permitida.
pub fn check_url(url: &Url, allowed_hosts: &[&str]) -> Result<(), NetError> {
    let host = url.host_str().unwrap_or_default();
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|p| p != 443)
        || !allowed_hosts.contains(&host)
    {
        return Err(NetError::Untrusted(format!("{}://{host}", url.scheme())));
    }
    Ok(())
}

pub struct Client {
    agent: ureq::Agent,
}

impl Client {
    pub fn new(user_agent: &str) -> Self {
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(10))
            .timeout_read(Duration::from_secs(30))
            .timeout_write(Duration::from_secs(30))
            .redirects(0)
            .user_agent(user_agent)
            .build();
        Self { agent }
    }

    /// GET com redirecionamentos seguidos manualmente; cada destino é conferido.
    fn get(
        &self,
        url: &str,
        allowed_hosts: &[&str],
        total: Option<Duration>,
    ) -> Result<ureq::Response, NetError> {
        let mut current = Url::parse(url).map_err(|e| NetError::Untrusted(e.to_string()))?;
        for _ in 0..=MAX_REDIRECTS {
            check_url(&current, allowed_hosts)?;
            let mut request = self.agent.get(current.as_str());
            if let Some(total) = total {
                request = request.timeout(total);
            }
            let response = match request.call() {
                Ok(response) => response,
                Err(ureq::Error::Status(code, _)) => return Err(NetError::Http(code)),
                Err(ureq::Error::Transport(transport)) => return Err(transport_error(&transport)),
            };
            match response.status() {
                200 => return Ok(response),
                301 | 302 | 303 | 307 | 308 => {
                    let location = response
                        .header("location")
                        .ok_or(NetError::Http(response.status()))?;
                    current = current
                        .join(location)
                        .map_err(|e| NetError::Untrusted(e.to_string()))?;
                }
                code => return Err(NetError::Http(code)),
            }
        }
        Err(NetError::Untrusted("redirecionamentos demais".into()))
    }

    /// Lê um documento pequeno (o catálogo) com limite de tamanho e de tempo total.
    pub fn fetch_small(
        &self,
        url: &str,
        allowed_hosts: &[&str],
        total: Duration,
    ) -> Result<Vec<u8>, NetError> {
        let response = self.get(url, allowed_hosts, Some(total))?;
        let mut body = Vec::new();
        response
            .into_reader()
            .take(MAX_CATALOG_BYTES + 1)
            .read_to_end(&mut body)
            .map_err(io_error)?;
        if body.len() as u64 > MAX_CATALOG_BYTES {
            return Err(NetError::TooLarge);
        }
        Ok(body)
    }

    /// Baixa para `dest`, conferindo tamanho e SHA-256 durante o fluxo.
    #[allow(clippy::too_many_arguments)]
    pub fn download(
        &self,
        url: &str,
        allowed_hosts: &[&str],
        dest: &Path,
        expected_size: u64,
        expected_sha256: &str,
        cancel: &AtomicBool,
        progress: &mut dyn FnMut(u64, u64),
    ) -> Result<(), NetError> {
        let response = self.get(url, allowed_hosts, None)?;
        let result = write_verified(
            response.into_reader(),
            dest,
            expected_size,
            expected_sha256,
            cancel,
            progress,
        );
        if result.is_err() {
            let _ = std::fs::remove_file(dest);
        }
        result
    }
}

fn transport_error(transport: &ureq::Transport) -> NetError {
    let mut source: Option<&(dyn std::error::Error + 'static)> =
        std::error::Error::source(transport);
    while let Some(error) = source {
        if let Some(io) = error.downcast_ref::<io::Error>() {
            if matches!(
                io.kind(),
                io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock
            ) {
                return NetError::Timeout;
            }
        }
        source = error.source();
    }
    let text = transport.to_string();
    if text.contains("timed out") {
        return NetError::Timeout;
    }
    NetError::Offline(text)
}

/// Grava o fluxo em `dest` e confere tamanho e SHA-256. Não remove `dest` em caso de erro.
pub fn write_verified(
    mut reader: impl Read,
    dest: &Path,
    expected_size: u64,
    expected_sha256: &str,
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<(), NetError> {
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(dest)
        .map_err(io_error)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    let mut received: u64 = 0;
    let mut last = Instant::now();
    progress(0, expected_size);
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err(NetError::Cancelled);
        }
        let n = match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(io_error(e)),
        };
        received += n as u64;
        if received > expected_size {
            return Err(NetError::Integrity("arquivo maior que o declarado".into()));
        }
        hasher.update(&buffer[..n]);
        file.write_all(&buffer[..n]).map_err(io_error)?;
        if last.elapsed() >= Duration::from_millis(120) {
            progress(received, expected_size);
            last = Instant::now();
        }
    }
    file.sync_all().map_err(io_error)?;
    progress(received, expected_size);
    if received != expected_size {
        return Err(NetError::Integrity(format!(
            "download interrompido: {received} de {expected_size} bytes"
        )));
    }
    let digest = hex(&hasher.finalize());
    if digest != expected_sha256 {
        return Err(NetError::Integrity("SHA-256 divergente".into()));
    }
    Ok(())
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Recalcula o SHA-256 de um arquivo já baixado, imediatamente antes de usá-lo.
pub fn file_sha256(path: &Path) -> Result<(u64, String), NetError> {
    let mut file = std::fs::File::open(path).map_err(io_error)?;
    let mut hasher = Sha256::new();
    let size = io::copy(&mut file, &mut hasher).map_err(io_error)?;
    Ok((size, hex(&hasher.finalize())))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("consolostruct-net-{name}-{}", std::process::id()))
    }
    fn sha(data: &[u8]) -> String {
        hex(&Sha256::digest(data))
    }

    #[test]
    fn only_official_https_hosts_are_accepted() {
        let allowed = ["github.com", "release-assets.githubusercontent.com"];
        for ok in [
            "https://github.com/ricardocorsini/consolo-struct/releases/download/v1.0.0/a.exe",
            "https://release-assets.githubusercontent.com/x",
            "https://github.com:443/x",
        ] {
            assert!(
                check_url(&Url::parse(ok).unwrap(), &allowed).is_ok(),
                "{ok}"
            );
        }
        for bad in [
            "http://github.com/x",
            "https://evil.example/x",
            "https://github.com.evil.example/x",
            "https://user:pass@github.com/x",
            "https://github.com:8443/x",
            "file:///etc/passwd",
        ] {
            assert!(
                check_url(&Url::parse(bad).unwrap(), &allowed).is_err(),
                "{bad}"
            );
        }
    }

    #[test]
    fn verified_write_accepts_exact_content() {
        let data = b"conteudo do instalador".repeat(5000);
        let path = temp("ok");
        let mut calls = 0;
        write_verified(
            &data[..],
            &path,
            data.len() as u64,
            &sha(&data),
            &AtomicBool::new(false),
            &mut |_: u64, _: u64| calls += 1,
        )
        .unwrap();
        assert_eq!(file_sha256(&path).unwrap(), (data.len() as u64, sha(&data)));
        assert!(calls >= 2);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn verified_write_rejects_hash_size_interruption_and_cancel() {
        let data = b"abcdef".to_vec();
        let path = temp("bad");
        let mut noop = |_: u64, _: u64| {};
        let no = AtomicBool::new(false);
        assert!(matches!(
            write_verified(&data[..], &path, 6, &sha(b"xxxxxx"), &no, &mut noop),
            Err(NetError::Integrity(_))
        ));
        assert!(matches!(
            write_verified(&data[..], &path, 5, &sha(&data), &no, &mut noop),
            Err(NetError::Integrity(_))
        ));
        // Conexão encerrada antes do fim.
        assert!(matches!(
            write_verified(&data[..3], &path, 6, &sha(&data), &no, &mut noop),
            Err(NetError::Integrity(_))
        ));
        assert_eq!(
            write_verified(
                &data[..],
                &path,
                6,
                &sha(&data),
                &AtomicBool::new(true),
                &mut noop
            ),
            Err(NetError::Cancelled)
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn read_errors_are_reported_as_such() {
        struct Broken;
        impl Read for Broken {
            fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
                Err(io::Error::new(io::ErrorKind::TimedOut, "lento"))
            }
        }
        let path = temp("timeout");
        assert_eq!(
            write_verified(
                Broken,
                &path,
                6,
                &"0".repeat(64),
                &AtomicBool::new(false),
                &mut |_: u64, _: u64| {}
            ),
            Err(NetError::Timeout)
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn disk_and_permission_errors_are_classified() {
        let code = if cfg!(windows) { 112 } else { 28 };
        assert_eq!(
            io_error(io::Error::from_raw_os_error(code)),
            NetError::Space
        );
        assert!(matches!(
            io_error(io::Error::new(io::ErrorKind::PermissionDenied, "x")),
            NetError::Permission(_)
        ));
        let missing_dir = temp("sem-pasta").join("x").join("y.exe");
        assert!(matches!(
            write_verified(
                &b""[..],
                &missing_dir,
                0,
                &sha(b""),
                &AtomicBool::new(false),
                &mut |_: u64, _: u64| {}
            ),
            Err(NetError::Io(_))
        ));
    }
}
