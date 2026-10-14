import fs from 'node:fs/promises';
import path from 'node:path';

const inside = (root, target) => {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};

// Some resource copy implementations turn relative dylib links into absolute
// links back to the build machine. Recreate only links whose source resolves
// inside the native resource directory, and validate the complete plan first.
export async function makeNativeLinksPortable(source, destination) {
  const root = await fs.realpath(source), targetRoot = await fs.realpath(destination);
  const plan = [];
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const current = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(current);
      else if (entry.isSymbolicLink()) {
        const resolved = await fs.realpath(current);
        if (!inside(root, resolved)) throw Error('Native dependency escapes its resource directory: ' + current);
        const link = path.join(targetRoot, path.relative(root, current));
        const target = path.join(targetRoot, path.relative(root, resolved));
        if (!(await fs.lstat(link)).isSymbolicLink()) throw Error('Expected a packaged symbolic link: ' + link);
        if (!(await fs.lstat(target)).isFile()) throw Error('Missing packaged native dependency: ' + target);
        plan.push({ link, target });
      }
    }
  }
  await visit(root);
  for (const { link, target } of plan) {
    await fs.unlink(link);
    await fs.symlink(path.relative(path.dirname(link), target), link);
  }
  for (const { link } of plan) {
    if (!inside(targetRoot, await fs.realpath(link))) throw Error('Non-portable packaged dependency: ' + link);
  }
  return plan.length;
}
