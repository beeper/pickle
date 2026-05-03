import {
  createMatrixClient,
  type MatrixAttachment as MatrixClientAttachment,
  type MatrixClient,
  type MatrixClientEvent,
  type MatrixClientOptions,
  type MatrixEncryptedFile,
  type MatrixMessageEvent,
  type MatrixSubscription,
  type RoomInfo,
  type MatrixStore,
} from "pickle";
import type {
  Adapter,
  AdapterPostableMessage,
  Attachment,
  ChannelInfo,
  ChannelVisibility,
  ChatInstance,
  EmojiValue,
  EphemeralMessage,
  FetchOptions,
  FetchResult,
  FileUpload,
  FormattedContent,
  ListThreadsOptions,
  ListThreadsResult,
  RawMessage,
  StateAdapter,
  StreamOptions,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import type { MatrixStream } from "./streaming";
import { isBeeperHomeserver } from "./streaming";
import {
  ConsoleLogger,
  Message,
  defaultEmojiResolver,
  markdownToPlainText,
  parseMarkdown,
  type Logger,
} from "chat";
import type { Buffer } from "node:buffer";
import { MatrixFormatConverter, matrixLocalpart, type RenderedMatrixMessage } from "./format";
import {
  decodeMatrixChatThreadRef,
  encodeMatrixChatThreadRef,
  matrixChannelIdFromChatThreadId,
} from "./thread-id";
import type { MatrixAdapterConfig, MatrixChatThreadRef } from "./types";

interface RoomCacheEntry {
  isDM?: boolean;
  memberCount?: number;
  name?: string;
  raw?: Record<string, unknown>;
  topic?: string;
  visibility?: ChannelVisibility;
}

interface OutboundUpload {
  bytes: Uint8Array;
  contentType?: string;
  filename: string;
  height?: number;
  kind: "image" | "video" | "audio" | "file";
  size?: number;
  width?: number;
}

interface SlashCommandParts {
  command: string;
  text: string;
}

interface MatrixAttachmentFetchMetadata {
  matrixContentUri?: string;
  matrixEncryptedFile?: MatrixEncryptedFile;
  matrixEventId: string;
  matrixRoomId: string;
}

type MatrixAttachment = Attachment & {
  fetchMetadata?: MatrixAttachmentFetchMetadata;
  matrix?: MatrixAttachmentFetchMetadata;
};

interface MatrixChatUserInfo {
  avatarUrl?: string;
  fullName: string;
  isBot: boolean;
  userId: string;
  userName: string;
}

interface MatrixSyncResponsePayload {
  response?: unknown;
  since?: string;
}

const INVITE_JOIN_MAX_ATTEMPTS = 5;
const INVITE_JOIN_RETRY_BASE_MS = 1000;
const DEFAULT_HOMESERVER_URL = "https://matrix.beeper.com";
type MatrixRoomInfo = RoomInfo;
type MatrixMessageEventPatch = Partial<Omit<MatrixMessageEvent, "eventId" | "raw" | "roomId">>;

export class MatrixAdapter implements Adapter<MatrixChatThreadRef, MatrixMessageEvent> {
  readonly name = "matrix";
  readonly userName = "matrix";

  botUserId?: string;

  #chat: ChatInstance | null = null;
  #config: MatrixAdapterConfig;
  #client: MatrixClient | null = null;
  #formatConverter = new MatrixFormatConverter();
  #logger: Logger;
  #inviteJoinTasks = new Map<string, Promise<void>>();
  #roomCache = new Map<string, RoomCacheEntry>();
  #roomAllowlist: Set<string> | null;
  #subscription: MatrixSubscription | null = null;
  #userId: string | null = null;
  #webhookOptions: WebhookOptions | undefined;
  #isBeeperHomeserver: boolean;
  #homeserverUrl: string;

  constructor(config: MatrixAdapterConfig) {
    this.#config = config;
    this.#homeserverUrl = config.homeserver ?? DEFAULT_HOMESERVER_URL;
    this.#logger = new ConsoleLogger();
    this.#roomAllowlist = config.roomAllowlist ? new Set(config.roomAllowlist) : null;
    this.#isBeeperHomeserver = config.beeper ?? isBeeperHomeserver(this.#homeserverUrl);
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.#chat = chat;
    this.#logger = chat.getLogger("matrix");
    this.#client = await this.#resolveClient();
    await this.#subscription?.stop();
    this.#subscription = null;
    const whoami = await this.#client.whoami();
    this.#userId = whoami.userId;
    this.botUserId = whoami.userId;

    this.#subscription = await this.#client.subscribe(
      {},
      (event) => this.#handleClientEvent(event),
      { live: this.#config.sync?.enabled !== false }
    );
  }

  async disconnect(): Promise<void> {
    await this.#subscription?.stop();
    this.#subscription = null;
    await this.#client?.close();
    this.#client = null;
    this.#chat = null;
    this.#userId = null;
    delete this.botUserId;
  }

  channelIdFromThreadId(threadId: string): string {
    return matrixChannelIdFromChatThreadId(threadId);
  }

  decodeThreadId(threadId: string): MatrixChatThreadRef {
    return decodeMatrixChatThreadRef(threadId);
  }

  encodeThreadId(platformData: MatrixChatThreadRef): string {
    return encodeMatrixChatThreadRef(platformData);
  }

  async handleSyncResponse(
    payload: MatrixSyncResponsePayload,
    options?: WebhookOptions
  ): Promise<void> {
    this.#webhookOptions = options;
    try {
      const response = payload.response ?? payload;
      const applyOptions = { response };
      if (typeof payload.since === "string") {
        Object.assign(applyOptions, { since: payload.since });
      }
      await this.#requireClient().sync.applyResponse(applyOptions);
    } finally {
      this.#webhookOptions = undefined;
    }
  }

  async handleWebhook(request: Request, options?: WebhookOptions): Promise<Response> {
    const payload = await request.json() as MatrixSyncResponsePayload;
    await this.handleSyncResponse(payload, options);
    return Response.json({ ok: true });
  }

  parseMessage(raw: MatrixMessageEvent, overrideThreadId?: string): Message<MatrixMessageEvent> {
    const body = normalizeOptionalString(raw.text) ?? "";
    const formattedBody = normalizeOptionalString(raw.html);
    const threadRoot =
      raw.threadRoot ??
      (raw.relation?.type === "m.thread" ? raw.relation.eventId : undefined);

    const chatThreadRef: MatrixChatThreadRef = { roomId: raw.roomId };
    if (threadRoot) {
      chatThreadRef.eventId = threadRoot;
    }
    const threadId = overrideThreadId ?? this.encodeThreadId(chatThreadRef);
    const formatted = formattedBody
      ? this.#formatConverter.fromMatrixHTML(formattedBody)
      : parseMarkdown(body);
    const text = formattedBody ? markdownToPlainText(this.#formatConverter.fromAst(formatted)) : body;
    const attachments = this.#attachmentsFromRaw(raw);

    return new Message({
      attachments,
      author: {
        fullName: raw.sender.userId,
        isBot: "unknown",
        isMe: raw.sender.isMe ?? raw.sender.userId === this.#userId,
        userId: raw.sender.userId,
        userName: matrixLocalpart(raw.sender.userId),
      },
      formatted,
      id: raw.eventId,
      isMention: this.#isMention(raw),
      metadata: {
        dateSent: raw.timestamp ? new Date(raw.timestamp) : new Date(),
        edited: raw.edited,
      },
      raw,
      text,
      threadId,
    });
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<MatrixMessageEvent>> {
    const client = this.#requireClient();
    const parsed = this.decodeThreadId(threadId);
    const rendered = this.#formatConverter.renderPostableMessage(message);
    const uploads = await this.#collectUploads(message);
    const linkLines = this.#collectLinkOnlyAttachmentLines(message);
    const body = mergeTextAndLinks(rendered.body, linkLines);
    const formattedBody = appendFormattedLinkLines(rendered.formattedBody, linkLines);
    const replyToEventId = extractMatrixReplyToEventId(message);
    let first: RawMessage<MatrixMessageEvent> | null = null;

    if (body.length > 0) {
      const postOptions = {
        text: body,
        roomId: parsed.roomId,
      };
      if (formattedBody !== undefined) {
        Object.assign(postOptions, { html: formattedBody });
      }
      if (rendered.mentions !== undefined) {
        Object.assign(postOptions, { mentions: rendered.mentions });
      }
      if (replyToEventId !== undefined) {
        Object.assign(postOptions, { replyTo: replyToEventId });
      }
      if (parsed.eventId !== undefined) {
        Object.assign(postOptions, { threadRoot: parsed.eventId });
      }
      const raw = await client.messages.send(postOptions);
      const event: MatrixMessageEventPatch = {
        content: matrixMessageContent(rendered),
        text: body,
      };
      if (formattedBody !== undefined) event.html = formattedBody;
      if (parsed.eventId !== undefined) event.threadRoot = parsed.eventId;
      first = this.#rawMessage(raw.eventId, parsed.roomId, threadId, raw.raw, event);
    }

    for (const upload of uploads) {
      const postOptions = {
        ...upload,
        caption: upload.filename,
        roomId: parsed.roomId,
      };
      if (parsed.eventId !== undefined) {
        Object.assign(postOptions, { threadRoot: parsed.eventId });
      }
      const raw = await client.messages.sendMedia(postOptions);
      const attachment: MatrixClientAttachment = {
        filename: upload.filename,
        kind: upload.kind,
      };
      if (upload.contentType !== undefined) attachment.contentType = upload.contentType;
      if (upload.height !== undefined) attachment.height = upload.height;
      if (upload.size !== undefined) attachment.size = upload.size;
      if (upload.width !== undefined) attachment.width = upload.width;
      const event: MatrixMessageEventPatch = {
        attachments: [attachment],
        messageType: `m.${upload.kind}`,
        text: upload.filename,
      };
      if (parsed.eventId !== undefined) event.threadRoot = parsed.eventId;
      first ??= this.#rawMessage(raw.eventId, parsed.roomId, threadId, raw.raw, event);
    }

    if (!first) {
      throw new Error("Matrix message is empty");
    }
    return first;
  }

  async postEphemeral(
    threadId: string,
    userId: string,
    message: AdapterPostableMessage
  ): Promise<EphemeralMessage<MatrixMessageEvent>> {
    if (!this.#isBeeperHomeserver) {
      throw new Error("Matrix ephemeral messages require a Beeper homeserver");
    }
    const client = this.#requireClient();
    const parsed = this.decodeThreadId(threadId);
    const rendered = this.#formatConverter.renderPostableMessage(message);
    const content = matrixMessageContent(rendered);
    content["com.beeper.visible_to"] = [userId];
    const raw = await client.beeper.ephemeral.send({
      content,
      eventType: "m.room.message",
      roomId: parsed.roomId,
    });
    const rawMessage: MatrixMessageEvent = {
      attachments: [],
      class: "message",
      content,
      edited: false,
      encrypted: false,
      eventId: raw.eventId,
      kind: "message",
      messageType: "m.text",
      raw: raw.raw,
      roomId: parsed.roomId,
      sender: {
        isMe: true,
        userId: this.#userId ?? "unknown",
      },
      text: rendered.body,
      type: "m.room.message",
    };
    return {
      id: raw.eventId,
      raw: rawMessage,
      threadId,
      usedFallback: false,
    };
  }

  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<MatrixMessageEvent>> {
    const client = this.#requireClient();
    const parsed = this.decodeThreadId(threadId);
    const rendered = this.#formatConverter.renderPostableMessage(message);
    const linkLines = this.#collectLinkOnlyAttachmentLines(message);
    const editOptions = {
      eventId: messageId,
      text: mergeTextAndLinks(rendered.body, linkLines),
      roomId: parsed.roomId,
    };
    if (this.#isBeeperHomeserver) {
      Object.assign(editOptions, { content: { "com.beeper.dont_render_edited": true } });
    }
    const formattedBody = appendFormattedLinkLines(rendered.formattedBody, linkLines);
    if (formattedBody !== undefined) {
      Object.assign(editOptions, { html: formattedBody });
    }
    if (rendered.mentions !== undefined) {
      Object.assign(editOptions, { mentions: rendered.mentions });
    }
    const raw = await client.messages.edit(editOptions);
    const event: MatrixMessageEventPatch = {
      content: matrixMessageContent(rendered),
      edited: true,
      text: editOptions.text,
    };
    if (formattedBody !== undefined) event.html = formattedBody;
    return this.#rawMessage(messageId, parsed.roomId, threadId, {
      logicalEventId: messageId,
      replacementEventId: raw.eventId,
      raw: raw.raw,
    }, event);
  }

  async stream(
    threadId: string,
    textStream: MatrixStream,
    options?: StreamOptions
  ): Promise<RawMessage<MatrixMessageEvent>> {
    const parsed = this.decodeThreadId(threadId);
    const client = this.#requireClient();
    const streamOptions: Parameters<MatrixClient["streams"]["send"]>[0] = {
      mode: this.#isBeeperHomeserver ? "beeper" : "edits",
      roomId: parsed.roomId,
      stream: coerceCoreMatrixStream(textStream),
    };
    if (parsed.eventId !== undefined) {
      streamOptions.threadRoot = parsed.eventId;
    }
    if (options?.updateIntervalMs !== undefined) {
      streamOptions.updateIntervalMs = options.updateIntervalMs;
    }
    const raw = await client.streams.send(streamOptions);
    return this.#rawMessage(raw.eventId, parsed.roomId, threadId, raw.raw);
  }

  async postObject(
    threadId: string,
    kind: string,
    data: unknown
  ): Promise<RawMessage<MatrixMessageEvent>> {
    return this.postMessage(threadId, { markdown: renderObjectMarkdown(kind, data) });
  }

  async editObject(
    threadId: string,
    messageId: string,
    kind: string,
    data: unknown
  ): Promise<RawMessage<MatrixMessageEvent>> {
    return this.editMessage(threadId, messageId, { markdown: renderObjectMarkdown(kind, data) });
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const parsed = this.decodeThreadId(threadId);
    await this.#requireClient().messages.redact({
      eventId: messageId,
      roomId: parsed.roomId,
    });
  }

  async addReaction(threadId: string, messageId: string, emoji: EmojiValue | string): Promise<void> {
    const parsed = this.decodeThreadId(threadId);
    await this.#requireClient().reactions.send({
      key: defaultEmojiResolver.toGChat(emoji),
      eventId: messageId,
      roomId: parsed.roomId,
    });
  }

  async removeReaction(threadId: string, messageId: string, emoji: EmojiValue | string): Promise<void> {
    const parsed = this.decodeThreadId(threadId);
    await this.#requireClient().reactions.redact({
      key: defaultEmojiResolver.toGChat(emoji),
      eventId: messageId,
      roomId: parsed.roomId,
    });
  }

  renderFormatted(content: FormattedContent): string {
    return this.#formatConverter.fromAst(content);
  }

  async startTyping(threadId: string): Promise<void> {
    const parsed = this.decodeThreadId(threadId);
    await this.#requireClient().typing.set({
      roomId: parsed.roomId,
      timeoutMs: this.#config.typingTimeoutMs ?? 30_000,
      typing: true,
    });
  }

  async fetchMessages(
    threadId: string,
    options?: FetchOptions
  ): Promise<FetchResult<MatrixMessageEvent>> {
    const parsed = this.decodeThreadId(threadId);
    const request: {
      cursor?: string;
      direction?: "backward" | "forward";
      limit?: number;
      roomId: string;
      threadRoot?: string;
    } = {
      roomId: parsed.roomId,
    };
    if (options?.cursor !== undefined) {
      request.cursor = options.cursor;
    }
    if (options?.direction !== undefined) {
      request.direction = options.direction;
    }
    if (options?.limit !== undefined) {
      request.limit = options.limit;
    }
    if (parsed.eventId) {
      Object.assign(request, { threadRoot: parsed.eventId });
    }
    const result = await this.#requireClient().messages.list(request);
    const response: FetchResult<MatrixMessageEvent> = {
      messages: result.messages.map((event) =>
        this.#messageEventToMessage(event, parsed.eventId ? threadId : undefined)
      ),
    };
    if (result.nextCursor !== undefined) {
      response.nextCursor = result.nextCursor;
    }
    return response;
  }

  async fetchMessage(threadId: string, messageId: string): Promise<Message<MatrixMessageEvent> | null> {
    const parsed = this.decodeThreadId(threadId);
    const result = await this.#requireClient().messages.get({
      eventId: messageId,
      roomId: parsed.roomId,
    });
    return result.message
      ? this.#messageEventToMessage(result.message, parsed.eventId ? threadId : undefined)
      : null;
  }

  async fetchChannelMessages(
    channelId: string,
    options?: FetchOptions
  ): Promise<FetchResult<MatrixMessageEvent>> {
    return this.fetchMessages(this.#threadIdFromChannelId(channelId), options);
  }

  async fetchChannelInfo(channelId: string): Promise<ChannelInfo> {
    const roomId = this.#roomIdFromChannelId(channelId);
    const info = await this.#requireClient().rooms.get({ roomId });
    this.#cacheRoom(info);
    const cached = this.#roomCache.get(roomId);
    const channelInfo: ChannelInfo = {
      id: this.encodeThreadId({ roomId }),
      metadata: {
        encrypted: info.encrypted,
        joinRule: info.joinRule,
        raw: info.raw,
        roomId,
        topic: info.topic,
      },
    };
    if (cached?.visibility !== undefined) {
      channelInfo.channelVisibility = cached.visibility;
    }
    if (cached?.isDM !== undefined) {
      channelInfo.isDM = cached.isDM;
    }
    if (cached?.memberCount !== undefined) {
      channelInfo.memberCount = cached.memberCount;
    }
    if (cached?.name !== undefined) {
      channelInfo.name = cached.name;
    }
    return channelInfo;
  }

  async fetchThread(threadId: string): Promise<ThreadInfo> {
    const parsed = this.decodeThreadId(threadId);
    let cached = this.#roomCache.get(parsed.roomId);
    if (!cached) {
      const info = await this.#requireClient().rooms.get({ roomId: parsed.roomId });
      this.#cacheRoom(info);
      cached = this.#roomCache.get(parsed.roomId);
    }
    const threadInfo: ThreadInfo = {
      channelId: this.encodeThreadId({ roomId: parsed.roomId }),
      id: threadId,
      metadata: {
        roomId: parsed.roomId,
        rootEventId: parsed.eventId,
        topic: cached?.topic,
      },
    };
    if (cached?.name !== undefined) {
      threadInfo.channelName = cached.name;
    }
    if (cached?.visibility !== undefined) {
      threadInfo.channelVisibility = cached.visibility;
    }
    if (cached?.isDM !== undefined) {
      threadInfo.isDM = cached.isDM;
    }
    return threadInfo;
  }

  async listThreads(
    channelId: string,
    options: ListThreadsOptions = {}
  ): Promise<ListThreadsResult<MatrixMessageEvent>> {
    const roomId = this.#roomIdFromChannelId(channelId);
    const request = {
      roomId,
    };
    if (options.cursor !== undefined) {
      Object.assign(request, { cursor: options.cursor });
    }
    if (options.limit !== undefined) {
      Object.assign(request, { limit: options.limit });
    }
    const result = await this.#requireClient().rooms.threads.list(request);
    const threads = result.threads.map((summary) => {
      const threadId = this.encodeThreadId({ eventId: summary.root.eventId, roomId });
      const thread = {
        id: threadId,
        rootMessage: this.#messageEventToMessage(summary.root, threadId),
      };
      if (summary.lastReplyTimestamp !== undefined) {
        Object.assign(thread, { lastReplyAt: new Date(summary.lastReplyTimestamp) });
      }
      if (summary.replyCount !== undefined) {
        Object.assign(thread, { replyCount: summary.replyCount });
      }
      return thread;
    });
    const response: ListThreadsResult<MatrixMessageEvent> = {
      threads,
    };
    if (result.nextCursor !== undefined) {
      response.nextCursor = result.nextCursor;
    }
    return response;
  }

  getChannelVisibility(threadId: string): ChannelVisibility {
    return this.#roomCache.get(this.decodeThreadId(threadId).roomId)?.visibility ?? "unknown";
  }

  async getUser(userId: string) {
    const profile = await this.#requireClient().users.get({ userId });
    const fullName = profile.displayName ?? userId;
    const user: MatrixChatUserInfo = {
      fullName,
      isBot: false,
      userId,
      userName: matrixLocalpart(userId),
    };
    if (profile.avatarUrl !== undefined) {
      user.avatarUrl = profile.avatarUrl;
    }
    return user;
  }

  isDM(threadId: string): boolean {
    return this.#roomCache.get(this.decodeThreadId(threadId).roomId)?.isDM ?? false;
  }

  async openDM(userId: string): Promise<string> {
    const result = await this.#requireClient().rooms.openDM({ userId });
    const cacheEntry: RoomCacheEntry = {
      isDM: true,
      visibility: "private",
    };
    if (isRecord(result.raw)) {
      cacheEntry.raw = result.raw;
    }
    this.#roomCache.set(result.roomId, cacheEntry);
    return this.encodeThreadId({ roomId: result.roomId });
  }

  async postChannelMessage(
    channelId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<MatrixMessageEvent>> {
    return this.postMessage(this.#threadIdFromChannelId(channelId), message);
  }

  rehydrateAttachment(attachment: Attachment): Attachment {
    const matrixAttachment = attachment as MatrixAttachment;
    const metadata = matrixAttachment.matrix ?? matrixAttachment.fetchMetadata;
    if (!metadata?.matrixContentUri && !metadata?.matrixEncryptedFile) {
      return attachment;
    }
    return {
      ...attachment,
      fetchData: async () => bytesToBufferLike(await this.#downloadAttachment(metadata)),
    };
  }

  #handleClientEvent(event: MatrixClientEvent): void {
    if (!this.#chat) {
      return;
    }
    if (event.kind === "message") {
      if (event.sender.isMe || !this.#isRoomAllowed(event.roomId)) {
        return;
      }
      const message = this.#messageEventToMessage(event);
      this.#chat.processMessage(this.#asChatAdapter(), message.threadId, message, this.#webhookOptions);
      const slash = this.#parseSlashCommand(message.text);
      if (slash) {
        this.#chat.processSlashCommand(
          {
            adapter: this.#asChatAdapter(),
            channelId: this.channelIdFromThreadId(message.threadId),
            command: slash.command,
            raw: event,
            text: slash.text,
            triggerId: event.eventId,
            user: message.author,
          },
          this.#webhookOptions
        );
      }
    } else if (event.kind === "reaction") {
      if (!this.#isRoomAllowed(event.roomId)) {
        return;
      }
      this.#chat.processReaction({
        adapter: this.#asChatAdapter(),
        added: event.added,
        emoji: defaultEmojiResolver.fromGChat(event.key),
        messageId: event.relatesTo,
        raw: event,
        rawEmoji: event.key,
        threadId: this.encodeThreadId({ roomId: event.roomId }),
        user: {
          fullName: event.sender.userId,
          isBot: "unknown",
          isMe: event.sender.isMe,
          userId: event.sender.userId,
          userName: matrixLocalpart(event.sender.userId),
        },
      }, this.#webhookOptions);
    } else if (event.kind === "invite") {
      void this.#maybeAutoJoinInvite(event.roomId, event.inviter);
    } else if (event.kind === "crypto") {
      this.#logger.debug("Matrix crypto status", event);
    } else if (event.kind === "decryptionError") {
      this.#logger.debug("Matrix decryption error", { error: event.error, event: event.event });
    } else if (event.kind === "sync") {
      this.#logger.debug("Matrix sync status", event);
    } else if (event.kind === "error") {
      this.#logger.warn("Matrix core error", { error: event.error });
    }
  }

  #messageEventToMessage(
    event: MatrixMessageEvent,
    overrideThreadId?: string
  ): Message<MatrixMessageEvent> {
    return this.parseMessage(event, overrideThreadId);
  }

  #asChatAdapter(): Adapter<MatrixChatThreadRef, MatrixMessageEvent> {
    return this;
  }

  #rawMessage(
    eventId: string,
    roomId: string,
    threadId: string,
    raw: unknown,
    event?: MatrixMessageEventPatch
  ): RawMessage<MatrixMessageEvent> {
    return {
      id: eventId,
      raw: {
        attachments: [],
        class: "message",
        content: {},
        edited: false,
        encrypted: false,
        eventId,
        kind: "message",
        messageType: "m.text",
        raw,
        roomId,
        sender: {
          isMe: true,
          userId: this.#userId ?? "unknown",
        },
        text: "",
        type: "m.room.message",
        ...event,
      },
      threadId,
    };
  }

  async #resolveClient(): Promise<MatrixClient> {
    if (this.#config.client) {
      return this.#config.client;
    }
    if (this.#config.createClient) {
      return this.#config.createClient();
    }
    if (this.#config.wasmUrl || this.#config.wasmBytes || this.#config.wasmModule) {
      return createMatrixClient(this.#clientOptions());
    }
    const { createMatrixClient: createNodeMatrixClient } = await importNodeMatrixClient();
    return createNodeMatrixClient(this.#clientOptions());
  }

  #clientOptions() {
    if (!this.#config.token) {
      throw new Error("Matrix adapter requires token unless client or createClient is provided.");
    }
    const options: MatrixClientOptions = {
      homeserver: this.#homeserverUrl,
      store: this.#config.store ?? this.#chatStateStore(),
      token: this.#config.token,
    };
    if (this.#config.account !== undefined) Object.assign(options, { account: this.#config.account });
    if (this.#config.beeper !== undefined) Object.assign(options, { beeper: this.#config.beeper });
    if (this.#config.pickleKey !== undefined) Object.assign(options, { pickleKey: this.#config.pickleKey });
    if (this.#config.recoveryKey !== undefined) Object.assign(options, { recoveryKey: this.#config.recoveryKey });
    if (this.#config.verifyRecoveryOnStart !== undefined) {
      Object.assign(options, { verifyRecoveryOnStart: this.#config.verifyRecoveryOnStart });
    }
    if (this.#config.wasmBytes !== undefined) Object.assign(options, { wasmBytes: this.#config.wasmBytes });
    if (this.#config.wasmModule !== undefined) Object.assign(options, { wasmModule: this.#config.wasmModule });
    if (this.#config.wasmUrl !== undefined) Object.assign(options, { wasmUrl: this.#config.wasmUrl });
    return options;
  }

  #chatStateStore(): MatrixStore {
    if (!this.#chat) {
      throw new Error("Matrix adapter has not been initialized");
    }
    return new ChatMatrixState(this.#chat.getState(), {
      prefix:
        this.#config.storePrefix ??
        `matrix:${safeStateKeyPart(this.#homeserverUrl)}:${safeStateKeyPart(
          this.#config.account?.userId ?? "default"
        )}:`,
    });
  }

  #requireClient(): MatrixClient {
    if (!this.#client) {
      throw new Error("Matrix adapter has not been initialized");
    }
    return this.#client;
  }

  async #postMessageWithContent(
    threadId: string,
    markdown: string,
    content?: Record<string, unknown>
  ): Promise<RawMessage<MatrixMessageEvent>> {
    if (!content) {
      return this.postMessage(threadId, { markdown });
    }
    const client = this.#requireClient();
    const parsed = this.decodeThreadId(threadId);
    const rendered = this.#formatConverter.renderPostableMessage({ markdown });
    const postOptions = {
      text: rendered.body,
      content,
      roomId: parsed.roomId,
    };
    if (rendered.formattedBody !== undefined) {
      Object.assign(postOptions, { html: rendered.formattedBody });
    }
    if (parsed.eventId !== undefined) {
      Object.assign(postOptions, { threadRoot: parsed.eventId });
    }
    const raw = await client.messages.send(postOptions);
    const event: MatrixMessageEventPatch = {
      content,
      text: rendered.body,
    };
    if (rendered.formattedBody !== undefined) event.html = rendered.formattedBody;
    if (parsed.eventId !== undefined) event.threadRoot = parsed.eventId;
    return this.#rawMessage(raw.eventId, parsed.roomId, threadId, raw.raw, event);
  }

  async #editMessageWithContent(
    threadId: string,
    messageId: string,
    markdown: string,
    content: Record<string, unknown>
  ): Promise<RawMessage<MatrixMessageEvent>> {
    const client = this.#requireClient();
    const parsed = this.decodeThreadId(threadId);
    const rendered = this.#formatConverter.renderPostableMessage({ markdown });
    const editOptions = {
      eventId: messageId,
      text: rendered.body,
      content: {
        ...(this.#isBeeperHomeserver ? { "com.beeper.dont_render_edited": true } : {}),
        ...content,
      },
      roomId: parsed.roomId,
    };
    if (rendered.formattedBody !== undefined) {
      Object.assign(editOptions, { html: rendered.formattedBody });
    }
    const raw = await client.messages.edit(editOptions);
    const event: MatrixMessageEventPatch = {
      content: editOptions.content,
      edited: true,
      text: rendered.body,
    };
    if (rendered.formattedBody !== undefined) event.html = rendered.formattedBody;
    return this.#rawMessage(messageId, parsed.roomId, threadId, {
      logicalEventId: messageId,
      replacementEventId: raw.eventId,
      raw: raw.raw,
    }, event);
  }

  async #collectUploads(message: AdapterPostableMessage): Promise<OutboundUpload[]> {
    const uploads: OutboundUpload[] = [];
    for (const file of extractFilesFromMessage(message)) {
      uploads.push(await uploadFromFile(file));
    }
    for (const attachment of extractAttachmentsFromMessage(message)) {
      const upload = await uploadFromAttachment(attachment);
      if (upload) {
        uploads.push(upload);
      }
    }
    return uploads;
  }

  #collectLinkOnlyAttachmentLines(message: AdapterPostableMessage): string[] {
    return extractAttachmentsFromMessage(message)
      .filter((attachment) => attachment.url && !attachment.data && !attachment.fetchData)
      .map((attachment) => {
        const label = normalizeOptionalString(attachment.name);
        return label ? `${label}: ${attachment.url}` : attachment.url ?? "";
      })
      .filter((line) => line.length > 0);
  }

  #attachmentsFromRaw(raw: MatrixMessageEvent): Attachment[] {
    return raw.attachments.map((attachment) => this.#attachmentFromMatrix(raw, attachment));
  }

  #attachmentFromMatrix(raw: MatrixMessageEvent, attachment: MatrixClientAttachment): Attachment {
    const metadata: MatrixAttachmentFetchMetadata = {
      matrixEventId: raw.eventId,
      matrixRoomId: raw.roomId,
    };
    if (attachment.contentUri) {
      metadata.matrixContentUri = attachment.contentUri;
    }
    if (attachment.encryptedFile) {
      metadata.matrixEncryptedFile = attachment.encryptedFile;
    }
    const chatAttachment: MatrixAttachment = {
      fetchMetadata: metadata,
      matrix: metadata,
      type: attachment.kind,
    };
    if (attachment.height !== undefined) {
      chatAttachment.height = attachment.height;
    }
    if (attachment.contentType !== undefined) {
      chatAttachment.mimeType = attachment.contentType;
    }
    if (attachment.filename !== undefined) {
      chatAttachment.name = attachment.filename;
    }
    if (attachment.size !== undefined) {
      chatAttachment.size = attachment.size;
    }
    const url = attachment.contentUri ?? attachment.encryptedFile?.url;
    if (url !== undefined) {
      chatAttachment.url = url;
    }
    if (attachment.width !== undefined) {
      chatAttachment.width = attachment.width;
    }
    chatAttachment.fetchData = async () => bytesToBufferLike(await this.#downloadAttachment(metadata));
    return chatAttachment;
  }

  async #downloadAttachment(metadata: MatrixAttachmentFetchMetadata): Promise<Uint8Array> {
    const client = this.#requireClient();
    if (metadata.matrixEncryptedFile) {
      const downloaded = await client.media.downloadEncrypted({ file: metadata.matrixEncryptedFile });
      return downloaded.bytes;
    }
    if (!metadata.matrixContentUri) {
      throw new Error("Matrix attachment is missing media metadata");
    }
    const downloaded = await client.media.download({ contentUri: metadata.matrixContentUri });
    return downloaded.bytes;
  }

  #isMention(raw: MatrixMessageEvent): boolean {
    return Boolean(raw.mentions?.room || (this.#userId && raw.mentions?.userIds?.includes(this.#userId)));
  }

  #cacheRoom(info: MatrixRoomInfo): void {
    const entry: RoomCacheEntry = {
      visibility: normalizeVisibility(info.visibility, info.joinRule),
    };
    if (info.isDM !== undefined) {
      entry.isDM = info.isDM;
    }
    if (info.memberCount !== undefined) {
      entry.memberCount = info.memberCount;
    }
    if (info.name !== undefined) {
      entry.name = info.name;
    }
    if (info.raw !== undefined) {
      entry.raw = info.raw;
    }
    if (info.topic !== undefined) {
      entry.topic = info.topic;
    }
    this.#roomCache.set(info.id, entry);
  }

  #roomIdFromChannelId(channelId: string): string {
    return channelId.startsWith("matrix:") ? this.decodeThreadId(channelId).roomId : channelId;
  }

  #threadIdFromChannelId(channelId: string): string {
    const roomId = this.#roomIdFromChannelId(channelId);
    return this.encodeThreadId({ roomId });
  }

  #isRoomAllowed(roomId: string): boolean {
    if (!this.#roomAllowlist) {
      return true;
    }
    return this.#roomAllowlist.has(roomId) || this.#roomAllowlist.has(this.encodeThreadId({ roomId }));
  }

  #parseSlashCommand(text: string): SlashCommandParts | null {
    const prefix = this.#config.commandPrefix ?? "/";
    if (!prefix || !text.startsWith(prefix)) {
      return null;
    }
    const rest = text.slice(prefix.length);
    const match = /^(\S+)(?:\s+([\s\S]*))?$/u.exec(rest.trimStart());
    if (!match) {
      return null;
    }
    return {
      command: `${prefix}${match[1]}`,
      text: match[2] ?? "",
    };
  }

  async #maybeAutoJoinInvite(roomId: string, inviter?: string): Promise<void> {
    const autoJoin = this.#config.inviteAutoJoin;
    if (!autoJoin || !this.#isRoomAllowed(roomId)) {
      return;
    }
    const allowlist = autoJoin.inviterAllowlist;
    if (allowlist && allowlist.length > 0 && (!inviter || !allowlist.includes(inviter))) {
      return;
    }
    if (this.#inviteJoinTasks.has(roomId)) {
      return;
    }
    const task = this.#joinInviteWithRetry(roomId, inviter).finally(() => {
      this.#inviteJoinTasks.delete(roomId);
    });
    this.#inviteJoinTasks.set(roomId, task);
    await task;
  }

  async #joinInviteWithRetry(roomId: string, inviter?: string): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= INVITE_JOIN_MAX_ATTEMPTS; attempt += 1) {
      try {
        await this.#requireClient().rooms.join({ roomIdOrAlias: roomId });
        return;
      } catch (error) {
        lastError = error;
        if (attempt === INVITE_JOIN_MAX_ATTEMPTS || !isTransientMatrixError(error)) {
          break;
        }
        await sleep(INVITE_JOIN_RETRY_BASE_MS * attempt);
      }
    }
    this.#logger.warn("Matrix invite join failed", { error: lastError, inviter, roomId });
  }
}

