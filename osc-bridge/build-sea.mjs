import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const entryFile = path.join(__dirname, "index.js");
const distDir = path.join(__dirname, "dist");
const sentinelFuse = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

function fail(message) {
  console.error(`[osc-bridge:sea] ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const pretty = [command, ...args].join(" ");
  console.log(`[osc-bridge:sea] ${pretty}`);
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    ...options,
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) fail(`Command failed: ${pretty}`);
}

function parseArgs(argv) {
  const out = { dryRun: false, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      out.dryRun = true;
    } else if (arg === "--output") {
      out.output = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "Build osc-bridge as a Node SEA executable for the current host.",
          "",
          "Usage:",
          "  yarn build-bridge",
          "  yarn build-bridge --dry-run",
          "  yarn build-bridge --output /absolute/or/relative/path",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

function defaultOutputPath() {
  const extension = process.platform === "win32" ? ".exe" : "";
  return path.join(distDir, `osc-bridge-${process.platform}-${process.arch}${extension}`);
}

function ensureSupportedNode() {
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (!Number.isFinite(major) || major < 20) {
    fail(`Node ${process.versions.node} is too old for this SEA build. Use Node 20+.`);
  }
}

function makeSeaConfig(blobPath) {
  return {
    main: entryFile,
    output: blobPath,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
  };
}

function removeSignatureIfNeeded(targetPath, dryRun) {
  if (process.platform === "darwin") {
    if (dryRun) {
      console.log(`[osc-bridge:sea] codesign --remove-signature ${targetPath}`);
      return;
    }
    run("codesign", ["--remove-signature", targetPath]);
  }
}

function signIfNeeded(targetPath, dryRun) {
  if (process.platform === "darwin") {
    if (dryRun) {
      console.log(`[osc-bridge:sea] codesign --sign - ${targetPath}`);
      return;
    }
    run("codesign", ["--sign", "-", targetPath]);
  }
}

function injectBlob(targetPath, blobPath, dryRun) {
  const args = [
    "exec",
    "postject",
    targetPath,
    "NODE_SEA_BLOB",
    blobPath,
    "--sentinel-fuse",
    sentinelFuse,
  ];
  if (process.platform === "darwin") {
    args.push("--macho-segment-name", "NODE_SEA");
  }
  if (dryRun) {
    console.log(`[osc-bridge:sea] yarn ${args.join(" ")}`);
    return;
  }
  run("yarn", args);
}

function copyNodeBinary(targetPath, dryRun) {
  if (dryRun) {
    console.log(`[osc-bridge:sea] copy ${process.execPath} -> ${targetPath}`);
    return;
  }
  fs.copyFileSync(process.execPath, targetPath);
  fs.chmodSync(targetPath, 0o755);
}

function writeConfig(configPath, blobPath, dryRun) {
  const config = makeSeaConfig(blobPath);
  const json = `${JSON.stringify(config, null, 2)}\n`;
  if (dryRun) {
    console.log(`[osc-bridge:sea] write ${configPath}`);
    console.log(json.trimEnd());
    return;
  }
  fs.writeFileSync(configPath, json, "utf8");
}

function build() {
  ensureSupportedNode();
  const args = parseArgs(process.argv.slice(2));
  const outputPath = path.resolve(args.output ?? defaultOutputPath());
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "osc-bridge-sea-"));
  const blobPath = path.join(tempDir, "osc-bridge.blob");
  const configPath = path.join(tempDir, "sea-config.json");

  if (!args.dryRun) fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  else console.log(`[osc-bridge:sea] mkdir -p ${path.dirname(outputPath)}`);

  writeConfig(configPath, blobPath, args.dryRun);

  const seaArgs = ["--experimental-sea-config", configPath];
  if (args.dryRun) {
    console.log(`[osc-bridge:sea] ${process.execPath} ${seaArgs.join(" ")}`);
  } else {
    run(process.execPath, seaArgs);
  }

  copyNodeBinary(outputPath, args.dryRun);
  removeSignatureIfNeeded(outputPath, args.dryRun);
  injectBlob(outputPath, blobPath, args.dryRun);
  signIfNeeded(outputPath, args.dryRun);

  console.log(`[osc-bridge:sea] Output: ${outputPath}`);
  if (!args.dryRun) {
    console.log("[osc-bridge:sea] Build complete. The binary is host-specific.");
  }
}

build();
