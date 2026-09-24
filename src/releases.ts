import { hash, invariant, type Doc } from "./common.js";
import { gitTags } from "./git.js";
import { one, branch, type CollectionStore } from "./remote.js";
import { published, type Binding, type Published } from "./publish.js";
export const releaseAlias = (ref: string) => `rel-${hash(ref).slice(0, 40)}`;
export const releaseId = (ref: string) => `ref-${hash(ref)}`;
/** Only observed local tags. Absence is not deletion authority; this command never prunes. */
export async function syncTags(
  store: CollectionStore,
  binding: Binding,
  path: string,
): Promise<Doc[]> {
  const releases = await gitTags(path),
    versions = await published(store, binding),
    aliases = await store.aliases(),
    results: Doc[] = [];
  for (const release of releases) {
    const version = versions.find((v) => v.commitOid === release.oid);
    const name = releaseAlias(release.ref);
    let control: Doc = {
      id: releaseId(release.ref),
      kind: "manifest",
      role: "git-ref",
      schemaVersion: 1,
      configHash: binding.configHash,
      repoId: binding.repoId,
      indexId: binding.indexId,
      gitRef: release.ref,
      desiredOid: release.oid,
      aliasName: name,
      status: "pending",
    };
    // Save moved-ref intent first so interrupted sync cannot expose the stale target as current.
    await store.upsert("main", [control]);
    if (version) {
      const alias = aliases.find((a) => a.name === name);
      if (
        !alias ||
        alias.target !== version.tagName ||
        alias.kind !== "TAG" ||
        alias.dangling
      )
        await store.alias(name, version.tagName, !!alias);
      control = {
        ...control,
        status: "available",
        tagName: version.tagName,
        snapshotId: version.snapshotId,
      };
      await store.upsert("main", [control]);
    }
    results.push(control);
  }
  return results;
}
export async function resolveVersion(
  store: CollectionStore,
  binding: Binding,
  selector: string,
): Promise<Published> {
  const versions = await published(store, binding);
  const ref = selector.startsWith("refs/tags/")
    ? selector
    : `refs/tags/${selector}`;
  const control = await one(store, branch("main"), releaseId(ref), true);
  // Like Git import, a known tag name takes precedence over an OID spelling.
  // Its pending or invalid state must not fall back to an unrelated commit.
  if (!control && !selector.startsWith("refs/")) {
    const direct = versions.filter(
      (v) =>
        v.commitOid === selector ||
        v.tagName === selector ||
        (/^[a-f0-9]{7,64}$/.test(selector) && v.commitOid.startsWith(selector)),
    );
    if (direct.length) {
      invariant(direct.length === 1, "Ambiguous commit prefix.");
      return direct[0]!;
    }
  }
  invariant(
    control?.gitRef === ref &&
      control.repoId === binding.repoId &&
      control.indexId === binding.indexId &&
      control.configHash === binding.configHash,
    "Version is not indexed or Git tag has not been synchronized.",
  );
  invariant(
    control.status === "available",
    "Git tag target is pending; import its desired commit and run git sync-tags.",
  );
  const alias = (await store.aliases()).find(
    (a) => a.name === control.aliasName,
  );
  invariant(
    alias?.kind === "TAG" &&
      !alias.dangling &&
      alias.target === control.tagName,
    "Git tag Alias is out of sync; run git sync-tags.",
  );
  const result = versions.find(
    (v) =>
      v.commitOid === control.desiredOid &&
      v.tagName === alias.target &&
      v.snapshotId === control.snapshotId,
  );
  invariant(result, "Release target is not a published version.");
  return result;
}
