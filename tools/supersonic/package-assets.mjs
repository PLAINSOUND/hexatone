/** Maintainer-only: package tested binaries and pinned corresponding sources. */
import { cp, mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = new URL("../../", import.meta.url);
const dest = new URL("vendor/supersonic/", root);
await mkdir(new URL("sources/", dest), { recursive: true });
// Distribute the client built from the same pinned checkout as the custom
// core, including its sources. Remove old chunks when replacing a bundle.
const upstream = new URL("tools/supersonic/upstream-092/", root);
const client = new URL("client/", dest);
await rm(new URL("dist/", client), { recursive: true, force: true });
await mkdir(new URL("dist/", client), { recursive: true });
for (const entry of await readdir(new URL("dist/", upstream), { withFileTypes: true })) {
  if (entry.isFile() && /\.(js|css|map)$/.test(entry.name)) {
    await cp(new URL(`dist/${entry.name}`, upstream), new URL(`dist/${entry.name}`, client));
  }
}
for (const name of ["chunks", "workers"]) {
  await cp(new URL(`dist/${name}/`, upstream), new URL(`dist/${name}/`, client), { recursive: true });
}
for (const name of ["package.json", "supersonic.d.ts", "LICENSE", "COPYING"]) {
  await cp(new URL(name, upstream), new URL(name, client));
}
await cp(new URL("README.npm.md", upstream), new URL("README.md", client));
await rm(new URL("core/", dest), { recursive: true, force: true });
await cp(new URL("tools/supersonic/generated/dfm1-core/", root), new URL("core/", dest), { recursive: true });
// Upstream ignores these build outputs locally; Hexatone distributes them.
await writeFile(new URL("core/.gitignore", dest), "# Runtime WASM and worker assets are intentionally vendored for GitHub Pages.\n");
await mkdir(new URL("synthdefs/", dest), { recursive: true });
for (const name of ["pluck", "string", "formant", "tone"]) {
  await cp(new URL(`tools/supersonic/generated/hexlab_${name}.scsyndef`, root), new URL(`synthdefs/hexlab_${name}.scsyndef`, dest));
}
for (const [directory, revision, name] of [
  ["upstream-092", "ae62628e3f74fc930754430ea342072bacaba6bc", "supersonic"],
  ["upstream-092/clockwork", "88bf70663f1e9635a08502c9c874d12ad73b07b9", "clockwork"],
  ["sc3-plugins", "fa926d6b554acef35b2fd9deb2f996085fa86bd7", "sc3-plugins"],
]) {
  execFileSync("git", ["-C", fileURLToPath(new URL(`tools/supersonic/${directory}`, root)), "archive", "--format=tar.gz", `--output=${fileURLToPath(new URL(`sources/${name}.tar.gz`, dest))}`, revision]);
}
for (const name of ["build-dfm1.sh", "dfm1-registration.patch", "compile.scd", "TOOLCHAIN.md"]) {
  await cp(new URL(`tools/supersonic/${name}`, root), new URL(`sources/${name}`, dest));
}
await cp(new URL("synths/SuperCollider-OSC/LumatoneSynths.scd", root), new URL("sources/LumatoneSynths.scd", dest));
const files = {};
async function hashDirectory(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) await hashDirectory(new URL(`${entry.name}/`, directory), `${path}/`);
    else if (path !== "manifest.json") files[path] = createHash("sha256").update(await readFile(new URL(entry.name, directory))).digest("hex");
  }
}
await hashDirectory(dest);
await writeFile(new URL("manifest.json", dest), JSON.stringify({ version: "0.92.0-dfm1", files }, null, 2) + "\n");
