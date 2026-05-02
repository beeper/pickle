export class MatrixHttpApiError extends Error {
  readonly data: unknown;
  readonly httpStatus: number;

  constructor(httpStatus: number, data: unknown) {
    super(`Matrix HTTP request failed with status ${httpStatus}`);
    this.httpStatus = httpStatus;
    this.data = data;
  }
}
