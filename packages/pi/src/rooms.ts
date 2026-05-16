import { resolve } from "node:path";
import type { MatrixClient } from "@beeper/pickle";
import type { PicklePiBinding, PicklePiConfig, PicklePiForkMetadata, PicklePiSubagentMetadata } from "./types";
import { projectKeyForCwd, serviceBotUserId } from "./spaces";

export function bindingIdForRoom(roomId: string): string {
  return Buffer.from(roomId).toString("base64url");
}

export function sessionFileForBinding(config: PicklePiConfig, cwd: string, bindingId: string): string {
  return resolve(config.dataDir, "sessions", projectKeyForCwd(cwd), `${bindingId}.jsonl`);
}

export async function createSessionRoom(
  client: MatrixClient,
  config: PicklePiConfig,
  options: {
    cwd: string;
    domain?: string;
    fork?: PicklePiForkMetadata;
    kind?: PicklePiBinding["kind"];
    sessionName?: string;
    spaceId?: string;
    subagent?: PicklePiSubagentMetadata;
  }
): Promise<PicklePiBinding> {
  const now = Date.now();
  const result = await client.appservice.createRoom({
    invite: config.allowedUserIds ?? [],
    isDirect: false,
    name: options.sessionName ?? `Pi session: ${options.cwd}`,
    topic: `cwd: ${options.cwd}`,
    userId: serviceBotUserId(config, options.domain),
    visibility: "private",
  });
  const id = bindingIdForRoom(result.roomId);
  const binding: PicklePiBinding = {
    createdAt: now,
    cwd: options.cwd,
    id,
    mode: "headless",
    owner: "appservice",
    piGhostUserId: piGhostUserId(config, options.domain),
    piSessionFile: sessionFileForBinding(config, options.cwd, id),
    roomId: result.roomId,
    serviceBotUserId: serviceBotUserId(config, options.domain),
    updatedAt: now,
  };
  if (options.fork) binding.fork = options.fork;
  if (options.kind) binding.kind = options.kind;
  if (options.sessionName) binding.sessionName = options.sessionName;
  if (options.spaceId) binding.spaceId = options.spaceId;
  if (options.subagent) binding.subagent = options.subagent;
  return binding;
}

export function piGhostUserId(config: PicklePiConfig, domain = "localhost"): string {
  return `@${config.ghostLocalpart}:${domain}`;
}

export function createSubagentMetadata(options: {
  id: string;
  parentBinding: PicklePiBinding;
  purpose?: string;
  status?: PicklePiSubagentMetadata["status"];
  title?: string;
}): PicklePiSubagentMetadata {
  const metadata: PicklePiSubagentMetadata = {
    id: options.id,
    parentBindingId: options.parentBinding.id,
    parentRoomId: options.parentBinding.roomId,
    parentSessionFile: options.parentBinding.piSessionFile,
  };
  if (options.purpose) metadata.purpose = options.purpose;
  if (options.status) metadata.status = options.status;
  if (options.title) metadata.title = options.title;
  return metadata;
}

export function createForkMetadata(options: {
  createdAt?: number;
  forkedFromBinding?: PicklePiBinding;
  forkedFromEntryId?: string;
  newLeafId?: string;
  oldLeafId?: string;
  reason?: PicklePiForkMetadata["reason"];
}): PicklePiForkMetadata {
  const metadata: PicklePiForkMetadata = {
    createdAt: options.createdAt ?? Date.now(),
  };
  if (options.forkedFromBinding) {
    metadata.forkedFromBindingId = options.forkedFromBinding.id;
    metadata.forkedFromSessionFile = options.forkedFromBinding.piSessionFile;
  }
  if (options.forkedFromEntryId) metadata.forkedFromEntryId = options.forkedFromEntryId;
  if (options.newLeafId) metadata.newLeafId = options.newLeafId;
  if (options.oldLeafId) metadata.oldLeafId = options.oldLeafId;
  if (options.reason) metadata.reason = options.reason;
  return metadata;
}
