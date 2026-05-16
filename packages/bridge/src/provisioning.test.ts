import { describe, expect, it, vi } from "vitest";
import { handleProvisioningHTTPProxy, type ProvisioningRuntime } from "./provisioning";
import type { UserLogin } from "./types";

describe("handleProvisioningHTTPProxy", () => {
  it("serves bridgev2-shaped capabilities and logins", async () => {
    const runtime = provisioningRuntime();

    await expect(handleProvisioningHTTPProxy(runtime, { logins: new Map() }, {
      method: "GET",
      path: "/_matrix/provision/v3/capabilities",
    })).resolves.toMatchObject({
      body: {
        group_creation: {},
        resolve_identifier: { createDM: true },
      },
      status: 200,
    });

    await expect(handleProvisioningHTTPProxy(runtime, { logins: new Map() }, {
      method: "GET",
      path: "/_matrix/provision/v3/logins",
    })).resolves.toMatchObject({
      body: { login_ids: ["intern"] },
      status: 200,
    });
  });

  it("creates a DM through identifier resolution", async () => {
    const runtime = provisioningRuntime();

    await expect(handleProvisioningHTTPProxy(runtime, { logins: new Map() }, {
      method: "POST",
      path: "/_matrix/provision/v3/create_dm/intern",
      query: "login_id=cloud-login-id",
    })).resolves.toMatchObject({
      body: {
        dm_room_mxid: "!sidechat:example",
        id: "intern",
        mxid: "@intern:example",
        name: "Intern",
      },
      status: 200,
    });

    expect(runtime.resolveIdentifier).toHaveBeenCalledWith({ id: "intern" }, "intern", true);
  });
});

function provisioningRuntime(): ProvisioningRuntime {
  const login: UserLogin = { id: "intern" };
  return {
    capabilities: () => ({
      provisioning: {
        groupCreation: {},
        resolveIdentifier: { createDM: true },
      },
    }),
    createLogin: vi.fn(),
    listLogins: () => [login],
    loginFlows: () => [],
    loadLogin: vi.fn(),
    requestContext: vi.fn(),
    resolveIdentifier: vi.fn(async () => ({
      ghost: { displayName: "Intern", id: "intern", mxid: "@intern:example" },
      portal: { id: "sidechat", mxid: "!sidechat:example", portalKey: { id: "sidechat", receiver: "intern" } },
      userId: "@intern:example",
    })),
  };
}
