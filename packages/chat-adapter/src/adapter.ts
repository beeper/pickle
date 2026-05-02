import {
  loadMatrixCore,
  startMatrixPolling,
  type LoadMatrixCoreOptions,
  type MatrixCore,
  type MatrixCoreEvent,
  type MatrixCoreInitOptions,
  type MatrixEncryptedFile,
  type MatrixFetchMessagesOptions,
  type MatrixMediaAttachment,
  type MatrixMessageEvent,
  type MatrixPollingHandle,
  type MatrixRoomInfo,
  type MatrixSendMediaMessageOptions,
  type MatrixSendMessageOptions,
} from "better-matrix-js";
import type {
  Adapter,
  AdapterPostableMessage,
  Attachment,
  ChannelInfo,
  ChannelVisibility,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FileUpload,
  FormattedContent,
  ListThreadsOptions,
  ListThreadsResult,
  RawMessage,
  StreamOptions,
  ThreadInfo,
  WebhookOptions,
} from "chat";
import type { MatrixStream } from "./streaming";
import { createMatrixStreamDriver, isBeeperHomeserver } from "./streaming";
import {
  ConsoleLogger,
  Message,
  NotImplementedError,
  defaultEmojiResolver,
  markdownToPlainText,
  parseMarkdown,
  type Logger,
} from "chat";
import type { Buffer } from "node:buffer";
import { MatrixFormatConverter, matrixLocalpart } from "./format";
import {
  decodeMatrixChatThreadRef,
  encodeMatrixChatThreadRef,
  matrixChannelIdFromChatThreadId,
} from "./thread-id";
import type { MatrixAdapterConfig, MatrixRawMessage, MatrixChatThreadRef } from "./types";

interface RoomCacheEntry {
  isDM?: boolean;
  memberCount?: number;
  name?: string;
  raw?: Record<string, unknown>;
  topic?: string;
  visibility?: ChannelVisibility;
}

interface OutboundUpload {
  bytesBase64: string;
  contentType?: string;
  filename: string;
  height?: number;
  msgtype: "m.image" | "m.video" | "m.audio" | "m.file";
  size?: number;
  width?: number;
}

interface SlashCommandParts {
  command: string;
  text: string;
}

interface MatrixAttachmentFetchMetadata {
  matrixContentUri?: string;
  matrixEncryptedFile?: string;
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

export class MatrixAdapter {
  readonly name = "matrix";
  readonly userName: string;

  botUserId?: string;

  #chat: ChatInstance | null = null;
  #config: MatrixAdapterConfig;
  #core: MatrixCore | null = null;
  #formatConverter = new MatrixFormatConverter();
  #logger: Logger;
  #inviteJoinTasks = new Map<string, Promise<void>>();
  #messageThreadIds = new Map<string, string>();
  #polling: MatrixPollingHandle | null = null;
  #roomCache = new Map<string, RoomCacheEntry>();
  #roomAllowlist: Set<string> | null;
  #unsubscribeCore: (() => void) | null = null;
  #userId: string | null = null;
  #webhookOptions: WebhookOptions | undefined;
  #isBeeperHomeserver: boolean;

  constructor(config: MatrixAdapterConfig) {
    this.#config = config;
    this.userName = config.userName ?? "matrix-bot";
    this.#logger = new ConsoleLogger();
    this.#roomAllowlist = config.roomAllowlist ? new Set(config.roomAllowlist) : null;
    this.#isBeeperHomeserver = isBeeperHomeserver(config.homeserverUrl);
  }

  async initialize(chat: ChatInstance): Promise<void> {
    this.#chat = chat;
    this.#logger = chat.getLogger("matrix");
    this.#core = await this.#resolveCore();
    this.#unsubscribeCore?.();
    this.#unsubscribeCore = this.#core.onEvent((event) => this.#handleCoreEvent(event));
    const initOptions: MatrixCoreInitOptions = {
      accessToken: this.#config.accessToken,
      homeserverUrl: this.#config.homeserverUrl,
    };
    if (this.#config.pickleKey) {
      initOptions.pickleKey = this.#config.pickleKey;
    }
    if (this.#config.recoveryKey) {
      initOptions.recoveryKey = this.#config.recoveryKey;
    }
    if (this.#config.recoveryCode) {
      initOptions.recoveryCode = this.#config.recoveryCode;
    }
    const whoami = await this.#core.init(initOptions);
    this.#userId = whoami.userId;
    this.botUserId = whoami.userId;

    if (this.#config.polling?.enabled !== false) {
      const pollingOptions: Parameters<typeof startMatrixPolling>[1] = {};
      if (this.#config.polling?.retryDelayMs !== undefined) {
        pollingOptions.retryDelayMs = this.#config.polling.retryDelayMs;
      }
      if (this.#config.polling?.timeoutMs !== undefined) {
        pollingOptions.timeoutMs = this.#config.polling.timeoutMs;
      }
      this.#polling = startMatrixPolling(this.#core, pollingOptions);
    }
  }

