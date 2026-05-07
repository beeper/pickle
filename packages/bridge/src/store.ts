import type { MatrixStore, MatrixAccount, SentEvent } from "@beeper/pickle";
import type { BridgeState, BridgeStatus, Ghost, MessageRequest, Portal, UserLogin } from "./types";

export interface BridgeDataStore {
  deletePortal(portalKey: string): Promise<void>;
  getAccount(key: string): Promise<MatrixAccount | null>;
  getBridgeState(): Promise<BridgeState | null>;
  getBridgeStatus(): Promise<BridgeStatus | null>;
  getGhost(id: string): Promise<Ghost | null>;
  getMessage(key: string): Promise<SentEvent | null>;
  getMessageRequest(portalKey: string): Promise<MessageRequest | null>;
  getPortal(portalKey: string): Promise<Portal | null>;
  getPortalByMXID(mxid: string): Promise<Portal | null>;
  getUserLogin(id: string): Promise<UserLogin | null>;
  listGhosts(): Promise<Ghost[]>;
  listPortals(): Promise<Portal[]>;
  setAccount(key: string, account: MatrixAccount): Promise<void>;
  setBridgeState(state: BridgeState): Promise<void>;
  setBridgeStatus(status: BridgeStatus): Promise<void>;
  setGhost(ghost: Ghost): Promise<void>;
  setMessage(key: string, message: SentEvent): Promise<void>;
  setMessageRequest(request: MessageRequest): Promise<void>;
  setPortal(portal: Portal): Promise<void>;
  setUserLogin(login: UserLogin): Promise<void>;
}

export class MatrixBridgeDataStore implements BridgeDataStore {
  #store: MatrixStore;

  constructor(store: MatrixStore) {
    this.#store = store;
  }

  async deletePortal(portalKey: string): Promise<void> {
    const portal = await this.getPortal(portalKey);
    await this.#store.delete(key("portal", portalKey));
    if (portal?.mxid) await this.#store.delete(key("portal-mxid", portal.mxid));
  }

  getAccount(accountKey: string): Promise<MatrixAccount | null> {
    return this.#get(key("account", accountKey));
  }

  getBridgeState(): Promise<BridgeState | null> {
    return this.#get(key("bridge-state", "current"));
  }

  getBridgeStatus(): Promise<BridgeStatus | null> {
    return this.#get(key("bridge-status", "current"));
  }

  getGhost(id: string): Promise<Ghost | null> {
    return this.#get(key("ghost", id));
  }

  getMessage(messageKey: string): Promise<SentEvent | null> {
    return this.#get(key("message", messageKey));
  }

  getMessageRequest(portalKey: string): Promise<MessageRequest | null> {
    return this.#get(key("message-request", portalKey));
  }

  getPortal(portalKey: string): Promise<Portal | null> {
    return this.#get(key("portal", portalKey));
  }

  async getPortalByMXID(mxid: string): Promise<Portal | null> {
    const portalKey = await this.#get<string>(key("portal-mxid", mxid));
    return portalKey ? this.getPortal(portalKey) : null;
  }

  getUserLogin(id: string): Promise<UserLogin | null> {
    return this.#get(key("user-login", id));
  }

  async listGhosts(): Promise<Ghost[]> {
    const keys = await this.#store.list("pickle-bridge:ghost:");
    const ghosts = await Promise.all(keys.map((item) => this.#get<Ghost>(item)));
    return ghosts.filter((item): item is Ghost => item !== null);
  }

  async listPortals(): Promise<Portal[]> {
    const keys = await this.#store.list("pickle-bridge:portal:");
    const portals = await Promise.all(keys.map((item) => this.#get<Portal>(item)));
    return portals.filter((item): item is Portal => item !== null);
  }

  setAccount(accountKey: string, account: MatrixAccount): Promise<void> {
    return this.#set(key("account", accountKey), account);
  }

  setBridgeState(state: BridgeState): Promise<void> {
    return this.#set(key("bridge-state", "current"), state);
  }

  setBridgeStatus(status: BridgeStatus): Promise<void> {
    return this.#set(key("bridge-status", "current"), status);
  }

  setGhost(ghost: Ghost): Promise<void> {
    return this.#set(key("ghost", ghost.id), ghost);
  }

  setMessage(messageKey: string, message: SentEvent): Promise<void> {
    return this.#set(key("message", messageKey), message);
  }

  setMessageRequest(request: MessageRequest): Promise<void> {
    return this.#set(key("message-request", portalStoreKey(request)), request);
  }

  async setPortal(portal: Portal): Promise<void> {
    const portalKey = portalStoreKey(portal);
    await this.#set(key("portal", portalKey), portal);
    if (portal.mxid) await this.#set(key("portal-mxid", portal.mxid), portalKey);
  }

  setUserLogin(login: UserLogin): Promise<void> {
    return this.#set(key("user-login", login.id), serializableLogin(login));
  }

  async #get<T>(storageKey: string): Promise<T | null> {
    const raw = await this.#store.get(storageKey);
    return raw ? JSON.parse(new TextDecoder().decode(raw)) as T : null;
  }

  async #set(storageKey: string, value: unknown): Promise<void> {
    await this.#store.set(storageKey, new TextEncoder().encode(JSON.stringify(value)));
  }
}

export function createBridgeDataStore(store: MatrixStore): BridgeDataStore {
  return new MatrixBridgeDataStore(store);
}

export function portalStoreKey(portal: Pick<Portal, "portalKey">): string {
  return `${portal.portalKey.receiver ?? ""}\u0000${portal.portalKey.id}`;
}

function key(kind: string, id: string): string {
  return `pickle-bridge:${kind}:${id}`;
}

function serializableLogin(login: UserLogin): UserLogin {
  const { client: _client, ...rest } = login;
  return rest;
}
