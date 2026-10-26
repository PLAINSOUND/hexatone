#!/usr/bin/env bash
# Reproducible local extension of pinned SuperSonic; never edits node_modules.
# Fetch sources and install upstream npm dependencies first (see README).
set -euo pipefail
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPSTREAM_DIR="${HEXATONE_SUPERSONIC_UPSTREAM:-$LAB_DIR/upstream-092}"
PLUGIN_DIR="$LAB_DIR/sc3-plugins"
test "$(git -C "$UPSTREAM_DIR" rev-parse HEAD)" = ae62628e3f74fc930754430ea342072bacaba6bc
test "$(git -C "$PLUGIN_DIR" rev-parse HEAD)" = fa926d6b554acef35b2fd9deb2f996085fa86bd7
test "$(git -C "$UPSTREAM_DIR/clockwork" rev-parse HEAD)" = 88bf70663f1e9635a08502c9c874d12ad73b07b9

if git -C "$UPSTREAM_DIR" apply --check "$LAB_DIR/dfm1-registration.patch"; then
  git -C "$UPSTREAM_DIR" apply "$LAB_DIR/dfm1-registration.patch"
else
  # Already applied is fine; an incompatible source tree is not.
  git -C "$UPSTREAM_DIR" apply --reverse --check "$LAB_DIR/dfm1-registration.patch"
fi

# The registration patch also extends the CMake plugin source list.
DEST="$UPSTREAM_DIR/dsp/scsynth/synth/plugins/HexatoneDFM1"
mkdir -p "$DEST"
for file in TJUGens.cpp TJUGens.h Dfm1.cpp Dfm1.h Dfm1Lut.cpp Dfm1Lut.h NoiseGen.cpp NoiseGen.h; do
  cp "$PLUGIN_DIR/source/TJUGens/$file" "$DEST/$file"
done
cd "$UPSTREAM_DIR"
bash scripts/build-web.sh --release
mkdir -p "$LAB_DIR/generated/dfm1-core"
cp -R packages/supersonic-scsynth-core/. "$LAB_DIR/generated/dfm1-core/"
# Retain the plugin's own licence as well as the core licence in the output.
cp "$PLUGIN_DIR/license.txt" "$LAB_DIR/generated/dfm1-core/DFM1-COPYING"
