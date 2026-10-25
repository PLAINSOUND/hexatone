/** Rebuild the bundled single-threaded runtime from a FluidSynth source tree.
 * Usage: node tools/fluidsynth/build-runtime.mjs /path/to/fluidsynth /path/to/emscripten
 * Requires CMake and initialized GCEM/Signalsmith submodules in that tree.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const source = resolve(process.argv[2]);
const sdk = resolve(process.argv[3]);
const vendor = resolve("vendor/fluidsynth");
const build = process.argv[4] ? resolve(process.argv[4]) : mkdtempSync(join(tmpdir(), "hexatone-fluid-wasm-"));
const run = (command, args, options = {}) => execFileSync(command, args, { stdio: "inherit", ...options });
const disabled = ["alsa", "aufile", "dbus", "jack", "ladspa", "libsndfile", "midishare",
  "native-dls", "network", "openmp", "oss", "pipewire", "portaudio", "pulseaudio",
  "readline", "sdl3", "threads"];
run(join(sdk, "emcmake"), ["cmake", "-S", source, "-B", build,
  "-DCMAKE_BUILD_TYPE=Release", "-DBUILD_SHARED_LIBS=OFF", "-Denable-signalsmith=ON",
  ...disabled.map(name => `-Denable-${name}=OFF`)]);
run("cmake", ["--build", build, "--target", "libfluidsynth", "-j4"]);
const adapter = join(vendor, "sources/adapter_core.cpp");
const exports = [...readFileSync(adapter, "utf8").matchAll(/^(?:void\s*\*|void|int|double|float|const char\s*\*)\s*(ps_\w+)\s*\(/gm)]
  .map(match => `_${match[1]}`);
run(join(sdk, "em++"), [adapter, join(build, "src/libfluidsynth.a"),
  `-I${join(source, "include")}`, `-I${join(build, "include")}`, "-std=c++17", "-O3",
  "-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sEXPORT_NAME=createFluidSynth",
  "-sENVIRONMENT=web,worker,node", "-sALLOW_MEMORY_GROWTH=1", "-sFORCE_FILESYSTEM=1",
  `-sEXPORTED_FUNCTIONS=${JSON.stringify([...exports, "_malloc", "_free"])}`,
  '-sEXPORTED_RUNTIME_METHODS=["FS","stringToNewUTF8","UTF8ToString","HEAP32","HEAPF32","HEAPU8"]',
  "-o", join(vendor, "fluidsynth.js")]);

// Include uncommitted implementation files in corresponding source, without
// archiving submodule .git files or local build products.
const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: source, encoding: "utf8" }).split("\0").filter(file => file && lstatSync(join(source, file)).isFile());
run("tar", ["-czf", join(vendor, "sources/fluidsynth-smoothing.tar.gz"), "--null", "-T", "-"],
  { cwd: source, input: files.join("\0") + "\0", stdio: ["pipe", "inherit", "inherit"] });
const manifestPath = join(vendor, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.version = "2.6.1-plainsound-attenuation-smoothing";
manifest.source.revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: source, encoding: "utf8" }).trim();
manifest.source.workingTreeSnapshot = "sources/fluidsynth-smoothing.tar.gz";
manifest.source.patches = [];
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
run(process.execPath, ["tools/fluidsynth/update-manifest.mjs"]);
console.log(`Runtime built in ${build}`);
