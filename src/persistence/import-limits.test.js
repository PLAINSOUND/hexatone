import { expect, it } from 'vitest';
import { checkTextImportFiles, MAX_TEXT_IMPORT_BYTES, MAX_TEXT_BATCH_BYTES } from './import-limits.js';
it('bounds individual text files and aggregate selections before reading them', () => {
  expect(() => checkTextImportFiles([{ name: 'scale.scl', size: 2000 }])).not.toThrow();
  expect(() => checkTextImportFiles([{ name: 'huge.json', size: MAX_TEXT_IMPORT_BYTES + 1 }])).toThrow('4 MiB');
  const files = Array.from({ length: MAX_TEXT_BATCH_BYTES / MAX_TEXT_IMPORT_BYTES + 1 }, () => ({ size: MAX_TEXT_IMPORT_BYTES }));
  expect(() => checkTextImportFiles(files)).toThrow('32 MiB');
  expect(() => checkTextImportFiles(Array(10001).fill({ size: 1 }))).toThrow('10000');
});