interface ChatMatrixStateOptions {
  prefix: string;
}

class ChatMatrixState implements MatrixStore {
  readonly #indexKey: string;
  readonly #prefix: string;
  readonly #state: StateAdapter;

  constructor(state: StateAdapter, options: ChatMatrixStateOptions) {
    this.#state = state;
    this.#prefix = options.prefix;
    this.#indexKey = `${this.#prefix}__keys`;
  }

  async delete(key: string): Promise<void> {
    await this.#state.delete(this.#key(key));
    const keys = await this.#readIndex();
    if (keys.delete(key)) {
      await this.#writeIndex(keys);
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    const value = await this.#state.get<number[]>(this.#key(key));
    return Array.isArray(value) ? Uint8Array.from(value) : null;
  }

  async list(prefix: string): Promise<string[]> {
    return [...(await this.#readIndex())].filter((key) => key.startsWith(prefix)).sort();
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    await this.#state.set(this.#key(key), [...value]);
    const keys = await this.#readIndex();
    if (!keys.has(key)) {
      keys.add(key);
      await this.#writeIndex(keys);
    }
  }

  #key(key: string): string {
    return `${this.#prefix}${key}`;
  }

  async #readIndex(): Promise<Set<string>> {
    const keys = await this.#state.get<string[]>(this.#indexKey);
    return new Set(Array.isArray(keys) ? keys : []);
  }

  async #writeIndex(keys: Set<string>): Promise<void> {
    await this.#state.set(this.#indexKey, [...keys].sort());
  }
}

