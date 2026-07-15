#[path = "build/ffmpeg.rs"]
mod ffmpeg;

fn main() {
    // Warn (build scripts have no other visible channel) only when the
    // build is CPU-only — an accelerated build is the expected outcome
    // and needs no announcement.
    warn_if_cpu_only();

    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-lib=framework=AVFoundation");
        println!("cargo:rustc-link-lib=framework=Cocoa");
        println!("cargo:rustc-link-lib=framework=Foundation");
    }

    // Download and bundle FFmpeg binary at build-time
    ffmpeg::ensure_ffmpeg_binary();

    tauri_build::build()
}

fn warn_if_cpu_only() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();

    // macOS gets Metal by default; other platforms count as accelerated
    // when any GPU/BLAS feature is on.
    let accelerated = target_os == "macos"
        || cfg!(feature = "cuda")
        || cfg!(feature = "vulkan")
        || cfg!(feature = "hipblas")
        || cfg!(feature = "openblas");
    if accelerated {
        return;
    }

    println!(
        "cargo:warning=⚠️  CPU-only build (no GPU/BLAS acceleration) — transcription will be significantly slower"
    );

    let hint = if which::which("nvidia-smi").is_ok() {
        "NVIDIA GPU detected: rebuild with --features cuda"
    } else if which::which("rocm-smi").is_ok() {
        "AMD GPU detected: rebuild with --features hipblas"
    } else {
        "enable a backend with --features cuda|vulkan|hipblas|openblas (see README.md)"
    };
    println!("cargo:warning=💡 {}", hint);
}
