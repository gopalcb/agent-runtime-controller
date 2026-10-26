/** Bounded read-only Markdown discovery for the selected project's Work Docs page. */
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

import { BadRequestException, NotFoundException } from '@nestjs/common';

const MAX_DOCUMENT_BYTES = 512 * 1024;
const EXCLUDED_DIRECTORIES = new Set(['node_modules', 'dist', 'vendor']);
const DOCUMENT_TREE = /^(docs|plans|\.codex\/(tasks|plans))\//;

/** Keep document access within the documented project folders and exclude generated/private trees. */
function isAllowedDocument(path: string): boolean {
  return (
    /\.md$/i.test(path) &&
    !path
      .split('/')
      .some(
        (part, index) =>
          !part ||
          part === '..' ||
          EXCLUDED_DIRECTORIES.has(part) ||
          (part.startsWith('.') && !(part === '.codex' && index === 0)),
      ) &&
    (!path.includes('/') || DOCUMENT_TREE.test(path))
  );
}

/** Resolve each path component without accepting symbolic links or leaving the project. */
async function resolveDocumentPath(root: string, path: string): Promise<string> {
  if (!isAllowedDocument(path) || path.includes('\\')) {
    throw new BadRequestException('Choose a project Markdown document');
  }
  const base = await realpath(root);
  let file = base;
  for (const part of path.split('/')) {
    file = resolve(file, part);
    if ((await lstat(file)).isSymbolicLink()) {
      throw new BadRequestException('Symbolic links are excluded');
    }
  }
  if (!(await realpath(file)).startsWith(base + sep)) {
    throw new BadRequestException('Document is outside the project');
  }
  return file;
}

/** Discover a bounded Markdown index; omit files removed or made unreadable during the scan. */
export async function listDocuments(root: string) {
  const documents: { path: string; size: number; modifiedAt: string }[] = [];
  let visited = 0;
  let truncated = false;

  const collectDocuments = async (directory: string, depth: number): Promise<void> => {
    if (depth > 8) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = await readdir(resolve(root, directory), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (++visited > 5000 || documents.length >= 500) {
        truncated = true;
        return;
      }
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (
        entry.isDirectory() &&
        (['docs', 'plans', '.codex', '.codex/tasks', '.codex/plans'].includes(path) ||
          (DOCUMENT_TREE.test(path) &&
            !entry.name.startsWith('.') &&
            !EXCLUDED_DIRECTORIES.has(entry.name)))
      ) {
        await collectDocuments(path, depth + 1);
      } else if (entry.isFile() && isAllowedDocument(path)) {
        try {
          const stat = await lstat(await resolveDocumentPath(root, path));
          if (stat.size <= MAX_DOCUMENT_BYTES) {
            documents.push({ path, size: stat.size, modifiedAt: stat.mtime.toISOString() });
          }
        } catch {
          /* Changed or inaccessible files are omitted. */
        }
      }
    }
  };
  await collectDocuments('', 0);
  return {
    documents: documents.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)),
    truncated,
  };
}

/** Read a bounded regular document without following symbolic links. */
export async function readDocument(root: string, path: unknown) {
  if (typeof path !== 'string') {
    throw new BadRequestException('Document path required');
  }
  try {
    const file = await resolveDocumentPath(root, path);
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_DOCUMENT_BYTES) {
        throw new BadRequestException('Document exceeds 512 KiB or is not a file');
      }
      const bytes = Buffer.alloc(MAX_DOCUMENT_BYTES + 1);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead > MAX_DOCUMENT_BYTES) {
        throw new BadRequestException('Document exceeds 512 KiB');
      }
      return { path, content: bytes.subarray(0, bytesRead).toString('utf8') };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof BadRequestException) {
      throw error;
    }
    throw new NotFoundException('Document is unavailable');
  }
}
