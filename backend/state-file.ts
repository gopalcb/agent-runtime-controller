/** Atomic JSON replacement shared by project state and the recent-project registry. */
import { randomUUID } from 'node:crypto';
import { closeSync, openSync, renameSync, rmSync, writeFileSync } from 'node:fs';

/** Replace a caller-validated destination; never leave a partial file after a failed write. */
export function writeJsonAtomic(path: string, value: object): void {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const descriptor = openSync(temporary, 'wx', 0o600);

  try {
    try {
      writeFileSync(descriptor, JSON.stringify(value, null, 2));
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, path);
  } finally {
    // Opening happens before the try: a collision must not remove someone else's file.
    rmSync(temporary, { force: true });
  }
}
