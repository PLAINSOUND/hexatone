/** Maintainer-only: package tested binaries and pinned corresponding sources. */
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = new URL("../../", import.meta.url);
const dest = new URL("vendor/supersonic/", root);
await mkdir(new URL("sources/", dest), { recursive: true });
await cp(new URL("tools/supersonic/generated/dfm1-core/", root), new URL("core/", dest), { recursive: true });
// Upstream ignores these build outputs locally; Hexatone distributes them.
await writeFile(new URL("core/.gitignore", dest), "# Runtime WASM and worker assets are intentionally vendored for GitHub Pages.\n");
await mkdir(new URL("synthdefs/", dest), { recursive: true });
for (const name of ["pluck", "string", "formant", "tone"]) {
  await cp(new URL(`tools/supersonic/generated/hexlab_${name}.scsyndef`, root), new URL(`synthdefs/hexlab_${name}.scsyndef`, dest));
}
for (const [directory, revision, name] of [
  ["upstream-088", "8a82576df1e6367484ed9ea711e2cc19267f986a", "supersonic"],
  ["upstream-088/clockwork", "132197a41507496f28281b4f9e68b8348ef4f162", "clockwork"],
  ["sc3-plugins", "fa926d6b554acef35b2fd9deb2f996085fa86bd7", "sc3-plugins"],
]) {
  execFileSync("git", ["-C", fileURLToPath(new URL(`tools/supersonic/${directory}`, root)), "archive", "--format=tar.gz", `--output=${fileURLToPath(new URL(`sources/${name}.tar.gz`, dest))}`, revision]);
}
for (const name of ["build-dfm1.sh", "dfm1-registration.patch", "compile.scd", "TOOLCHAIN.md"]) {
  await cp(new URL(`tools/supersonic/${name}`, root), new URL(`sources/${name}`, dest));
}
await cp(new URL("Synths/SuperCollider-OSC/LumatoneSynths.scd", root), new URL("sources/LumatoneSynths.scd", dest));
const files = {};
async function hashDirectory(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`;
    if (entry.isDirectory()) await hashDirectory(new URL(`${entry.name}/`, directory), `${path}/`);
    else if (path !== "manifest.json") files[path] = createHash("sha256").update(await readFile(new URL(entry.name, directory))).digest("hex");
  }
}
await hashDirectory(dest);
await writeFile(new URL("manifest.json", dest), JSON.stringify({ version: "0.88.0-dfm1", files }, null, 2) + "\n");
