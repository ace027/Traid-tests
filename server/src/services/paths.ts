import fs from 'node:fs';
import path from 'node:path';
import { schema, type Db } from '../db/index.js';

/** True when child is strictly inside parent (lexically; callers pass realpaths where it matters). */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** realpath of the deepest existing ancestor of p, re-joined with the missing remainder. */
export function realpathLoose(p: string): string {
  const rest: string[] = [];
  let cur = path.resolve(p);
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...rest.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

export function realRootFolders(db: Db): { path: string; real: string }[] {
  return db
    .select()
    .from(schema.rootFolders)
    .all()
    .map((r) => ({ path: r.path, real: realpathLoose(r.path) }));
}
