/** Recompute SHA-256 entries after intentionally updating the vendor bundle. */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { relative, sep } from "node:path";

const bundlePath = new URL("../../vendor/fluidsynth/", import.meta.url);
const manifestPath = new URL("manifest.json", bundlePath);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "manifest.json") continue;
    const absolute = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) files.push(...(await listFiles(absolute)));
    else files.push(relative(bundlePath.pathname, absolute.pathname).split(sep).join("/"));
  }
  return files;
}

const files = {};
for (const path of (await listFiles(bundlePath)).sort()) {
  files[path] = createHash("sha256").update(await readFile(new URL(path, bundlePath))).digest("hex");
}
manifest.files = files;
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Updated ${Object.keys(files).length} FluidSynth asset checksums`);
