import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeJsonAtomic } from '../backend/state-file';

test('atomic JSON replacement preserves prior data and cleans temporary files on failures', () => {
  const directory = mkdtempSync(join(tmpdir(), 'controller-json-'));
  const path = join(directory, 'state.json');

  try {
    writeJsonAtomic(path, { revision: 1 });
    writeJsonAtomic(path, { revision: 2 });
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { revision: 2 });
    assert.equal(statSync(path).mode & 0o777, 0o600);

    const circular: { self?: unknown } = {};
    circular.self = circular;
    assert.throws(() => writeJsonAtomic(path, circular), /circular/i);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { revision: 2 });
    assert.deepEqual(readdirSync(directory), ['state.json']);

    const blocked = join(directory, 'directory');
    mkdirSync(blocked);
    assert.throws(() => writeJsonAtomic(blocked, { revision: 3 }));
    assert(statSync(blocked).isDirectory());
    assert.deepEqual(readdirSync(directory).sort(), ['directory', 'state.json']);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
