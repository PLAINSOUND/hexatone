# Hexatone SuperSonic testing distribution

SuperSonic 0.88.0 with the original TJUGens DFM1 implementation statically linked.
Licences are in core/LICENSE, core/DFM1-COPYING and the deployed CLIENT-COPYING.
The SHA-256 manifest identifies this exact asset set.

Corresponding source archives are served alongside the binaries in sources/:
- supersonic.tar.gz: 8a82576df1e6367484ed9ea711e2cc19267f986a
- clockwork.tar.gz: 132197a41507496f28281b4f9e68b8348ef4f162
- sc3-plugins.tar.gz: fa926d6b554acef35b2fd9deb2f996085fa86bd7

To rebuild, extract these into tools/supersonic/upstream-088,
tools/supersonic/upstream-088/clockwork and tools/supersonic/sc3-plugins respectively.
Use the toolchain listed in sources/TOOLCHAIN.md and upstream's locked npm
dependencies. sources/build-dfm1.sh records the patch, original plugin file list
and build command (its Git revision checks require Git checkouts; when using
archives, verify their manifest hashes instead). The registration patch is supplied
unchanged. See tools/supersonic/README.md in the Hexatone repository for the full
checkout-based build instructions and SynthDef compilation requirements.

The SynthDefs are compiled from sources/LumatoneSynths.scd using sources/compile.scd.
For ordinary development and deployment no native compilation is needed:
run yarn install, then yarn supersonic:assets. Maintainers regenerate this bundle
with node tools/supersonic/package-assets.mjs after rebuilding/testing changed DSP.
