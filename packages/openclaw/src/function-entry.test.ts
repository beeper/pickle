import { describe, expect, it, vi } from "vitest";
import entry, { openClawBeeperFunctionPlugin } from "./function-entry";

describe("OpenClaw Beeper function plugin", () => {
  it("registers the Beeper CLI tool and CLI command", () => {
    const registerTool = vi.fn();
    const registerCli = vi.fn();

    openClawBeeperFunctionPlugin.register({
      registerCli,
      registerTool,
    } as never);

    expect(entry.id).toBe("beeper-cli");
    expect(registerTool).toHaveBeenCalledWith(expect.any(Function), { optional: true });
    expect(registerCli).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
      commands: ["beeper"],
      descriptors: [expect.objectContaining({ name: "beeper", hasSubcommands: true })],
    }));

    const factory = registerTool.mock.calls[0]?.[0];
    expect(factory({ sandboxed: true })).toBeNull();
    expect(factory({ sandboxed: false })).toMatchObject({ name: "beeper_cli" });
  });
});
