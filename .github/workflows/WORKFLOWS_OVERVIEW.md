# GitHub Actions Workflows Overview

This document provides a quick overview of all available CI/CD workflows in this repository.

**Note:** All workflows in this repository use **manual triggers only** (`workflow_dispatch`). There are no automatic triggers from push or pull request events.

Meetily-Local is Linux-only (see [CLAUDE.md](../CLAUDE.md)); `build-macos.yml`
and `build-windows.yml` were removed along with macOS/Windows CI support.

## Workflow Files

### 1. **build-devtest.yml** - DevTest Builds
**Purpose:** Fast builds for development and testing

**Key Features:**
- Signing OFF by default (faster builds)
- Optional signing via workflow dispatch input
- 14-day artifact retention

**Triggers:**
- Manual dispatch only

**Use When:**
- Regular development work
- Testing features
- Need fast feedback

---

### 2. **build-linux.yml** - Linux Standalone Builds
**Purpose:** Build and test for Linux distributions

**Key Features:**
- Support for Ubuntu 22.04 and 24.04
- Multiple bundle formats (DEB, AppImage, RPM)
- Tauri updater signing
- AppImage compatibility fixes
- Package verification

**Triggers:**
- Manual dispatch only

**Use When:**
- Linux-specific development
- Testing Vulkan GPU acceleration
- Verifying package formats

**Outputs:**
- `.deb` package (Ubuntu/Debian)
- `.AppImage` portable
- `.rpm` package (Fedora/RHEL)

---

### 3. **build-test.yml** - Multi-Platform Test Builds
**Purpose:** Test builds using the reusable `build.yml` workflow

**Key Features:**
- Signing ON by default
- Uses reusable `build.yml` workflow
- 30-day artifact retention
- Artifacts prefixed with `meetily-test-`

**Triggers:**
- Manual dispatch only

**Note:** This workflow's matrix still lists `macos-latest` / `windows-latest`
entries, but `build.yml` (the workflow it calls) no longer has macOS/Windows
steps — those matrix legs will fail until the workflow is updated to
Linux-only. Use `build-linux.yml` for Linux test builds in the meantime.

---

### 4. **build.yml** - Reusable Build Workflow
**Purpose:** Shared, Linux-only workflow used by other workflows

**Key Features:**
- Reusable workflow (called by others)
- Highly configurable inputs
- Used by `build-test.yml` and `release.yml`

**Not directly triggered** - used as a building block

---

### 5. **release.yml** - Production Release
**Purpose:** Create official releases with the Linux AppImage

**Key Features:**
- Creates GitHub Release (draft)
- Version tags from `tauri.conf.json`
- Uploads release assets directly via `tauri-action`
- Builds the Linux AppImage (`ubuntu-22.04`, `x86_64-unknown-linux-gnu`)
- Auto-generates `latest.json` for Tauri updater
- **Auto-increment versioning**: If tag exists, auto-increments (e.g., `0.1.1` -> `0.1.1.1` -> `0.1.1.2`, up to `.100`)

**Triggers:**
- Manual dispatch only

**Use When:**
- Ready to publish a new version
- Creating official release artifacts

**Outputs:**
- GitHub Release (draft)
- Linux: AppImage, .sig
- Updater manifest: latest.json
- Release notes auto-generated

**Version Behavior:**
- If `v0.1.1` tag doesn't exist: creates `v0.1.1`
- If `v0.1.1` exists: creates `v0.1.1.1`
- If `v0.1.1.1` exists: creates `v0.1.1.2`
- Maximum: `v0.1.1.100` (then update `tauri.conf.json`)

---

### 6. **pr-main-check.yml** - Validation Check
**Purpose:** Quick validation of version and configuration

**Key Features:**
- No builds triggered
- Validates version format
- Shows current branch info
- Provides next steps guidance

**Triggers:**
- Manual dispatch only

**Use When:**
- Quick configuration check
- Before running full builds

---

## How to Run Workflows

1. **Go to Actions tab** in GitHub repository
2. **Select workflow** from left sidebar
3. **Click "Run workflow"** button
4. **Select branch** to run against
5. **Configure options** (build type, signing, etc.)
6. **Click "Run workflow"** to start
7. **Monitor progress** in the Actions tab

---

## Quick Decision Guide

### "I'm developing a new feature..."
- **Use `build-devtest.yml`** (manual dispatch)
- Fast builds, no signing by default
- Enable signing checkbox if needed

### "I need to test Linux packages..."
- **Use `build-linux.yml`** (manual dispatch)
- Choose Ubuntu version
- Choose bundle types

### "I need a signed test build..."
- **Use `build-test.yml`** (manual dispatch), keeping in mind it still
  carries stale macOS/Windows matrix legs (see above)

### "I'm ready to release..."
- **Use `release.yml`** (manual dispatch)
- Creates GitHub Release
- Builds and uploads the Linux AppImage

---

## Workflow Dependencies

```
build.yml (reusable, Linux-only)
    |-- build-test.yml (calls build.yml — still has stale mac/win matrix legs)
    |-- release.yml (calls build.yml with ubuntu-22.04 only)

Standalone (don't use build.yml):
    |-- build-linux.yml
    |-- build-devtest.yml (still has mac/win matrix legs — see file)
    |-- pr-main-check.yml (validation only)
```

---

## Comparison Matrix

| Workflow | Platforms | Default Signing | Speed | Retention | Use Case |
|----------|-----------|----------------|-------|-----------|----------|
| `build-devtest.yml` | Linux (+ stale mac/win legs) | OFF | Fast | 14 days | Development |
| `build-linux.yml` | Linux | Optional | Medium | 30 days | Linux dev |
| `build-test.yml` | Linux (+ stale mac/win legs) | ON | Slow | 30 days | Pre-release |
| `release.yml` | Linux | Tauri updater only | Slow | Permanent | Release |

---

## Required Secrets

### Tauri Updater (all builds)
- `TAURI_SIGNING_PRIVATE_KEY` - Ed25519 private key
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` - Key password

### Application Configuration
- `MEETILY_RSA_PUBLIC_KEY` - License validation public key
- `SUPABASE_URL` - Online license verification
- `SUPABASE_ANON_KEY` - Supabase anonymous key

macOS (`APPLE_*`) and Windows (`SM_*` DigiCert) signing secrets are no longer
consumed by `build.yml`/`release.yml` — they were removed along with the
macOS/Windows build steps.

---

## Performance Tips

1. **Use devtest workflow** for routine development (fastest)
2. **Enable signing** only when necessary (adds a few minutes for updater signing)
3. **Run full builds** (`build-test.yml` or `build-linux.yml`) before releases
4. **Cache is enabled** - subsequent builds are faster

---

## Troubleshooting

### Signing fails
- Verify all required secrets are configured
- Check secret expiration dates
- Review workflow logs for specific errors

### Artifacts not available
- Check build succeeded completely
- Artifacts expire based on retention period
- Ensure `upload-artifacts` is enabled

### Workflow not appearing in Actions
- Verify YAML syntax is valid
- Check file is in `.github/workflows/` directory
- Ensure file extension is `.yml` or `.yaml`

---

## Support

For issues with workflows:
1. Check workflow logs in Actions tab
2. Review this documentation
3. Check `README_DEVTEST.md` for devtest-specific help
4. Check `ACCELERATION_GUIDE.md` for GPU/performance info
