import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { PicklePiBinding, PicklePiRegistryData, ProjectSpaceRecord } from "./types";
import { defaultDataDir } from "./config";

export function defaultRegistryPath(dataDir = defaultDataDir()): string {
  return resolve(dataDir, "registry.json");
}

export function emptyRegistry(): PicklePiRegistryData {
  return { bindings: [], dedupe: {}, projectSpaces: [], schemaVersion: 1 };
}

export class PicklePiRegistry {
  readonly path: string;
  #data: PicklePiRegistryData = emptyRegistry();

  constructor(path = defaultRegistryPath()) {
    this.path = path;
  }

  get data(): PicklePiRegistryData {
    return structuredClone(this.#data);
  }

  async load(): Promise<void> {
    try {
      this.#data = normalizeRegistry(JSON.parse(await readFile(this.path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.#data = emptyRegistry();
    }
  }

  async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(this.#data, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, this.path);
  }

  getBindingByRoom(roomId: string): PicklePiBinding | undefined {
    return this.#data.bindings.find((binding) => binding.roomId === roomId);
  }

  getBindingById(id: string): PicklePiBinding | undefined {
    return this.#data.bindings.find((binding) => binding.id === id);
  }

  getBindingBySessionFile(piSessionFile: string): PicklePiBinding | undefined {
    return this.#data.bindings.find((binding) => binding.piSessionFile === piSessionFile);
  }

  getBindingsByCwd(cwd: string): PicklePiBinding[] {
    return this.#data.bindings.filter((binding) => binding.cwd === cwd);
  }

  getChildBindings(parentBindingId: string): PicklePiBinding[] {
    return this.#data.bindings.filter(
      (binding) => binding.fork?.forkedFromBindingId === parentBindingId || binding.subagent?.parentBindingId === parentBindingId
    );
  }

  getSubagentBindings(parentBindingId?: string): PicklePiBinding[] {
    return this.#data.bindings.filter((binding) => {
      if (binding.kind !== "subagent" && !binding.subagent) return false;
      return parentBindingId ? binding.subagent?.parentBindingId === parentBindingId : true;
    });
  }

  upsertBinding(binding: PicklePiBinding): void {
    const index = this.#data.bindings.findIndex((item) => item.id === binding.id);
    if (index === -1) this.#data.bindings.push(binding);
    else this.#data.bindings[index] = binding;
  }

  updateBinding(id: string, update: (binding: PicklePiBinding) => PicklePiBinding): PicklePiBinding | undefined {
    const index = this.#data.bindings.findIndex((item) => item.id === id);
    if (index === -1) return undefined;
    const binding = this.#data.bindings[index];
    if (!binding) return undefined;
    const updated = update(binding);
    this.#data.bindings[index] = updated;
    return updated;
  }

  setActiveLeaf(bindingId: string, activeLeafId: string, timestamp = Date.now()): PicklePiBinding | undefined {
    return this.updateBinding(bindingId, (binding) => ({ ...binding, activeLeafId, updatedAt: timestamp }));
  }

  markDedupe(key: string, timestamp = Date.now()): void {
    this.#data.dedupe[key] = timestamp;
  }

  hasDedupe(key: string): boolean {
    return this.#data.dedupe[key] !== undefined;
  }

  getProjectSpace(projectKey: string): ProjectSpaceRecord | undefined {
    return this.#data.projectSpaces.find((space) => space.projectKey === projectKey);
  }

  upsertProjectSpace(space: ProjectSpaceRecord): void {
    const index = this.#data.projectSpaces.findIndex((item) => item.projectKey === space.projectKey);
    if (index === -1) this.#data.projectSpaces.push(space);
    else this.#data.projectSpaces[index] = space;
  }
}

function normalizeRegistry(value: unknown): PicklePiRegistryData {
  if (!value || typeof value !== "object") return emptyRegistry();
  const data = value as Partial<PicklePiRegistryData>;
  return {
    bindings: Array.isArray(data.bindings) ? data.bindings : [],
    dedupe: data.dedupe && typeof data.dedupe === "object" ? data.dedupe : {},
    projectSpaces: Array.isArray(data.projectSpaces) ? data.projectSpaces : [],
    schemaVersion: 1,
  };
}
