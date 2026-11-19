import { lstat, mkdir, readlink, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The Termux pattern, on purpose: the agent's home stays app-private, and the
 * big shared storages appear as siblings next to it — symlinks named the way a
 * person names them (`downloads`, `pictures`), pointing at the real Android
 * directories. Nothing is copied or moved; the agent just gets a window.
 *
 * Pure on injected facts, so the behaviour is pinned by tests without needing
 * an Android device.
 */
export interface StorageWindowOptions {
  /** The folder the symlinks appear in — the app's files dir on Android. */
  readonly base: string;
  /** Sibling name -> absolute target. */
  readonly targets: Readonly<Record<string, string>>;
  /** Probe that the shared storage is actually reachable (All files access). */
  readonly canWriteShared: () => Promise<boolean>;
}

export interface StorageWindowResult {
  readonly created: string[];
  readonly existed: string[];
  /** Human-readable reason when the window could not open. */
  readonly refused: string | null;
}

/** The Android public storages, as the app's symlinks name them. */
export const ANDROID_STORAGE_TARGETS: Readonly<Record<string, string>> = {
  shared: "/storage/emulated/0",
  downloads: "/storage/emulated/0/Download",
  dcim: "/storage/emulated/0/DCIM",
  documents: "/storage/emulated/0/Documents",
  pictures: "/storage/emulated/0/Pictures",
  music: "/storage/emulated/0/Music",
};

export async function openStorageWindow(options: StorageWindowOptions): Promise<StorageWindowResult> {
  if (!(await options.canWriteShared())) {
    return { created: [], existed: [], refused: "no access to the shared storage — grant All files access in the Android settings for this app" };
  }
  const created: string[] = [];
  const existed: string[] = [];
  await mkdir(options.base, { recursive: true });
  for (const [name, target] of Object.entries(options.targets)) {
    const link = join(options.base, name);
    try {
      const info = await lstat(link);
      // Already the right symlink: keep it. Anything else that is not a
      // symlink is the owner's own folder — left alone, reported as existing.
      if (info.isSymbolicLink()) {
        const pointsAt = await readlink(link);
        if (pointsAt === target) {
          existed.push(name);
          continue;
        }
        await rm(link, { force: true });
      } else {
        existed.push(name);
        continue;
      }
    } catch {
      // Nothing there yet — the normal case.
    }
    try {
      await readdir(target);
      await symlink(target, link, "dir");
      created.push(name);
    } catch {
      existed.push(name);
    }
  }
  return { created, existed, refused: null };
}

/** Probe used by the daemon: can this process write the shared root? */
export function sharedStorageProbe(root: string): () => Promise<boolean> {
  return async () => {
    try {
      const probe = join(root, `.roan-probe-${String(process.pid)}`);
      await writeFile(probe, "roan", "utf8");
      await rm(probe, { force: true });
      return true;
    } catch {
      return false;
    }
  };
}
