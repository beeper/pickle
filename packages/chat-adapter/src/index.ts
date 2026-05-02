export { createMatrixAdapter, MatrixAdapter } from "./adapter";
export { MatrixFormatConverter } from "./format";
export type { RenderedMatrixMessage } from "./format";
export { loginMatrix, loginMatrixWithToken } from "./login";
export type { MatrixStream } from "./streaming";
export {
  decodeMatrixChatThreadRef,
  encodeMatrixChatThreadRef,
  matrixChannelIdFromChatThreadId,
} from "./thread-id";
export type { MatrixAdapterConfig, MatrixRawMessage, MatrixChatThreadRef } from "./types";
