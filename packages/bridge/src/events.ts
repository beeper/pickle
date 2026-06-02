import type {
  BridgeRequestContext,
  ChatInfoChange,
  ConvertedMessage,
  CreateRemoteChatInfoChangeOptions,
  CreateRemoteMessageOptions,
  MatrixIntent,
  MessageID,
  Portal,
  RemoteChatInfoChange,
  RemoteEventType,
  RemoteMessage,
  RemoteMessageWithTransactionID,
} from "./types";

export function createRemoteMessage<T>(options: CreateRemoteMessageOptions<T>): RemoteMessage | RemoteMessageWithTransactionID {
  const timestamp = options.timestamp ?? new Date();
  const streamOrder = options.streamOrder ?? timestamp.getTime();
  const event = {
    convertMessage(ctx: BridgeRequestContext, portal: Portal, intent: MatrixIntent): Promise<ConvertedMessage> {
      return Promise.resolve(options.convert(ctx, portal, intent, options.data));
    },
    getID(): MessageID {
      return options.id;
    },
    getPortalKey() {
      return options.portalKey;
    },
    getSender() {
      return options.sender;
    },
    getStreamOrder() {
      return streamOrder;
    },
    getTimestamp() {
      return timestamp;
    },
    getType(): RemoteEventType {
      return options.type ?? "message";
    },
    shouldCreatePortal() {
      return options.createPortal ?? false;
    },
  };

  const transactionId = options.transactionId;
  if (!transactionId) return event;
  return {
    ...event,
    getTransactionID(): string {
      return transactionId;
    },
  };
}

export function createRemoteChatInfoChange(options: CreateRemoteChatInfoChangeOptions): RemoteChatInfoChange {
  const timestamp = options.timestamp ?? new Date();
  const streamOrder = options.streamOrder ?? timestamp.getTime();
  return {
    getChatInfoChange(): ChatInfoChange {
      return options.chatInfoChange;
    },
    getPortalKey() {
      return options.portalKey;
    },
    getSender() {
      return options.sender;
    },
    getStreamOrder() {
      return streamOrder;
    },
    getTimestamp() {
      return timestamp;
    },
    getType(): RemoteEventType {
      return "chat_info_change";
    },
  };
}
