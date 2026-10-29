import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

/** Create a throwaway directory tree and return its absolute root. */
export async function makeTree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "gid-test-"));
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative.split("/").join(path.sep));
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content, "utf8");
  }
  return root;
}

/** Create a throwaway directory with the given (empty) directories. */
export async function makeDirs(dirs: string[]): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "gid-test-"));
  for (const relative of dirs) {
    await mkdir(path.join(root, relative.split("/").join(path.sep)), { recursive: true });
  }
  return root;
}

/** Remove a temp tree, ignoring failures. */
export async function cleanup(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}
