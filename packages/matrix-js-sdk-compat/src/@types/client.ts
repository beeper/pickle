import type { MatrixCore, MatrixCoreHost, MatrixStateStore } from "better-matrix-js";

export interface ICreateClientOpts {
  accessToken?: string;
  baseUrl?: string;
  deviceId?: string;
  fetchFn?: typeof fetch;
  homeserverUrl?: string;
  loadCore?: (host: MatrixCoreHost) => Promise<MatrixCore>;
  pickleKey?: string;
  stateStore?: MatrixStateStore;
  store?: unknown;
  userId?: string;
}

export interface IStartClientOpts {
  initialSyncLimit?: number;
  pollTimeout?: number;
}

export interface ISendEventResponse {
  event_id: string;
}

export interface UploadResponse {
  content_uri: string;
}
