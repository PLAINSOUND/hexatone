# Hexatone Developer Quickstart

Updated: 2026-04-20

## Requirements

- Node.js
- Yarn

This repo is configured for:

- `yarn@4.13.0`

Tooling note:

- `vite` is a repo-local dev dependency
- do not install `vite` globally for normal repo work
- if commands like `yarn start`, `yarn start:https`, or config imports fail with
  missing `vite`, run `yarn install` in the repo first

## Clone

```sh
git clone git@github.com:PLAINSOUND/hexatone.git
cd hexatone
```

## Install

```sh
yarn install
```

## Run the app locally

```sh
yarn start
```

This starts the Vite dev server (localhost:5173).

## Run the app locally over HTTPS

Hexatone can also run the Vite dev server over HTTPS.

Expected local cert paths by default:

- `.cert/localhost.pem`
- `.cert/localhost-key.pem`

One straightforward way to create certs on macOS is `mkcert`:

```sh
mkcert -install
mkdir -p .cert
mkcert -key-file .cert/localhost-key.pem -cert-file .cert/localhost.pem localhost 127.0.0.1 ::1
```

Then start the dev server with:

```sh
yarn start:https
```

You can also point Vite at different cert files with:

- `VITE_DEV_SSL_KEY`
- `VITE_DEV_SSL_CERT`

## Run tests

```sh
yarn test
```

For watch mode:

```sh
yarn test:watch
```

## Lint

```sh
yarn lint
```

To auto-fix what ESLint can fix:

```sh
yarn lint:fix
```

## Build

```sh
yarn build
```

This runs the production Vite build and then generates the service worker.

## Preview the production build

```sh
yarn preview
```

## OSC bridge for SuperCollider power users

Hexatone includes an OSC -> SuperCollider path that expects a local WebSocket -> OSC bridge.

Run it with:

```sh
yarn osc-bridge
```

This is intended for local development and custom SuperCollider setups. It is not required for ordinary browser use.

## Typical development loop

```sh
yarn install
yarn start
```

In another terminal:

```sh
yarn test
```

Before finishing work:

```sh
yarn lint
yarn build
```
