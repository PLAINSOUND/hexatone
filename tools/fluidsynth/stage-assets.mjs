/** Verify and stage the committed FluidSynth runtime and corresponding source. */
import { cp, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";

const root = new URL("../../", import.meta.url);
const bundle = new URL("vendor/fluidsynth/", root);
const manifest = JSON.parse(await readFile(new URL("manifest.json", bundle), "utf8"));

for (const [path, expected] of Object.entries(manifest.files)) {
  const bytes = await readFile(new URL(path, bundle));
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) throw new Error(`FluidSynth asset checksum mismatch: ${path}`);
}

for (const path of Object.keys(manifest.files)) {
  const destination = new URL(`public/fluidsynth/${path}`, root);
  await mkdir(new URL(`public/fluidsynth/${dirname(path)}/`, root), { recursive: true });
  await cp(new URL(path, bundle), destination);
}
await cp(new URL("manifest.json", bundle), new URL("public/fluidsynth/manifest.json", root));

console.log(`Staged FluidSynth ${manifest.version} assets in public/fluidsynth`);