async function importNodeMatrixClient(): Promise<typeof import("pickle/node")> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string
  ) => Promise<typeof import("pickle/node")>;
  return dynamicImport("pickle/node");
}

export function createMatrixAdapter(config: MatrixAdapterConfig): MatrixAdapter {
  return new MatrixAdapter(config);
}

function isTransientMatrixError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(408|425|429|500|502|503|504)\b/.test(message) ||
    /timeout|temporar|ECONNRESET|ETIMEDOUT/i.test(message);
}

function matrixMessageContent(rendered: RenderedMatrixMessage): Record<string, unknown> {
  const content: Record<string, unknown> = {
    body: rendered.body,
    msgtype: "m.text",
  };
  if (rendered.formattedBody !== undefined) {
    content.format = "org.matrix.custom.html";
    content.formatted_body = rendered.formattedBody;
  }
  if (rendered.mentions !== undefined) {
    content["m.mentions"] = {
      room: rendered.mentions.room,
      user_ids: rendered.mentions.userIds,
    };
  }
  return stripUndefined(content);
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  ) as T;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function renderObjectMarkdown(kind: string, data: unknown): string {
  if (kind !== "plan" || !isRecord(data)) {
    return `[${kind}]`;
  }
  const title = normalizeOptionalString(readString(data, "title")) ?? "Plan";
  const tasks = Array.isArray(data.tasks) ? data.tasks.filter(isRecord) : [];
  const lines = [`**${title}**`];
  for (const task of tasks) {
    const taskTitle = normalizeOptionalString(readString(task, "title")) ?? "Task";
    const status = normalizeOptionalString(readString(task, "status")) ?? "pending";
    lines.push(`- [${status === "complete" ? "x" : " "}] ${taskTitle}`);
    const details = renderPlanContent(task.details);
    if (details) {
      lines.push(`  ${details.replace(/\n/g, "\n  ")}`);
    }
    const output = renderPlanContent(task.output);
    if (output) {
      lines.push(`  ${output.replace(/\n/g, "\n  ")}`);
    }
  }
  return lines.join("\n");
}

function renderPlanContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content.filter((item): item is string => typeof item === "string").join(" ").trim();
  }
  if (isRecord(content) && typeof content.markdown === "string") {
    return content.markdown.trim();
  }
  return "";
}

function extractFilesFromMessage(message: AdapterPostableMessage): FileUpload[] {
  if (!isRecord(message) || !Array.isArray(message.files)) {
    return [];
  }
  return message.files.filter(isFileUpload);
}

function extractAttachmentsFromMessage(message: AdapterPostableMessage): Attachment[] {
  if (!isRecord(message) || !Array.isArray(message.attachments)) {
    return [];
  }
  return message.attachments.filter(isAttachment);
}

async function uploadFromFile(file: FileUpload): Promise<OutboundUpload> {
  const bytes = await bytesFromBinary(file.data);
  const upload: OutboundUpload = {
    bytes,
    filename: file.filename,
    kind: attachmentKindFromContentType(file.mimeType),
    size: bytes.byteLength,
  };
  const contentType = normalizeOptionalString(file.mimeType);
  if (contentType !== undefined) {
    upload.contentType = contentType;
  }
  return upload;
}

async function uploadFromAttachment(attachment: Attachment): Promise<OutboundUpload | null> {
  const data = attachment.data ?? (attachment.fetchData ? await attachment.fetchData() : undefined);
  if (!data) {
    return null;
  }
  const bytes = await bytesFromBinary(data);
  const upload: OutboundUpload = {
    bytes,
    filename: normalizeOptionalString(attachment.name) ?? defaultAttachmentName(attachment),
    kind: attachmentKindFromAttachment(attachment),
    size: attachment.size ?? bytes.byteLength,
  };
  const contentType = normalizeOptionalString(attachment.mimeType);
  if (contentType !== undefined) {
    upload.contentType = contentType;
  }
  if (attachment.height !== undefined) {
    upload.height = attachment.height;
  }
  if (attachment.width !== undefined) {
    upload.width = attachment.width;
  }
  return upload;
}

