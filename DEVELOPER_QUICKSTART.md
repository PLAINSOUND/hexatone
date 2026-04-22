# Hexatone Developer Quickstart

Updated: 2026-04-20

## Requirements

- Node.js
- Yarn

This repo is configured for:

- `yarn@4.13.0`

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