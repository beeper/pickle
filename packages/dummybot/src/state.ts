import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class JsonState {
  #path: string;
  #dataPromise: Promise<Record<string, unknown>> | undefined;

  constructor(path: string) {
    this.#path = path;
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return (await this.#read())[key] as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    const data = await this.#read();
    data[key] = value;
    await this.#write(data);
  }

  async appendToList(key: string, value: unknown, options: { maxLength?: number } = {}): Promise<void> {
    const data = await this.#read();
    const list = Array.isArray(data[key]) ? data[key] as unknown[] : [];
    list.push(value);
    data[key] = options.maxLength ? list.slice(-options.maxLength) : list;
    await this.#write(data);
  }

  async #read(): Promise<Record<string, unknown>> {
    this.#dataPromise ??= readJson(this.#path);
    return this.#dataPromise;
  }

  async #write(data: Record<string, unknown>): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    await writeFile(this.#path, `${JSON.stringify(data, null, 2)}\n`);
  }
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}