  async disconnect(): Promise<void> {
    await this.#polling?.stop();
    this.#polling = null;
    this.#unsubscribeCore?.();
    this.#unsubscribeCore = null;
    await this.#core?.close();
    this.#core = null;
    this.#chat = null;
    this.#messageThreadIds.clear();
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
      await this.#requireCore().applySyncResponse(applyOptions);
    } finally {
      this.#webhookOptions = undefined;
    }
  }

  parseMessage(raw: MatrixRawMessage, overrideThreadId?: string): Message<MatrixRawMessage> {
    const body = normalizeOptionalString(raw.body) ?? readString(raw.content, "body") ?? "";
    const formattedBody =
      normalizeOptionalString(raw.formattedBody) ?? readString(raw.content, "formatted_body");
    const relatesTo = readRecord(raw.content, "m.relates_to");
    const threadRoot =
      raw.threadRootEventId ??
      readString(relatesTo, "event_id") ??
      readString(relatesTo, "relates_to_event_id");

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
        fullName: raw.sender ?? "unknown",
        isBot: "unknown",
        isMe: raw.isMe ?? raw.sender === this.#userId,
        userId: raw.sender ?? "unknown",
        userName: raw.sender ? matrixLocalpart(raw.sender) : "unknown",
      },
      formatted,
      id: raw.eventId,
      isMention: this.#isMention(raw, text),
      metadata: {
        dateSent: raw.originServerTs ? new Date(raw.originServerTs) : new Date(),
        edited: raw.isEdited ?? Boolean(readRecord(raw.content, "m.new_content")),
      },
      raw,
      text,
      threadId,
    });
  }

  async postMessage(
    threadId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<MatrixRawMessage>> {
    const core = this.#requireCore();
    const parsed = this.decodeThreadId(threadId);
    const rendered = this.#formatConverter.renderPostableMessage(message);
    const uploads = await this.#collectUploads(message);
    const linkLines = this.#collectLinkOnlyAttachmentLines(message);
    const body = mergeTextAndLinks(rendered.body, linkLines);
    const formattedBody = appendFormattedLinkLines(rendered.formattedBody, linkLines);
    const replyToEventId = extractMatrixReplyToEventId(message);
    let first: RawMessage<MatrixRawMessage> | null = null;

    if (body.length > 0) {
      const postOptions: MatrixSendMessageOptions = {
        body,
        roomId: parsed.roomId,
      };
      if (formattedBody !== undefined) {
        postOptions.formattedBody = formattedBody;
      }
      if (rendered.mentions !== undefined) {
        postOptions.mentions = rendered.mentions;
      }
      if (replyToEventId !== undefined) {
        postOptions.replyToEventId = replyToEventId;
      }
      if (parsed.eventId !== undefined) {
        postOptions.threadRootEventId = parsed.eventId;
      }
      const raw = await core.postMessage(postOptions);
      first = this.#rawMessage(raw.eventId, parsed.roomId, threadId, raw.raw);
    }

    for (const upload of uploads) {
      const postOptions: MatrixSendMediaMessageOptions = {
        ...upload,
        body: upload.filename,
        roomId: parsed.roomId,
      };
      if (parsed.eventId !== undefined) {
        postOptions.threadRootEventId = parsed.eventId;
      }
      const raw = await core.postMediaMessage(postOptions);
      first ??= this.#rawMessage(raw.eventId, parsed.roomId, threadId, raw.raw);
    }

    if (!first) {
      throw new Error("Matrix message is empty");
    }
    return first;
  }

  async editMessage(
    threadId: string,
    messageId: string,
    message: AdapterPostableMessage
  ): Promise<RawMessage<MatrixRawMessage>> {
    const core = this.#requireCore();
    const parsed = this.decodeThreadId(threadId);
    const rendered = this.#formatConverter.renderPostableMessage(message);
    const linkLines = this.#collectLinkOnlyAttachmentLines(message);
    const editOptions = {
      body: mergeTextAndLinks(rendered.body, linkLines),
      messageId,
      roomId: parsed.roomId,
    };
    if (this.#isBeeperHomeserver) {
      Object.assign(editOptions, { content: { "com.beeper.dont_render_edited": true } });
    }
    const formattedBody = appendFormattedLinkLines(rendered.formattedBody, linkLines);
    if (formattedBody !== undefined) {
      Object.assign(editOptions, { formattedBody });
    }
    if (rendered.mentions !== undefined) {
      Object.assign(editOptions, { mentions: rendered.mentions });
    }
    const raw = await core.editMessage(editOptions);
    return this.#rawMessage(messageId, parsed.roomId, threadId, {
      logicalEventId: messageId,
      replacementEventId: raw.eventId,
      raw: raw.raw,
    });
  }

  async stream(
    threadId: string,
    textStream: MatrixStream,
    options?: StreamOptions
  ): Promise<RawMessage<MatrixRawMessage>> {
    const parsed = this.decodeThreadId(threadId);
    const driver = await createMatrixStreamDriver({
      core: this.#requireCore(),
      editMessage: (targetThreadId, messageId, markdown, content) =>
        content
          ? this.#editMessageWithContent(targetThreadId, messageId, markdown, content)
          : this.editMessage(targetThreadId, messageId, { markdown }),
      homeserverUrl: this.#config.homeserverUrl,
      postMessage: (targetThreadId, markdown, content) =>
        this.#postMessageWithContent(targetThreadId, markdown, content),
      roomId: parsed.roomId,
    });
    return driver.stream(threadId, textStream, options);
  }

  async postObject(
    threadId: string,
    kind: string,
    data: unknown
  ): Promise<RawMessage<MatrixRawMessage>> {
    return this.postMessage(threadId, { markdown: renderObjectMarkdown(kind, data) });
  }

  async editObject(
    threadId: string,
    messageId: string,
    kind: string,
    data: unknown
  ): Promise<RawMessage<MatrixRawMessage>> {
    return this.editMessage(threadId, messageId, { markdown: renderObjectMarkdown(kind, data) });
  }

  async deleteMessage(threadId: string, messageId: string): Promise<void> {
    const parsed = this.decodeThreadId(threadId);
    await this.#requireCore().deleteMessage({
      messageId,
      roomId: parsed.roomId,
    });
  }

  async addReaction(threadId: string, messageId: string, emoji: EmojiValue | string): Promise<void> {
    const parsed = this.decodeThreadId(threadId);
    await this.#requireCore().addReaction({
      emoji: defaultEmojiResolver.toGChat(emoji),
      messageId,
      roomId: parsed.roomId,
    });
  }

  async removeReaction(threadId: string, messageId: string, emoji: EmojiValue | string): Promise<void> {
    const parsed = this.decodeThreadId(threadId);
    await this.#requireCore().removeReaction({
      emoji: defaultEmojiResolver.toGChat(emoji),
      messageId,
      roomId: parsed.roomId,
    });
  }

  renderFormatted(content: FormattedContent): string {
    return this.#formatConverter.fromAst(content);
  }

  async startTyping(threadId: string): Promise<void> {
    const parsed = this.decodeThreadId(threadId);
    await this.#requireCore().setTyping({
      roomId: parsed.roomId,
      timeoutMs: this.#config.typingTimeoutMs ?? 30_000,
      typing: true,
    });
  }

  async fetchMessages(
    threadId: string,
    options?: FetchOptions
  ): Promise<FetchResult<MatrixRawMessage>> {
    const parsed = this.decodeThreadId(threadId);
    const request: MatrixFetchMessagesOptions = {
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
      request.threadRootEventId = parsed.eventId;
    }
    const result = await this.#requireCore().fetchMessages(request);
    const response: FetchResult<MatrixRawMessage> = {
      messages: result.messages.map((event) =>
        this.#messageEventToMessage(event, parsed.eventId ? threadId : undefined)
      ),
    };
    if (result.nextCursor !== undefined) {
      response.nextCursor = result.nextCursor;
    }
    return response;
  }

  async fetchMessage(threadId: string, messageId: string): Promise<Message<MatrixRawMessage> | null> {
    const parsed = this.decodeThreadId(threadId);
    const result = await this.#requireCore().fetchMessage({
      messageId,
      roomId: parsed.roomId,
    });
    return result.message
      ? this.#messageEventToMessage(result.message, parsed.eventId ? threadId : undefined)
      : null;
  }

  async fetchChannelMessages(
    channelId: string,
    options?: FetchOptions
  ): Promise<FetchResult<MatrixRawMessage>> {
    return this.fetchMessages(this.#threadIdFromChannelId(channelId), options);
  }

  async fetchChannelInfo(channelId: string): Promise<ChannelInfo> {
    const roomId = this.#roomIdFromChannelId(channelId);
    const info = await this.#requireCore().fetchRoom({ roomId });
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
      const info = await this.#requireCore().fetchRoom({ roomId: parsed.roomId });
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
  ): Promise<ListThreadsResult<MatrixRawMessage>> {
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
    const result = await this.#requireCore().listRoomThreads(request);
    const threads = result.threads.map((summary) => {
      const threadId = this.encodeThreadId({ eventId: summary.root.eventId, roomId });
      const thread = {
        id: threadId,
        rootMessage: this.#messageEventToMessage(summary.root, threadId),
      };
      if (summary.lastReplyTs !== undefined) {
        Object.assign(thread, { lastReplyAt: new Date(summary.lastReplyTs) });
      }
      if (summary.replyCount !== undefined) {
        Object.assign(thread, { replyCount: summary.replyCount });
      }
      return thread;
    });
    const response: ListThreadsResult<MatrixRawMessage> = {
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
    const profile = await this.#requireCore().getUser({ userId });
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
    const result = await this.#requireCore().openDM({ userId });
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
  ): Promise<RawMessage<MatrixRawMessage>> {
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

  #handleCoreEvent(event: MatrixCoreEvent): void {
    if (!this.#chat) {
      return;
    }
    if (event.type === "message") {
      if (event.event.isMe || !this.#isRoomAllowed(event.event.roomId)) {
        return;
      }
      const message = this.#messageEventToMessage(event.event);
      this.#messageThreadIds.set(message.id, message.threadId);
      this.#chat.processMessage(this.#asChatAdapter(), message.threadId, message, this.#webhookOptions);
      const slash = this.#parseSlashCommand(message.text);
      if (slash) {
        this.#chat.processSlashCommand(
          {
            adapter: this.#asChatAdapter(),
            channelId: this.channelIdFromThreadId(message.threadId),
            command: slash.command,
            raw: event.event,
            text: slash.text,
            triggerId: event.event.eventId,
            user: message.author,
          },
          this.#webhookOptions
        );
      }
    } else if (event.type === "reaction") {
      if (!this.#isRoomAllowed(event.event.roomId)) {
        return;
      }
      this.#chat.processReaction({
        adapter: this.#asChatAdapter(),
        added: event.event.added ?? true,
        emoji: defaultEmojiResolver.fromGChat(event.event.key),
        messageId: event.event.relatesToEventId,
        raw: event.event,
        rawEmoji: event.event.key,
        threadId:
          this.#messageThreadIds.get(event.event.relatesToEventId) ??
          this.encodeThreadId({ roomId: event.event.roomId }),
        user: {
          fullName: event.event.sender,
          isBot: "unknown",
          isMe: event.event.isMe ?? event.event.sender === this.#userId,
          userId: event.event.sender,
          userName: matrixLocalpart(event.event.sender),
        },
      }, this.#webhookOptions);
    } else if (event.type === "invite") {
      void this.#maybeAutoJoinInvite(event.event.roomId, event.event.inviter);
    } else if (event.type === "crypto_status") {
      this.#logger.debug("Matrix crypto status", event);
    } else if (event.type === "decryption_error") {
      this.#logger.debug("Matrix decryption error", { error: event.error, event: event.event });
    } else if (event.type === "error") {
      this.#logger.warn("Matrix core error", { error: event.error });
    }
  }

  #messageEventToMessage(
    event: MatrixMessageEvent,
    overrideThreadId?: string
  ): Message<MatrixRawMessage> {
    const raw: MatrixRawMessage = {
      body: event.body,
      content: event.content,
      eventId: event.eventId,
      msgtype: event.msgtype,
      raw: event.raw,
      roomId: event.roomId,
      sender: event.sender,
      type: event.type,
      ...(event.attachments !== undefined && { attachments: event.attachments }),
      ...(event.formattedBody !== undefined && { formattedBody: event.formattedBody }),
      ...(event.isEdited !== undefined && { isEdited: event.isEdited }),
      ...(event.isEncrypted !== undefined && { isEncrypted: event.isEncrypted }),
      ...(event.isMe !== undefined && { isMe: event.isMe }),
      ...(event.originServerTs !== undefined && { originServerTs: event.originServerTs }),
      ...(event.threadRootEventId !== undefined && { threadRootEventId: event.threadRootEventId }),
    };
    return this.parseMessage(raw, overrideThreadId);
  }

  #asChatAdapter(): Adapter<MatrixChatThreadRef, MatrixRawMessage> {
    return this as unknown as Adapter<MatrixChatThreadRef, MatrixRawMessage>;
  }

  #rawMessage(
    eventId: string,
    roomId: string,
    threadId: string,
    raw: unknown
  ): RawMessage<MatrixRawMessage> {
    return {
      id: eventId,
      raw: {
        eventId,
        raw,
        roomId,
      },
      threadId,
    };
  }

  async #resolveCore(): Promise<MatrixCore> {
    if (this.#config.core) {
      return this.#config.core;
    }
    if (this.#config.createCore) {
      return this.#config.createCore();
    }
    if (this.#config.wasmUrl || this.#config.wasmBytes || this.#config.wasmModule) {
      const options: LoadMatrixCoreOptions = {};
      if (this.#config.go) {
        options.go = this.#config.go;
      }
      if (this.#config.host) {
        options.host = this.#config.host;
      }
      if (this.#config.wasmBytes) {
        options.wasmBytes = this.#config.wasmBytes;
      }
      if (this.#config.wasmModule) {
        options.wasmModule = this.#config.wasmModule;
      }
      if (this.#config.wasmUrl) {
        options.wasmUrl = this.#config.wasmUrl;
      }
      return loadMatrixCore(options);
    }
    throw new NotImplementedError(
      "Provide core, createCore, wasmModule, wasmBytes, or wasmUrl to createMatrixAdapter()",
      "matrix"
    );
  }

  #requireCore(): MatrixCore {
    if (!this.#core) {
      throw new Error("Matrix adapter has not been initialized");
    }
    return this.#core;
  }

  async #postMessageWithContent(
    threadId: string,
    markdown: string,
    content?: Record<string, unknown>
  ): Promise<RawMessage<MatrixRawMessage>> {
    if (!content) {
      return this.postMessage(threadId, { markdown });
    }
    const core = this.#requireCore();
    const parsed = this.decodeThreadId(threadId);
    const rendered = this.#formatConverter.renderPostableMessage({ markdown });
    const postOptions: MatrixSendMessageOptions = {
      body: rendered.body,
      content,
      roomId: parsed.roomId,
    };
    if (rendered.formattedBody !== undefined) {
      postOptions.formattedBody = rendered.formattedBody;
    }
    if (parsed.eventId !== undefined) {
      postOptions.threadRootEventId = parsed.eventId;
    }
    const raw = await core.postMessage(postOptions);
    return this.#rawMessage(raw.eventId, parsed.roomId, threadId, raw.raw);
  }

  async #editMessageWithContent(
    threadId: string,
    messageId: string,
    markdown: string,
    content: Record<string, unknown>
  ): Promise<RawMessage<MatrixRawMessage>> {
    const core = this.#requireCore();
    const parsed = this.decodeThreadId(threadId);
    const rendered = this.#formatConverter.renderPostableMessage({ markdown });
    const editOptions: Parameters<MatrixCore["editMessage"]>[0] = {
      body: rendered.body,
      content: {
        ...(this.#isBeeperHomeserver ? { "com.beeper.dont_render_edited": true } : {}),
        ...content,
      },
      messageId,
      roomId: parsed.roomId,
    };
    if (rendered.formattedBody !== undefined) {
      editOptions.formattedBody = rendered.formattedBody;
    }
    const raw = await core.editMessage(editOptions);
    return this.#rawMessage(messageId, parsed.roomId, threadId, {
      logicalEventId: messageId,
      replacementEventId: raw.eventId,
      raw: raw.raw,
    });
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

  #attachmentsFromRaw(raw: MatrixRawMessage): Attachment[] {
    const attachments =
      raw.attachments && raw.attachments.length > 0
        ? raw.attachments
        : this.#matrixAttachmentsFromContent(raw);
    return attachments.map((attachment) => this.#attachmentFromMatrix(raw, attachment));
  }

  #attachmentFromMatrix(raw: MatrixRawMessage, attachment: MatrixMediaAttachment): Attachment {
    const metadata: MatrixAttachmentFetchMetadata = {
      matrixEventId: raw.eventId,
      matrixRoomId: raw.roomId,
    };
    if (attachment.contentUri) {
      metadata.matrixContentUri = attachment.contentUri;
    }
    if (attachment.encryptedFile) {
      metadata.matrixEncryptedFile = JSON.stringify(attachment.encryptedFile);
    }
    const chatAttachment: MatrixAttachment = {
      fetchMetadata: metadata,
      matrix: metadata,
      type: attachmentTypeFromMsgtype(attachment.msgtype),
    };
    if (attachment.info?.height !== undefined) {
      chatAttachment.height = attachment.info.height;
    }
    if (attachment.info?.contentType !== undefined) {
      chatAttachment.mimeType = attachment.info.contentType;
    }
    if (attachment.filename !== undefined) {
      chatAttachment.name = attachment.filename;
    }
    if (attachment.info?.size !== undefined) {
      chatAttachment.size = attachment.info.size;
    }
    const url = attachment.contentUri ?? attachment.encryptedFile?.url;
    if (url !== undefined) {
      chatAttachment.url = url;
    }
    if (attachment.info?.width !== undefined) {
      chatAttachment.width = attachment.info.width;
    }
    chatAttachment.fetchData = async () => bytesToBufferLike(await this.#downloadAttachment(metadata));
    return chatAttachment;
  }

  #matrixAttachmentsFromContent(raw: MatrixRawMessage): MatrixMediaAttachment[] {
    const content = raw.content;
    const msgtype = normalizeMatrixMsgtype(raw.msgtype ?? readString(content, "msgtype"));
    if (!msgtype) {
      return [];
    }
    const infoRecord = readRecord(content, "info");
    const info = infoRecord ? matrixMediaInfoFromRecord(infoRecord) : undefined;
    const encryptedFile = readEncryptedFile(content, "file");
    const attachment: MatrixMediaAttachment = { msgtype };
    const contentUri = readString(content, "url");
    if (contentUri !== undefined) {
      attachment.contentUri = contentUri;
    }
    if (encryptedFile !== undefined) {
      attachment.encryptedFile = encryptedFile;
    }
    const filename =
      readString(content, "filename") ?? normalizeOptionalString(raw.body) ?? readString(content, "body");
    if (filename !== undefined) {
      attachment.filename = filename;
    }
    if (info !== undefined) {
      attachment.info = info;
    }
    return [attachment];
  }

  async #downloadAttachment(metadata: MatrixAttachmentFetchMetadata): Promise<Uint8Array> {
    const core = this.#requireCore();
    if (metadata.matrixEncryptedFile) {
      const file = parseEncryptedFileMetadata(metadata.matrixEncryptedFile);
      const downloaded = await core.downloadEncryptedMedia({ file });
      return base64ToBytes(downloaded.bytesBase64);
    }
    if (!metadata.matrixContentUri) {
      throw new Error("Matrix attachment is missing media metadata");
    }
    const downloaded = await core.downloadMedia({ contentUri: metadata.matrixContentUri });
    return base64ToBytes(downloaded.bytesBase64);
  }

  #isMention(raw: MatrixRawMessage, text: string): boolean {
    const mentions = readRecord(raw.content, "m.mentions");
    if (readBoolean(mentions, "room")) {
      return true;
    }
    const userIds = readStringArray(mentions, "user_ids") ?? readStringArray(mentions, "userIds") ?? [];
    if (this.#userId && userIds.includes(this.#userId)) {
      return true;
    }
    if (this.#userId && text.includes(this.#userId)) {
      return true;
    }
    return text.includes(`@${this.userName}`);
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
        await this.#requireCore().joinRoom({ roomIdOrAlias: roomId });
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

