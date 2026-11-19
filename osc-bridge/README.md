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

## Tracing live pitch

To log every outgoing OSC frequency update while diagnosing live retuning, run
the source bridge with its opt-in pitch trace:

```sh
HEXATONE_OSC_PITCH_TRACE=1 yarn osc-bridge
```

Each `/n_set ... freq ...` packet is printed with its exact sequence number,
bridge timestamp, destination port, node ID, and frequency. Leave the variable
unset for normal operation.

## Notes

- The produced binary is for the current host platform only.
- macOS builds are re-signed ad hoc (`codesign --sign -`) after injection.
- The build requires Node 24+.
- On Node 25.5+ the builder uses `node --build-sea` directly, which is the
  preferred path.

## Pairing and access

Run `yarn osc-bridge` (Node 24+) or the rebuilt standalone binary. The bridge
listens **only on 127.0.0.1:8089** and prints a new random pairing token at startup.
In Hexatone, select **Local via OSC Bridge**, then paste that token into
**Bridge pairing token** and leave the field to apply it. Existing browser
connections reconnect with the new token. It is kept in sessionStorage for this
tab, never in preset exports, shared URLs, or audio settings reports.

Restarting the bridge generates a new token. For a stable token, set
`HEXATONE_OSC_TOKEN` to a cryptographically random 32–128 character URL-safe
secret before launching it. Do not use a password or commit the token. For example,
generate a value with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.

Connections must also present an approved browser Origin: the production app at
`https://hexatone.plainsound.org`, the preview at `https://plainsound.github.io`,
or an HTTP(S) loopback development origin. Other origins, missing credentials,
and token-bearing query URLs are rejected before the WebSocket upgrade. The
token is carried in the WebSocket subprotocol header; only `hexatone-osc` is
echoed in the response. The bridge intentionally has no unauthenticated mode.

Only `/s_new`, `/n_set`, `/n_free`, `/g_new`, `/g_freeAll`, `/status`, and `/hex/jitter` are
forwarded. UDP destinations are fixed to loopback, ports 57100–57104, 57110 and
`SC_LANG_PORT` (default 57120). File-loading/writing and server shutdown commands
are not accepted. These restrictions may require changes to custom OSC setups.
Remote/LAN WebSocket connections are no longer supported.

`ws` handles framing and masking. Limits: 128 KiB per WebSocket message, 256
messages per OSC bundle, 60000 encoded bytes per UDP packet, eight authenticated
clients, 10000 messages and 8 MiB per connection per second. Compression is off.
Invalid input closes only that connection; credentials and message bodies are
not logged. Reply buffering and unfinished diagnostic requests are bounded too.

Run `yarn test:bridge` for isolated loopback security tests; no running
SuperCollider instance is needed or contacted. Standalone builds bundle `ws`
and the local validation/diagnostic modules into the executable.
