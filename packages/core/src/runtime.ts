export { loadMatrixCore, MatrixWasmCore } from "./wasm";
export { startMatrixPolling } from "./polling";
export type { GoRuntime, LoadMatrixCoreOptions } from "./wasm";
export type {
  MatrixApplySyncResponseOptions,
  MatrixCore,
  MatrixCoreEvent,
  MatrixCoreHost,
  MatrixCoreInitOptions,
  MatrixFetchMessagesOptions,
  MatrixLoginOptions,
  MatrixLoginSession,
  MatrixMediaAttachment,
  MatrixRawMessage,
  MatrixSendMediaMessageOptions,
  MatrixSendMessageOptions,
  MatrixStore,
  MatrixStore as MatrixStateStore,
  MatrixTokenLoginOptions,
} from "./runtime-types";
