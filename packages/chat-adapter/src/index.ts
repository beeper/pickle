export { createMatrixAdapter, MatrixAdapter } from "./adapter";
export { MatrixFormatConverter } from "./format";
export type { RenderedMatrixMessage } from "./format";
export type { MatrixStream } from "./streaming";
export {
  decodeMatrixChatThreadRef,
  encodeMatrixChatThreadRef,
  matrixChannelIdFromChatThreadId,
} from "./thread-id";
export type { MatrixMessageEvent } from "pickle";
export type { MatrixAdapterConfig, MatrixChatThreadRef } from "./types";
