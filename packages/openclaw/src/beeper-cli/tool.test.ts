import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBeeperCliTool, runBeeperCli } from "./tool";

describe("Beeper CLI function", () => {
  it("runs an explicitly configured Beeper CLI JS launcher", async () => {
    const dir = await mkdtemp(join(tmpdir(), "beeper-cli-tool-"));
    const script = join(dir, "beeper.js");
    await writeFile(script, "for (const arg of process.argv.slice(2)) console.log(arg);\n");

    await expect(runBeeperCli({
      args: ["chats", "list", "--output", "json"],
      env: { ...process.env, BEEPER_CLI: script },
    })).resolves.toMatchObject({
      args: ["chats", "list", "--output", "json"],
      code: 0,
      stdout: "chats\nlist\n--output\njson\n",
    });
  });

  it("exposes a dedicated optional tool schema", async () => {
    const tool = createBeeperCliTool();
    expect(tool).toMatchObject({
      name: "beeper_cli",
      parameters: {
        required: ["args"],
        properties: {
          args: expect.objectContaining({ type: "array" }),
        },
      },
    });
    await expect(tool.execute("call-1", { args: "chats list" })).rejects.toThrow(
      "args must be an array of strings",
    );
  });

  it("resolves the bundled beeper-cli npm launcher without PATH lookup", async () => {
    await expect(runBeeperCli({
      args: ["--help"],
      env: { ...process.env, PATH: "" },
      timeoutMs: 1,
    })).rejects.toThrow("Beeper CLI timed out");
  });
});