function isFileUpload(value: unknown): value is FileUpload {
  return isRecord(value) && typeof value.filename === "string" && "data" in value;
}

function isAttachment(value: unknown): value is Attachment {
  return isRecord(value) && typeof value.type === "string";
}

function defaultAttachmentName(attachment: Attachment): string {
  const extension = extensionFromContentType(attachment.mimeType);
  return `${attachment.type || "file"}-${Date.now()}${extension}`;
}

function attachmentKindFromAttachment(attachment: Attachment): MatrixClientAttachment["kind"] {
  if (attachment.type === "image") {
    return "image";
  }
  if (attachment.type === "video") {
    return "video";
  }
  if (attachment.type === "audio") {
    return "audio";
  }
  return attachmentKindFromContentType(attachment.mimeType);
}

function attachmentKindFromContentType(contentType?: string): MatrixClientAttachment["kind"] {
  const normalized = contentType?.toLowerCase();
  if (normalized?.startsWith("image/")) {
    return "image";
  }
  if (normalized?.startsWith("video/")) {
    return "video";
  }
  if (normalized?.startsWith("audio/")) {
    return "audio";
  }
  return "file";
}

function normalizeVisibility(
  visibility?: MatrixRoomInfo["visibility"],
  joinRule?: string
): ChannelVisibility {
  if (visibility) {
    return visibility;
  }
  if (joinRule === "public") {
    return "workspace";
  }
  if (joinRule) {
    return "private";
  }
  return "unknown";
}