export function createMatrixAdapter(config: MatrixAdapterConfig): MatrixAdapter {
  return new MatrixAdapter(config);
}

function isTransientMatrixError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(408|425|429|500|502|503|504)\b/.test(message) ||
    /timeout|temporar|ECONNRESET|ETIMEDOUT/i.test(message);
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
    bytesBase64: bytesToBase64(bytes),
    filename: file.filename,
    msgtype: msgtypeFromContentType(file.mimeType),
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
    bytesBase64: bytesToBase64(bytes),
    filename: normalizeOptionalString(attachment.name) ?? defaultAttachmentName(attachment),
    msgtype: msgtypeFromAttachment(attachment),
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

function msgtypeFromAttachment(attachment: Attachment): "m.image" | "m.video" | "m.audio" | "m.file" {
  if (attachment.type === "image") {
    return "m.image";
  }
  if (attachment.type === "video") {
    return "m.video";
  }
  if (attachment.type === "audio") {
    return "m.audio";
  }
  return msgtypeFromContentType(attachment.mimeType);
}

function msgtypeFromContentType(contentType?: string): "m.image" | "m.video" | "m.audio" | "m.file" {
  const normalized = contentType?.toLowerCase();
  if (normalized?.startsWith("image/")) {
    return "m.image";
  }
  if (normalized?.startsWith("video/")) {
    return "m.video";
  }
  if (normalized?.startsWith("audio/")) {
    return "m.audio";
  }
  return "m.file";
}

