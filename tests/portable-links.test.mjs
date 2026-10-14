import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { makeNativeLinksPortable } from '../scripts/portable-links.mjs';

test('packaged libraries still resolve after removing the build source', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'juno-portable-'));
  try {
    const source = path.join(dir, 'source'), packaged = path.join(dir, 'packaged');
    await fs.mkdir(source); await fs.mkdir(packaged);
    await fs.writeFile(path.join(source, 'lib.1.dylib'), 'native-library');
    await fs.writeFile(path.join(packaged, 'lib.1.dylib'), 'native-library');
    await fs.symlink('lib.1.dylib', path.join(source, 'lib.dylib'));
    await fs.symlink(path.join(source, 'lib.1.dylib'), path.join(packaged, 'lib.dylib'));
    assert.equal(await makeNativeLinksPortable(source, packaged), 1);
    assert.equal(path.isAbsolute(await fs.readlink(path.join(packaged, 'lib.dylib'))), false);
    await fs.rm(source, { recursive: true });
    assert.equal(await fs.readFile(path.join(packaged, 'lib.dylib'), 'utf8'), 'native-library');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('external dependencies are rejected before packaged links are changed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'juno-portable-reject-'));
  try {
    const source = path.join(dir, 'source'), packaged = path.join(dir, 'packaged');
    await fs.mkdir(source); await fs.mkdir(packaged);
    await fs.writeFile(path.join(dir, 'outside'), 'external');
    await fs.symlink('../outside', path.join(source, 'lib.dylib'));
    await fs.symlink('../outside', path.join(packaged, 'lib.dylib'));
    await assert.rejects(makeNativeLinksPortable(source, packaged), /escapes/);
    assert.equal(await fs.readlink(path.join(packaged, 'lib.dylib')), '../outside');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
