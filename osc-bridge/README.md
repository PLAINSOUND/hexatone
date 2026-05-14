# osc-bridge

`osc-bridge` is a tiny WebSocket → UDP OSC bridge for Hexatone → SuperCollider.

## Build a standalone binary

This repo now builds the bridge using Node SEA (Single Executable Applications)
instead of the deprecated `pkg` flow.

On newer Node releases, the build uses the direct `node --build-sea` path.
On older supported Node releases, it falls back to the older blob + `postject`
injection workflow.

From the repo root:

```bash
yarn install
yarn build-bridge
```

Output goes to:

- `osc-bridge/dist/osc-bridge-<platform>-<arch>`
- on Windows: `osc-bridge/dist/osc-bridge-<platform>-<arch>.exe`

Example:

```bash
./osc-bridge/dist/osc-bridge-darwin-arm64
```

## Notes

- The produced binary is for the current host platform only.
- macOS builds are re-signed ad hoc (`codesign --sign -`) after injection.
- The build requires Node 20+.
- On Node 25.5+ the builder uses `node --build-sea` directly, which is the
  preferred path.
