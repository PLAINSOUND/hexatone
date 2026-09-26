#!/usr/bin/env bash
# Reproducible local extension of pinned SuperSonic; never edits node_modules.
# Fetch sources and install upstream npm dependencies first (see README).
set -euo pipefail
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPSTREAM_DIR="$LAB_DIR/upstream"
PLUGIN_DIR="$LAB_DIR/sc3-plugins"
test "$(git -C "$UPSTREAM_DIR" rev-parse HEAD)" = de3a28cc3d6aaf41431c48e3bd0175cbd9bd39b8
test "$(git -C "$PLUGIN_DIR" rev-parse HEAD)" = fa926d6b554acef35b2fd9deb2f996085fa86bd7
test "$(git -C "$UPSTREAM_DIR/clockwork" rev-parse HEAD)" = 11798b61e1957246760c34c27b0cd79fa6b78560

if git -C "$UPSTREAM_DIR" apply --check "$LAB_DIR/dfm1-registration.patch"; then
  git -C "$UPSTREAM_DIR" apply "$LAB_DIR/dfm1-registration.patch"
else
  # Already applied is fine; an incompatible source tree is not.
  git -C "$UPSTREAM_DIR" apply --reverse --check "$LAB_DIR/dfm1-registration.patch"
fi

# Upstream's web build recursively collects *.cpp in synth/plugins.
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
