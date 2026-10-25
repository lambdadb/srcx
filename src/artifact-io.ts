import { constants } from "node:fs";
import { copyFile, link, lstat, open, realpath } from "node:fs/promises";
import { join } from "node:path";
import { invariant } from "./common.js";

type ObjectDirectory = "objects" | "metadata";
export function requireSegmentSupport(): void {
  invariant(
    constants.O_NOFOLLOW && constants.O_NONBLOCK,
    "Segmented artifacts require no-follow file-open support.",
  );
}
export function artifactPath(
  directory: string,
  folder: ObjectDirectory,
  digest: string,
): string {
  invariant(/^[a-f0-9]{64}$/.test(digest), "Invalid artifact object digest.");
  return join(
    directory,
    folder,
    digest + (folder === "objects" ? ".jsonl" : ".json"),
  );
}
export async function artifactDirectory(
  directory: string,
  folder: ObjectDirectory,
): Promise<void> {
  requireSegmentSupport();
  const path = join(directory, folder),
    info = await lstat(path);
  invariant(
    info.isDirectory() &&
      !info.isSymbolicLink() &&
      (await realpath(path)) === join(await realpath(directory), folder),
    "Artifact objects must be a local regular directory.",
  );
}
export async function openArtifactFile(
  directory: string,
  folder: ObjectDirectory,
  part: { digest: string; byteLength: number },
) {
  requireSegmentSupport();
  const file = await open(
    artifactPath(directory, folder, part.digest),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = await file.stat();
    invariant(
      info.isFile() && info.size === part.byteLength,
      "Artifact object is not a regular file of the expected size.",
    );
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
}
export async function retainArtifactFile(
  source: string,
  target: string,
): Promise<void> {
  try {
    await link(source, target);
  } catch (error) {
    if (
      !["EXDEV", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    )
      throw error;
    await copyFile(source, target, constants.COPYFILE_EXCL);
  }
}
