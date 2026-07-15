use ffmpeg_sidecar::{
    command::ffmpeg_is_installed,
    download::{check_latest_version, download_ffmpeg_package, ffmpeg_download_url, unpack_ffmpeg},
    paths::sidecar_dir,
    version::ffmpeg_version,
};
use log::{debug, error};
use once_cell::sync::Lazy;
use std::path::PathBuf;
use which::which;

const EXECUTABLE_NAME: &str = "ffmpeg";

static FFMPEG_PATH: Lazy<Option<PathBuf>> = Lazy::new(find_ffmpeg_path_internal);

pub fn find_ffmpeg_path() -> Option<PathBuf> {
    FFMPEG_PATH.as_ref().map(|p| p.clone())
}

fn find_ffmpeg_path_internal() -> Option<PathBuf> {
    debug!("Starting search for ffmpeg executable");

    // ============================================================
    // PRIORITY 1: Bundled Binary (Production)
    // ============================================================
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_folder) = exe_path.parent() {
            let bundled = exe_folder.join(EXECUTABLE_NAME);
            if bundled.exists() && bundled.is_file() {
                debug!("Found bundled ffmpeg: {:?}", bundled);
                return Some(bundled);
            }
        }
    }

    // ============================================================
    // PRIORITY 2: Fallback to Existing Logic
    // ============================================================

    // Check if `ffmpeg` is in the PATH environment variable
    if let Ok(path) = which(EXECUTABLE_NAME) {
        debug!("Found ffmpeg in PATH: {:?}", path);
        return Some(path);
    }
    debug!("ffmpeg not found in PATH");

    // Check in current working directory
    if let Ok(cwd) = std::env::current_dir() {
        debug!("Current working directory: {:?}", cwd);
        let ffmpeg_in_cwd = cwd.join(EXECUTABLE_NAME);
        if ffmpeg_in_cwd.is_file() && ffmpeg_in_cwd.exists() {
            debug!(
                "Found ffmpeg in current working directory: {:?}",
                ffmpeg_in_cwd
            );
            return Some(ffmpeg_in_cwd);
        }
        debug!("ffmpeg not found in current working directory");
    }

    // Check in the same folder as the executable
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_folder) = exe_path.parent() {
            debug!("Executable folder: {:?}", exe_folder);

            let lib_folder = exe_folder.join("lib");
            debug!("Lib folder: {:?}", lib_folder);
            let ffmpeg_in_lib = lib_folder.join(EXECUTABLE_NAME);
            if ffmpeg_in_lib.exists() {
                debug!("Found ffmpeg in lib folder: {:?}", ffmpeg_in_lib);
                return Some(ffmpeg_in_lib);
            }
            debug!("ffmpeg not found in lib folder");
        }
    }

    debug!("ffmpeg not found. installing...");

    if let Err(error) = handle_ffmpeg_installation() {
        error!("failed to install ffmpeg: {}", error);
        return None;
    }

    if let Ok(path) = which(EXECUTABLE_NAME) {
        debug!("found ffmpeg after installation: {:?}", path);
        return Some(path);
    }

    let installation_dir = sidecar_dir().map_err(|e| e.to_string()).unwrap();
    let ffmpeg_in_installation = installation_dir.join(EXECUTABLE_NAME);
    if ffmpeg_in_installation.is_file() {
        debug!("found ffmpeg in directory: {:?}", ffmpeg_in_installation);
        return Some(ffmpeg_in_installation);
    }

    error!("ffmpeg not found even after installation");
    None // Return None if ffmpeg is not found
}

fn handle_ffmpeg_installation() -> Result<(), anyhow::Error> {
    if ffmpeg_is_installed() {
        debug!("ffmpeg is already installed");
        return Ok(());
    }

    debug!("ffmpeg not found. installing...");
    match check_latest_version() {
        Ok(version) => debug!("latest version: {}", version),
        Err(e) => debug!("skipping version check due to error: {e}"),
    }

    let download_url = ffmpeg_download_url()?;
    let destination = get_ffmpeg_install_dir()?;

    debug!("downloading from: {:?}", download_url);
    let archive_path = download_ffmpeg_package(download_url, &destination)?;
    debug!("downloaded package: {:?}", archive_path);

    debug!("extracting...");
    unpack_ffmpeg(&archive_path, &destination)?;

    let version = ffmpeg_version()?;

    debug!("done! installed ffmpeg version {}", version);
    Ok(())
}

fn get_ffmpeg_install_dir() -> Result<PathBuf, anyhow::Error> {
    sidecar_dir().map_err(|e| anyhow::anyhow!(e))
}
