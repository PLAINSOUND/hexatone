/** Bound text imports before FileReader/JSON parsing can monopolise the tab. */
export const MAX_TEXT_IMPORT_BYTES = 4 * 1024 * 1024;
export const MAX_TEXT_BATCH_BYTES = 32 * 1024 * 1024;
export function checkTextImportFiles(files) {
  if (files.length > 10000) throw new Error('Import at most 10000 text files at once.');
  let total = 0;
  for (const file of files) {
    const bytes = Number(file.size) || 0;
    if (bytes > MAX_TEXT_IMPORT_BYTES) throw new Error(`${file.name}: text imports are limited to 4 MiB per file.`);
    total += bytes;
  }
  if (total > MAX_TEXT_BATCH_BYTES) throw new Error('Text imports are limited to 32 MiB per selection.');
}
