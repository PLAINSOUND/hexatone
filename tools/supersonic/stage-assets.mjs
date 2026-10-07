/** Stage checksum-verified, committed engine assets for dev and production.
 * Native compilation is only needed when maintainers update the vendor bundle.
 */
import { cp, mkdir, access, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../../", import.meta.url);
const bundle = new URL("vendor/supersonic/", root);
const manifest = JSON.parse(await readFile(new URL("manifest.json", bundle), "utf8"));
const version = manifest.version.replace(/-dfm1$/, "");
for (const name of ["node_modules/supersonic-scsynth/package.json", "vendor/supersonic/core/package.json"]) {
  const pkg = JSON.parse(await readFile(new URL(name, root), "utf8"));
  if (pkg.version !== version) throw new Error(`SuperSonic client/core version mismatch: ${name} is ${pkg.version}, expected ${version}`);
}
for (const [path, expected] of Object.entries(manifest.files)) {
  const actual = createHash("sha256").update(await readFile(new URL(path, bundle))).digest("hex");
  if (actual !== expected) throw new Error(`SuperSonic asset checksum mismatch: ${path}`);
}
const assets = [
  ["node_modules/supersonic-scsynth/dist/", "client/"],
  ["vendor/supersonic/core/", "core/"],
  ["vendor/supersonic/sources/", "sources/"],
  ["vendor/supersonic/manifest.json", "manifest.json"],
  ["vendor/supersonic/README.md", "README.md"],
];
for (const name of ["pluck", "string", "formant", "tone"]) {
  assets.push([`vendor/supersonic/synthdefs/hexlab_${name}.scsyndef`, `synthdefs/hexlab_${name}.scsyndef`]);
}
assets.push(["node_modules/supersonic-scsynth/COPYING", "CLIENT-COPYING"]);
// Check all prerequisites before changing the staged asset set.
for (const [source] of assets) await access(new URL(source, root));
await mkdir(new URL("public/supersonic/synthdefs/", root), { recursive: true });
for (const [source, target] of assets) {
  await cp(new URL(source, root), new URL(`public/supersonic/${target}`, root), { recursive: true });
}
console.log("Staged local SuperSonic + DFM1 assets in public/supersonic");
