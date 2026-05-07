import type {
  BridgeRequestContext,
  ConvertedMessage,
  CreateRemoteMessageOptions,
  MatrixIntent,
  MessageID,
  Portal,
  RemoteEventType,
  RemoteMessage,
  RemoteMessageWithTransactionID,
} from "./types";

export function createRemoteMessage<T>(options: CreateRemoteMessageOptions<T>): RemoteMessage | RemoteMessageWithTransactionID {
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
      return options.streamOrder ?? options.timestamp?.getTime() ?? Date.now();
    },
    getTimestamp() {
      return options.timestamp ?? new Date();
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
