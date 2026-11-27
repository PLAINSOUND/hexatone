/** Cache-first SoundFont file access, independent of UI and native loading. */
import { readWorkingSoundfont } from "./soundfont-storage.js";

async function readResponseWithProgress(response, onProgress) {
  const reader = response.body?.getReader?.();
  if (!reader) return response.arrayBuffer();

  const contentLength = Number(response.headers.get("content-length"));
  const total = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null;
  const target = total ? new Uint8Array(total) : null;
  const chunks = target ? null : [];
  let loaded = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (target) target.set(value, loaded);
      else chunks.push(value);
      loaded += value.byteLength;
      onProgress?.({ loaded, total });
    }
  } finally {
    reader.releaseLock?.();
  }

  if (target) {
    if (loaded !== target.byteLength) {
      throw new Error(
        `SoundFont download was incomplete (${loaded} of ${target.byteLength} bytes)`,
      );
    }
    return target.buffer;
  }

  const combined = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined.buffer;
}

export function createSoundfontSource({
  name,
  url,
  cachedBank,
  allowDownload = false,
  signal,
  onPhase,
  onCacheError,
}) {
  const source = {
    name,
    url,
    async arrayBuffer(onProgress) {
      signal?.throwIfAborted();
      source.cachedBankKey = null;
      try {
        const cached = cachedBank ?? (await readWorkingSoundfont(url));
        signal?.throwIfAborted();
        if (cached?.blob) {
          onPhase?.("Loading offline copy");
          onProgress?.({ loaded: cached.blob.size, total: cached.blob.size });
          const bytes = await cached.blob.arrayBuffer();
          signal?.throwIfAborted();
          source.cachedBankKey = url;
          source.offline = cached.offline !== false;
          return bytes;
        }
      } catch (error) {
        if (error.name === "AbortError") throw error;
        if (!allowDownload)
          throw new Error(
            "Stored copy unavailable. Click Load to download, or choose a local file.",
            { cause: error },
          );
        onCacheError?.();
      }
      if (!allowDownload)
        throw new Error("No stored copy. Click Load to download, or choose a local file.");
      onPhase?.("Downloading");
      const response = await fetch(url, { mode: "cors", signal });
      if (!response.ok) throw new Error(`SoundFont download failed (${response.status})`);
      return readResponseWithProgress(response, onProgress);
    },
  };
  return source;
}
