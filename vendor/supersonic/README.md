# Hexatone SuperSonic testing distribution

SuperSonic 0.99.0 with the original TJUGens DFM1 implementation statically linked.
Licences are in client/LICENSE, client/COPYING, core/LICENSE and core/DFM1-COPYING.
The deployed CLIENT-COPYING is retained. SuperSonic 0.99 is AGPL-3.0-or-later;
the linked scsynth and original DFM1 retain their supplied GPL licences.
The SHA-256 manifest identifies this exact asset set.

Corresponding source archives are served alongside the binaries in sources/:
- supersonic.tar.gz: ddf37085585a0aa6df6cbc4bb36689ae02b75330
- clockwork.tar.gz: d6f7b25e37cdaea9c0570e779b9b7a9fdb717965
- sc3-plugins.tar.gz: fa926d6b554acef35b2fd9deb2f996085fa86bd7

To rebuild, extract these into tools/supersonic/upstream-099,
tools/supersonic/upstream-099/clockwork and tools/supersonic/sc3-plugins respectively.
Use the toolchain listed in sources/TOOLCHAIN.md and upstream's locked npm
dependencies. sources/build-dfm1.sh records the patch, original plugin file list
and build command (its Git revision checks require Git checkouts; when using
archives, verify their manifest hashes instead). The registration and interface patches are supplied alongside the sources.
The interface patch makes the plugin dispatch table immutable for the new per-engine API;
the original DFM1 filter calculations are unchanged. See tools/supersonic/README.md in the Hexatone repository for the full
checkout-based build instructions and SynthDef compilation requirements.

The SynthDefs are compiled from sources/LumatoneSynths.scd using sources/compile.scd.
For ordinary development and deployment no native compilation is needed:
run yarn install, then yarn supersonic:assets. The matching client is vendored
alongside the custom core so both are built from the same pinned sources.
Maintainers regenerate this bundle
with node tools/supersonic/package-assets.mjs after rebuilding/testing changed DSP.
