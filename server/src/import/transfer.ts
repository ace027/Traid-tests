import fs from 'node:fs';
import path from 'node:path';
import type { TransferMode } from './types.js';

const code = (err: unknown) => (err as NodeJS.ErrnoException | undefined)?.code;

/** Error codes for which a hardlink falls back to a copy. */
const LINK_FALLBACK = new Set(['EXDEV', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EMLINK', 'EACCES']);

async function exists(p: string): Promise<boolean> {
  try {
    await fs.promises.lstat(p);
    return true;
  } catch {
    return false;
  }
}

/** "name.ext" -> "name (n).ext". */
export function withSuffix(p: string, n: number): string {
  const ext = path.extname(p);
  return `${p.slice(0, p.length - ext.length)} (${n})${ext}`;
}

/** The destination itself when free, else the first free "name (n).ext". */
export async function freeDestination(dest: string): Promise<string> {
  if (!(await exists(dest))) return dest;
  for (let n = 1; n < 1000; n++) {
    const candidate = withSuffix(dest, n);
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(`No free file name for ${dest}`);
}

/** Copies without overwriting and verifies the size; a partially written destination is removed. */
async function copyVerified(src: string, dest: string, size: number): Promise<void> {
  try {
    await fs.promises.copyFile(src, dest, fs.constants.COPYFILE_EXCL);
    const copied = (await fs.promises.stat(dest)).size;
    if (copied !== size) throw new Error(`Copy of ${path.basename(src)} is incomplete: ${copied} of ${size} bytes`);
  } catch (err) {
    // EEXIST: the file belongs to someone else, never remove it
    if (code(err) !== 'EEXIST') await fs.promises.rm(dest, { force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Transfers src to dest (creating the destination folder) and returns the path actually written: an existing
 * destination gets a " (1)" style suffix. move uses rename with a copy + size check + unlink fallback across
 * devices; hardlink falls back to copy. On failure the source is untouched and no partial destination remains.
 */
export async function transferFile(src: string, dest: string, mode: TransferMode): Promise<string> {
  const { size } = await fs.promises.stat(src);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const target = await freeDestination(dest);
  if (mode === 'move') {
    try {
      await fs.promises.rename(src, target);
    } catch (err) {
      if (code(err) !== 'EXDEV') throw err;
      await copyVerified(src, target, size);
      // the copy is complete; a source that cannot be removed only leaves a duplicate behind
      await fs.promises.unlink(src).catch(() => {});
    }
  } else if (mode === 'hardlink') {
    try {
      await fs.promises.link(src, target);
    } catch (err) {
      if (!LINK_FALLBACK.has(code(err) ?? '')) throw err;
      await copyVerified(src, target, size);
    }
  } else {
    await copyVerified(src, target, size);
  }
  return target;
}
