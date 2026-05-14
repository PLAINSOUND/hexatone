# osc-bridge

`osc-bridge` is a tiny WebSocket → UDP OSC bridge for Hexatone → SuperCollider.

## Build a standalone binary

This repo now builds the bridge using Node SEA (Single Executable Applications)
instead of the deprecated `pkg` flow.

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
- The build requires a Node version that supports SEA blob generation
  (`node --experimental-sea-config`), which means Node 20+.
