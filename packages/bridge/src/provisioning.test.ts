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
      query: "login_id=intern",
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

  it("lists contacts through provisioning when the bridge supports contact lists", async () => {
    const runtime = provisioningRuntime();

    await expect(handleProvisioningHTTPProxy(runtime, { logins: new Map() }, {
      method: "GET",
      path: "/_matrix/provision/v3/contacts",
      query: "q=codex&limit=10",
    })).resolves.toMatchObject({
      body: {
        contacts: [{
          id: "intern",
          mxid: "@intern:example",
          name: "Intern",
        }],
      },
      status: 200,
    });

    expect(runtime.listContacts).toHaveBeenCalledWith({ id: "intern" }, "codex", 10);
  });

  it("does not fall back to another login when an explicit provisioning login_id is missing", async () => {
    const runtime = provisioningRuntime();

    await expect(handleProvisioningHTTPProxy(runtime, { logins: new Map() }, {
      method: "POST",
      path: "/_matrix/provision/v3/create_dm/intern",
      query: "login_id=missing",
    })).resolves.toMatchObject({
      body: {
        errcode: "M_NOT_FOUND",
        error: "Login not found",
      },
      status: 404,
    });
    await expect(handleProvisioningHTTPProxy(runtime, { logins: new Map() }, {
      method: "GET",
      path: "/_matrix/provision/v3/contacts",
      query: "login_id=missing",
    })).resolves.toMatchObject({
      body: {
        errcode: "M_NOT_FOUND",
        error: "Login not found",
      },
      status: 404,
    });

    expect(runtime.resolveIdentifier).not.toHaveBeenCalled();
    expect(runtime.listContacts).not.toHaveBeenCalled();
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
    listContacts: vi.fn(async () => ({
      contacts: [{
        ghost: { displayName: "Intern", id: "intern", mxid: "@intern:example" },
        userId: "@intern:example",
      }],
    })),
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
