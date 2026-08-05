import fs from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const buildDir = path.join(rootDir, "build");
const docsToCopy = [
  "DEVELOPER_QUICKSTART.md",
  "usermanual.md",
];

async function main() {
  await fs.mkdir(buildDir, { recursive: true });

  for (const filename of docsToCopy) {
    const source = path.join(rootDir, filename);
    const destination = path.join(buildDir, filename);
    await fs.copyFile(source, destination);
    console.log(`Copied ${filename} -> build/${filename}`);
  }
}

main().catch((error) => {
  console.error("[copy-build-docs] Failed to copy top-level markdown docs:", error);
  process.exitCode = 1;
});
