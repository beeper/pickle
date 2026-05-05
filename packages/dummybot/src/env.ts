import { config } from "dotenv";

export function env(name: string, fallback?: string): string | undefined {
  return process.env[name] || fallback;
}

export async function loadEnvFile(path: string | undefined): Promise<void> {
  if (!path) return;
  const result = config({ path, override: false, quiet: true });
  if (result.error && (result.error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw result.error;
  }
}
