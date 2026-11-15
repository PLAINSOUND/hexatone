/** Encode the worklet's unmodified stereo float output for offline inspection. */
export function encodeStereoWav(left, right, sampleRate) {
  const frames = Math.min(left.length, right.length);
  const buffer = new ArrayBuffer(44 + frames * 8);
  const view = new DataView(buffer);
  const string = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  string(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true);
  string(8, "WAVE"); string(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 3, true); // IEEE float: do not clip or quantize diagnostic audio.
  view.setUint16(22, 2, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 8, true); view.setUint16(32, 8, true);
  view.setUint16(34, 32, true); string(36, "data"); view.setUint32(40, frames * 8, true);
  for (let i = 0; i < frames; i++) {
    view.setFloat32(44 + i * 8, left[i], true);
    view.setFloat32(48 + i * 8, right[i], true);
  }
  return buffer;
}

export function downloadAudioClip(clip) {
  const url = URL.createObjectURL(new Blob([encodeStereoWav(clip.left, clip.right, clip.sampleRate)], { type: "audio/wav" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `hexatone-fluidsynth-click-${clip.detail.elapsedMs}ms.wav`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
