import type { MatrixStore, MatrixAccount, SentEvent } from "@beeper/pickle";
import type { BridgeState, BridgeStatus, Ghost, ManagementRoom, MessageRequest, Portal, PortalKey, Reaction, UserLogin } from "./types";

export interface BridgeDataStore {
  deleteMessage(key: string): Promise<void>;
  deletePortal(portalKey: string): Promise<void>;
  deleteReaction(key: string): Promise<void>;
  deleteUserLogin(id: string): Promise<void>;
  getAccount(key: string): Promise<MatrixAccount | null>;
  getBridgeState(): Promise<BridgeState | null>;
  getBridgeStatus(): Promise<BridgeStatus | null>;
  getGhost(id: string): Promise<Ghost | null>;
  getManagementRoom(mxid: string): Promise<ManagementRoom | null>;
  getMessage(key: string): Promise<SentEvent | null>;
  getMessageRequest(portalKey: string): Promise<MessageRequest | null>;
  getPortal(portalKey: string): Promise<Portal | null>;
  getPortalByMXID(mxid: string): Promise<Portal | null>;
  getReaction(key: string): Promise<Reaction | null>;
  getUserLogin(id: string): Promise<UserLogin | null>;
  listGhosts(): Promise<Ghost[]>;
  listManagementRooms(): Promise<ManagementRoom[]>;
  listMessages(): Promise<SentEvent[]>;
  listPortals(): Promise<Portal[]>;
  listReactions(): Promise<Reaction[]>;
  listUserLogins(): Promise<UserLogin[]>;
  setAccount(key: string, account: MatrixAccount): Promise<void>;
  setBridgeState(state: BridgeState): Promise<void>;
  setBridgeStatus(status: BridgeStatus): Promise<void>;
  setGhost(ghost: Ghost): Promise<void>;
  setMessage(key: string, message: SentEvent): Promise<void>;
  setMessageRequest(request: MessageRequest): Promise<void>;
  setManagementRoom(room: ManagementRoom): Promise<void>;
  setPortal(portal: Portal): Promise<void>;
  setReaction(key: string, reaction: Reaction): Promise<void>;
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

  deleteMessage(messageKey: string): Promise<void> {
    return this.#store.delete(key("message", messageKey));
  }

  deleteReaction(reactionKey: string): Promise<void> {
    return this.#store.delete(key("reaction", reactionKey));
  }

  deleteUserLogin(id: string): Promise<void> {
    return this.#store.delete(key("user-login", id));
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

  getManagementRoom(mxid: string): Promise<ManagementRoom | null> {
    return this.#get(key("management-room", mxid));
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

  getReaction(reactionKey: string): Promise<Reaction | null> {
    return this.#get(key("reaction", reactionKey));
  }

  getUserLogin(id: string): Promise<UserLogin | null> {
    return this.#get(key("user-login", id));
  }

  async listGhosts(): Promise<Ghost[]> {
    const keys = await this.#store.list("pickle-bridge:ghost:");
    const ghosts = await Promise.all(keys.map((item) => this.#get<Ghost>(item)));
    return ghosts.filter((item): item is Ghost => item !== null);
  }

  async listManagementRooms(): Promise<ManagementRoom[]> {
    const keys = await this.#store.list("pickle-bridge:management-room:");
    const rooms = await Promise.all(keys.map((item) => this.#get<ManagementRoom>(item)));
    return rooms.filter((item): item is ManagementRoom => item !== null);
  }

  async listMessages(): Promise<SentEvent[]> {
    const keys = await this.#store.list("pickle-bridge:message:");
    const messages = await Promise.all(keys.map((item) => this.#get<SentEvent>(item)));
    return messages.filter((item): item is SentEvent => item !== null);
  }

  async listPortals(): Promise<Portal[]> {
    const keys = await this.#store.list("pickle-bridge:portal:");
    const portals = await Promise.all(keys.map((item) => this.#get<Portal>(item)));
    return portals.filter((item): item is Portal => item !== null);
  }

  async listReactions(): Promise<Reaction[]> {
    const keys = await this.#store.list("pickle-bridge:reaction:");
    const reactions = await Promise.all(keys.map((item) => this.#get<Reaction>(item)));
    return reactions.filter((item): item is Reaction => item !== null);
  }

  async listUserLogins(): Promise<UserLogin[]> {
    const keys = await this.#store.list("pickle-bridge:user-login:");
    const logins = await Promise.all(keys.map((item) => this.#get<UserLogin>(item)));
    return logins.filter((item): item is UserLogin => item !== null);
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

  setManagementRoom(room: ManagementRoom): Promise<void> {
    return this.#set(key("management-room", room.mxid), room);
  }

  async setPortal(portal: Portal): Promise<void> {
    const portalKey = portalStoreKey(portal);
    const existing = await this.getPortal(portalKey);
    await this.#set(key("portal", portalKey), portal);
    if (existing?.mxid && existing.mxid !== portal.mxid) {
      await this.#store.delete(key("portal-mxid", existing.mxid));
    }
    if (portal.mxid) await this.#set(key("portal-mxid", portal.mxid), portalKey);
  }

  setReaction(reactionKey: string, reaction: Reaction): Promise<void> {
    return this.#set(key("reaction", reactionKey), reaction);
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
  return portalKeyString(portal.portalKey);
}

export function portalKeyString(portalKey: PortalKey): string {
  return `${portalKey.receiver ?? ""}\u0000${portalKey.id}`;
}

function key(kind: string, id: string): string {
  return `pickle-bridge:${kind}:${id}`;
}

function serializableLogin(login: UserLogin): UserLogin {
  const { client: _client, ...rest } = login;
  return rest;
}