function attachmentTypeFromMsgtype(msgtype: string): Attachment["type"] {
  if (msgtype === "m.image") {
    return "image";
  }
  if (msgtype === "m.video") {
    return "video";
  }
  if (msgtype === "m.audio") {
    return "audio";
  }
  return "file";
}

function normalizeMatrixMsgtype(value?: string): MatrixMediaAttachment["msgtype"] | null {
  if (value === "m.image" || value === "m.video" || value === "m.audio" || value === "m.file") {
    return value;
  }
  return null;
}

function matrixMediaInfoFromRecord(record: Record<string, unknown>): MatrixMediaAttachment["info"] {
  const info: NonNullable<MatrixMediaAttachment["info"]> = {};
  const contentType = readString(record, "mimetype") ?? readString(record, "contentType");
  if (contentType !== undefined) {
    info.contentType = contentType;
  }
  const duration = readNumber(record, "duration");
  if (duration !== undefined) {
    info.duration = duration;
  }
  const height = readNumber(record, "h") ?? readNumber(record, "height");
  if (height !== undefined) {
    info.height = height;
  }
  const size = readNumber(record, "size");
  if (size !== undefined) {
    info.size = size;
  }
  const width = readNumber(record, "w") ?? readNumber(record, "width");
  if (width !== undefined) {
    info.width = width;
  }
  return info;
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

function bytesToBase64(bytes: Uint8Array): string {
  const BufferCtor = getBufferCtor();
  if (BufferCtor) {
    return BufferCtor.from(bytes).toString("base64");
  }
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const BufferCtor = getBufferCtor();
  if (BufferCtor) {
    return new Uint8Array(BufferCtor.from(base64, "base64"));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
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

function parseEncryptedFileMetadata(serialized: string): MatrixEncryptedFile {
  const parsed = JSON.parse(serialized) as unknown;
  if (!isRecord(parsed) || typeof parsed.url !== "string") {
    throw new Error("Invalid Matrix encrypted media metadata");
  }
  return parsed as unknown as MatrixEncryptedFile;
}

function readEncryptedFile(
  record: Record<string, unknown> | undefined,
  key: string
): MatrixEncryptedFile | undefined {
  const value = readRecord(record, key);
  return value ? (value as unknown as MatrixEncryptedFile) : undefined;
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

function readNumber(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" ? value : undefined;
}

function readBoolean(record: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = record?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function readStringArray(record: Record<string, unknown> | undefined, key: string): string[] | undefined {
  const value = record?.[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function normalizeOptionalString(value?: string): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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
