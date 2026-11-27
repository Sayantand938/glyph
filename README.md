# Glyph

An opinionated learning app powered by Free Spaced Repetition Scheduling algorithm (FSRS). Works offline.

```bash
npm install
npm test

npm run tauri dev     # desktop app (needs Rust and WebView2/WebKitGTK)
npm run tauri build -- --bundles appimage   # Arch/Omarchy release: AppImage

npm run mcp           # MCP server for OpenCode/other clients (see mcp/README.md)
```

## Android

Tested toolchain: **JDK 21**, Android SDK platform **35**, build-tools **35.0.0**,
NDK **27.2.12479018**, Rust target `aarch64-linux-android`.

```bash
export JAVA_HOME="$HOME/.local/share/mise/installs/java/21.0.13.1+2.0.LTS"
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export NDK_HOME="$ANDROID_HOME/ndk/27.2.12479018"

npm run tauri android init --ci
# copy the two files from src-tauri/android-overrides/ into src-tauri/gen/android/
npm run tauri android build -- --apk --target aarch64
```

The APK lands under `src-tauri/gen/android/app/build/outputs/apk/`. `gen/android`
is git-ignored; `src-tauri/android-overrides/README.md` says which files to copy
back after a fresh init.

## Faster Rust builds on Arch Linux / Omarchy

`src-tauri/.cargo/config.toml` links with `clang` + `mold`, and
`src-tauri/Cargo.toml` has a `release-fast` profile and optimised dev
dependencies. Install the tools first:

```bash
sudo pacman -S clang mold   # mold is also available as a static binary
```

Fast local bundle (no LTO, 16 codegen units; not for shipping):

```bash
CARGO_PROFILE_RELEASE_LTO=false CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16 \
  npm run tauri build -- --bundles appimage
```

The Tauri CLI has no `--profile` flag, so the `release-fast` profile is for a
Rust-only check: `cargo build --manifest-path src-tauri/Cargo.toml --profile release-fast`.

See [STATUS.md](STATUS.md) for the plan and progress, and [CLAUDE.md](CLAUDE.md) for contributor rules.
