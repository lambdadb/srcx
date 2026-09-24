// Fault-injection model, not a LambdaDB emulator or a supported storage backend.
import { hash } from "../dist/common.js";
const clone = (map) =>
  new Map([...map].map(([k, v]) => [k, structuredClone(v)]));
export class MemoryStore {
  constructor() {
    this.work = new Map([
      ["main", { docs: new Map(), parent: null, snapshotId: null }],
      [
        "checkpoint-empty",
        { docs: new Map(), parent: "main", snapshotId: null },
      ],
    ]);
    this.snapshots = new Map();
    this.pins = new Map();
    this.aliasMap = new Map();
    this.log = [];
    this.delay = 0;
    this.staleCandidates = 0;
    this.corruptCandidates = 0;
    this.failAfterWrite = false;
    this.frozen = false;
  }
  snapshot(branch) {
    const w = this.work.get(branch);
    if (!w) throw Error("Missing branch");
    const id = hash([...w.docs]);
    w.snapshotId = w.docs.size ? id : null;
    this.snapshots.set(id, clone(w.docs));
    return id;
  }
  docs(ref) {
    return ref.kind === "tag"
      ? this.snapshots.get(this.pins.get(ref.name)?.snapshotId)
      : this.work.get(ref.name)?.docs;
  }
  async fetch(ref, ids, consistent = false) {
    this.log.push({ op: "fetch", ref, ids, consistent });
    if (
      ref.kind === "branch" &&
      ref.name !== "main" &&
      !consistent &&
      ids.includes("__manifest__")
    ) {
      if (this.frozen || this.delay-- > 0) return [];
      this.snapshot(ref.name);
    }
    return ids
      .map((id) => this.docs(ref)?.get(id))
      .filter(Boolean)
      .map((d) => structuredClone(d));
  }
  async *list(ref) {
    for (const d of this.docs(ref)?.values() ?? []) yield structuredClone(d);
  }
  async upsert(branch, docs) {
    this.log.push({ op: "upsert", branch, docs: structuredClone(docs) });
    const w = this.work.get(branch);
    for (const d of docs) w.docs.set(d.id, structuredClone(d));
    if (branch === "main") this.snapshot(branch);
    if (this.failAfterWrite && branch !== "main") {
      this.failAfterWrite = false;
      throw Error("injected unknown write result");
    }
  }
  async delete(branch, ids) {
    this.log.push({ op: "delete", branch, ids: [...ids] });
    for (const id of ids) this.work.get(branch).docs.delete(id);
  }
  async branches() {
    return [...this.work].map(([name, w]) => ({
      name,
      parent: w.parent,
      snapshotId: w.snapshotId,
    }));
  }
  async branch(name, source) {
    if (this.work.has(name)) throw Error("Exists");
    const base = this.work.get(source);
    this.work.set(name, {
      parent: source,
      snapshotId: base.snapshotId,
      docs: base.snapshotId
        ? clone(this.snapshots.get(base.snapshotId))
        : new Map(),
    });
    this.log.push({ op: "branch", name, source });
  }
  async tags() {
    return [...this.pins.values()];
  }
  async tag(name, source) {
    if (this.pins.has(name)) throw Error("Tag already exists");
    let id;
    if (source.kind === "tag") id = this.pins.get(source.name).snapshotId;
    else {
      id = this.snapshot(source.name);
      if (name.startsWith("try-") && this.staleCandidates-- > 0) {
        id = "stale";
        this.snapshots.set(id, new Map());
      } else if (name.startsWith("try-") && this.corruptCandidates-- > 0) {
        const broken = clone(this.snapshots.get(id));
        const victim = [...broken.values()].find((d) => d.kind === "chunk");
        broken.delete(victim.id);
        id = "corrupt-" + id;
        this.snapshots.set(id, broken);
      }
    }
    const t = { name, snapshotId: id };
    this.pins.set(name, t);
    this.log.push({ op: "tag", name, source, snapshotId: id });
    return t;
  }
  async aliases() {
    return [...this.aliasMap.values()];
  }
  async alias(name, target, exists) {
    if (exists !== this.aliasMap.has(name))
      throw Error("Alias existence mismatch");
    this.aliasMap.set(name, { name, target, kind: "TAG", dangling: false });
  }
  async query(name, query, size) {
    const docs = [...this.docs({ kind: "tag", name }).values()];
    const clauses = query.bool ?? [{ queryString: query.queryString }];
    return docs
      .filter((d) =>
        clauses.every((c) => {
          const q = c.queryString;
          if (q.query === "kind:chunk") return d.kind === "chunk";
          const val = String(d[q.defaultField] ?? "");
          return q.defaultField === "searchText"
            ? q.query
                .split(/\s+/)
                .some((word) => val.toLowerCase().includes(word.toLowerCase()))
            : val === q.query;
        }),
      )
      .slice(0, size)
      .map((doc) => ({ doc: structuredClone(doc), score: 1 }));
  }
}
