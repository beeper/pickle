import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { defaultDataDir } from "./config";
import type { OpenClawAgentContact, OpenClawBridgeRegistryData, OpenClawSessionBinding, OpenClawUserContact } from "./types";

export function defaultRegistryPath(dataDir = defaultDataDir()): string {
  return resolve(dataDir, "registry.json");
}

export function emptyRegistry(): OpenClawBridgeRegistryData {
  return { agents: [], bindings: [], dedupe: {}, schemaVersion: 1, users: [] };
}

export class OpenClawBridgeRegistry {
  readonly path: string;
  #data: OpenClawBridgeRegistryData = emptyRegistry();

  constructor(path = defaultRegistryPath()) {
    this.path = path;
  }

  get data(): OpenClawBridgeRegistryData {
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

  getAgent(agentId: string): OpenClawAgentContact | undefined {
    return this.#data.agents.find((agent) => agent.agentId === agentId);
  }

  upsertAgent(agent: OpenClawAgentContact): void {
    const index = this.#data.agents.findIndex((item) => item.agentId === agent.agentId);
    if (index === -1) this.#data.agents.push(agent);
    else this.#data.agents[index] = agent;
  }

  replaceAgents(agents: OpenClawAgentContact[]): void {
    this.#data.agents = [...agents];
  }

  getUser(userId: string): OpenClawUserContact | undefined {
    return this.#data.users.find((user) => user.userId === userId);
  }

  upsertUser(user: OpenClawUserContact): void {
    const index = this.#data.users.findIndex((item) => item.userId === user.userId);
    if (index === -1) this.#data.users.push(user);
    else this.#data.users[index] = user;
  }

  getBindingById(id: string): OpenClawSessionBinding | undefined {
    return this.#data.bindings.find((binding) => binding.id === id);
  }

  getBindingByRoom(roomId: string): OpenClawSessionBinding | undefined {
    return this.#data.bindings.find((binding) => binding.roomId === roomId);
  }

  getBindingBySessionKey(sessionKey: string): OpenClawSessionBinding | undefined {
    return this.#data.bindings.find((binding) => binding.sessionKey === sessionKey);
  }

  getBindingsByAgent(agentId: string): OpenClawSessionBinding[] {
    return this.#data.bindings.filter((binding) => binding.agentId === agentId);
  }

  upsertBinding(binding: OpenClawSessionBinding): void {
    const index = this.#data.bindings.findIndex((item) => item.id === binding.id);
    if (index === -1) this.#data.bindings.push(binding);
    else this.#data.bindings[index] = binding;
  }

  updateBinding(
    id: string,
    update: (binding: OpenClawSessionBinding) => OpenClawSessionBinding
  ): OpenClawSessionBinding | undefined {
    const index = this.#data.bindings.findIndex((item) => item.id === id);
    const existing = this.#data.bindings[index];
    if (index === -1 || !existing) return undefined;
    const updated = update(existing);
    this.#data.bindings[index] = updated;
    return updated;
  }

  removeBindingByRoom(roomId: string): OpenClawSessionBinding | undefined {
    const index = this.#data.bindings.findIndex((binding) => binding.roomId === roomId);
    const existing = this.#data.bindings[index];
    if (index === -1 || !existing) return undefined;
    this.#data.bindings.splice(index, 1);
    return existing;
  }

  markDedupe(key: string, timestamp = Date.now()): void {
    this.#data.dedupe[key] = timestamp;
  }

  hasDedupe(key: string): boolean {
    return this.#data.dedupe[key] !== undefined;
  }
}

function normalizeRegistry(value: unknown): OpenClawBridgeRegistryData {
  if (!value || typeof value !== "object") return emptyRegistry();
  const data = value as Partial<OpenClawBridgeRegistryData>;
  return {
    agents: Array.isArray(data.agents) ? data.agents : [],
    bindings: Array.isArray(data.bindings) ? data.bindings : [],
    dedupe: data.dedupe && typeof data.dedupe === "object" ? data.dedupe : {},
    schemaVersion: 1,
    users: Array.isArray(data.users) ? data.users : [],
  };
}
