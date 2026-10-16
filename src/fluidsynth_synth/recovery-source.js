import { readWorkingSoundfont, soundfontStorageKey } from "./soundfont-storage.js";
import { recordAudioRuntime } from "../audio/runtime-diagnostics.js";

// Reopen the stored Blob rather than relying on an overnight file-picker File.
// Do not retain another full ArrayBuffer alongside the WASM sample memory.
export async function readRecoverySoundfont(source) {
  try {
    const cached = await readWorkingSoundfont(soundfontStorageKey(source));
    if (cached?.blob) {
      const bytes = await cached.blob.arrayBuffer();
      recordAudioRuntime("fluidsynth-recovery-source", { source: "stored-copy", bytes: bytes.byteLength });
      return bytes;
    }
  } catch (error) {
    recordAudioRuntime("fluidsynth-recovery-storage-error", { error: String(error.message ?? error) });
  }
  try {
    const bytes = await source.arrayBuffer();
    recordAudioRuntime("fluidsynth-recovery-source", { source: "original", bytes: bytes.byteLength });
    return bytes;
  } catch (error) {
    recordAudioRuntime("fluidsynth-recovery-source-error", { error: String(error.message ?? error) });
    throw new Error("SoundFont recovery could not read the stored copy or original source. Reload the SoundFont file.", { cause: error });
  }
}