function mergeTextAndLinks(text: string, linkLines: string[]): string {
  const normalized = text.trim();
  if (linkLines.length === 0) {
    return normalized;
  }
  if (!normalized) {
    return linkLines.join("\n");
  }
  return `${normalized}\n\n${linkLines.join("\n")}`;
}

function appendFormattedLinkLines(formattedBody: string | undefined, linkLines: string[]): string | undefined {
  if (linkLines.length === 0) {
    return formattedBody;
  }
  const suffix = linkLines
    .map((line) => {
      const [label, ...rest] = line.split(": ");
      const url = rest.length > 0 ? rest.join(": ") : line;
      const text = rest.length > 0 ? `${label}: ${url}` : url;
      return `<a href="${escapeHTMLAttribute(url)}">${escapeHTML(text)}</a>`;
    })
    .join("<br>");
  return formattedBody ? `${formattedBody}<br><br>${suffix}` : suffix;
}

function extractMatrixReplyToEventId(message: AdapterPostableMessage): string | undefined {
  if (!isRecord(message)) {
    return undefined;
  }
  const value = message.matrixReplyToEventId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function* coerceCoreMatrixStream(
  stream: MatrixStream
): AsyncIterable<string | Record<string, unknown>> {
  for await (const chunk of stream) {
    if (typeof chunk === "string") {
      yield chunk;
    } else {
      yield { ...chunk };
    }
  }
}

function escapeHTML(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeHTMLAttribute(value: string): string {
  return escapeHTML(value).replaceAll("'", "&#39;");
}

async function bytesFromBinary(data: Buffer | Blob | ArrayBuffer | ArrayBufferView): Promise<Uint8Array> {
  if (isBlob(data)) {
    return new Uint8Array(await data.arrayBuffer());
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new Error("Unsupported Matrix upload data");
}

function bytesToBufferLike(bytes: Uint8Array): Buffer {
  const BufferCtor = getBufferCtor();
  return (BufferCtor ? BufferCtor.from(bytes) : bytes) as Buffer;
}

function getBufferCtor():
  | {
      from(data: Uint8Array | string, encoding?: string): Buffer;
    }
  | undefined {
  return (globalThis as { Buffer?: { from(data: Uint8Array | string, encoding?: string): Buffer } }).Buffer;
}

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== "undefined" && value instanceof Blob;
}

function readRecord(
  record: Record<string, unknown> | undefined,
  key: string
): Record<string, unknown> | undefined {
  const value = record?.[key];
  return isRecord(value) ? value : undefined;
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function normalizeOptionalString(value?: string): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function safeStateKeyPart(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9_.-]/g, "_");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extensionFromContentType(contentType?: string): string {
  switch (contentType?.toLowerCase()) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/gif":
      return ".gif";
    case "image/webp":
      return ".webp";
    case "video/mp4":
      return ".mp4";
    case "audio/mpeg":
      return ".mp3";
    case "audio/ogg":
      return ".ogg";
    default:
      return "";
  }
}
