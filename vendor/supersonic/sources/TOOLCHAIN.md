# Local build toolchain

Installed on Marc's Apple Silicon Mac, 2026-09-26; reused for the
SuperSonic 0.88.0/DFM1 rebuild on 2026-10-07.

Versions follow SuperSonic 0.88.0 source revision
`8a82576df1e6367484ed9ea711e2cc19267f986a`, whose BUILDING.md and Dockerfile
specify the nightly, Emscripten and wasm-bindgen versions below.

| Tool | Version | Location / ownership |
| --- | --- | --- |
| Rustup | 1.29.1 | Homebrew, `/opt/homebrew/opt/rustup/bin` |
| Rust stable (default) | 1.98.1 | User Rustup toolchains |
| Rust nightly | nightly-2026-07-02 | Includes rust-src and both WASM targets |
| Emscripten | 4.0.21 | `/Users/marcsabat/Dev/emsdk` |
| wasm-bindgen CLI | 0.2.127 | `/Users/marcsabat/.cargo/bin` |
| Ninja | 1.13.2 | Homebrew |
| CMake (already installed) | 4.3.3 | Homebrew |
| Apple Clang (already installed) | 21.0.0 | Xcode |

Nightly targets: `wasm32-unknown-emscripten`, `wasm32-unknown-unknown`.
SDK manager revision at installation: `e566f7bdcc7735f44037911c24b87a58a3c93145`.

The user's `.zshrc` adds Rustup, Cargo tools and SDK/compiler directories to
PATH, and sets EMSDK. It deliberately does not source `emsdk_env.sh` globally:
that script prepends bundled Node/Python paths. Existing nvm setup in `.zprofile`
is unchanged; a fresh interactive login shell still selects Node v24.19.0.

Open a new terminal, or run `source ~/.zshrc`. For upstream builds requiring the
full SDK environment, source `/Users/marcsabat/Dev/emsdk/emsdk_env.sh` within that
build shell only. Use `cargo +nightly-2026-07-02` where necessary; stable remains
the default for ordinary Rust work.

Verification passed: C compiled to WASM and ran under Node; native Rust executable
compiled and ran; pinned nightly compiled Rust for Emscripten and it ran under
Node. Fresh-shell tool discovery and wasm-bindgen version were also checked.
These are toolchain smoke checks, not proof that SuperSonic/DFM1 builds yet.

Installation commands used: `brew install rustup ninja`, official emsdk clone,
`emsdk install 4.0.21`, `emsdk activate 4.0.21`, `rustup default stable`,
`rustup toolchain install nightly-2026-07-02 --profile minimal --component rust-src
--target wasm32-unknown-emscripten --target wasm32-unknown-unknown`, and
`cargo +stable install wasm-bindgen-cli --version 0.2.127 --locked`.

Homebrew performed its automatic old-download-cache cleanup during installation.
No project data was removed. wasm-bindgen installation succeeded with upstream
future-compatibility warnings for buf_redux and multipart.

To undo later, remove the labelled shell configuration block and uninstall tools
using their managers (Rustup toolchain uninstall, Cargo uninstall, emsdk uninstall,
Homebrew uninstall). Check other projects' usage first; these are user-wide tools.
