import { describe, expect, it } from "vitest";
import { helpText, parseCommand, streamCommand } from "./index";

describe("dummybot archived DummyBridge parity", () => {
  it("recognizes help aliases", () => {
    for (const input of ["help", "/help", "!help", "dummybridge help"]) {
      expect(parseCommand(input)).toEqual({ name: "help" });
    }
    expect(helpText()).toContain("approval-tagged tools");
  });

  it("rejects invalid archived command shapes", () => {
    expect(() => parseCommand("stream-tools 100 shell#fail#approval")).toThrow("conflicting final state tags");
    expect(() => parseCommand("stream-lorem 100 --finish=length --abort")).toThrow("--finish cannot be combined");
    expect(() => parseCommand("stream-random 5 --profile=nope")).toThrow("unknown profile");
    expect(() => parseCommand("stream-lorem 8193")).toThrow("character count");
  });

  it("emits lorem decorations, final state, and artificial chunk sleeps", async () => {
    const command = parseCommand("stream-lorem 120 --reasoning=40 --steps=2 --sources=1 --documents=1 --files=1 --meta --data=demo --data-transient=tmp --delay-ms=5 --chunk-chars=12 --seed=7 --finish=length");
    if (!command || command.name === "help") throw new Error("expected command");
    const parts = [];
    let sleeps = 0;
    for await (const part of streamCommand(command, { now: () => 7, sleep: async (ms) => { sleeps += ms; } })) {
      parts.push(part as Record<string, unknown>);
    }
    expect(parts.some((part) => part.type === "start-step")).toBe(true);
    expect(parts.some((part) => part.type === "reasoning-delta")).toBe(true);
    expect(parts.some((part) => part.type === "source")).toBe(true);
    expect(parts.some((part) => part.type === "source-document")).toBe(true);
    expect(parts.some((part) => part.type === "file")).toBe(true);
    expect(parts.some((part) => part.type === "data" && part.id === "demo" && part.transient === false)).toBe(true);
    expect(parts.some((part) => part.type === "data" && part.id === "tmp" && part.transient === true)).toBe(true);
    expect(parts.at(-1)).toMatchObject({ type: "finish", finishReason: "length" });
    expect(sleeps).toBeGreaterThan(0);
  });

  it("emits denied tool state", async () => {
    const command = parseCommand("stream-tools 100 shell#deny --delay-ms=0 --chunk-chars=12 --seed=3");
    if (!command || command.name === "help") throw new Error("expected command");
    const parts = [];
    for await (const part of streamCommand(command, { sleep: async () => {}, now: () => 3 })) {
      parts.push(part as Record<string, unknown>);
    }
    expect(parts.some((part) => part.type === "tool-output-denied")).toBe(true);
  });
});
