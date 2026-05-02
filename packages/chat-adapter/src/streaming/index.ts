import { DebouncedEditStreamDriver } from "./debounced-edit-driver";
import { isBeeperHomeserver } from "./homeserver";
import type { MatrixStreamDriver, MatrixStreamDriverOptions } from "./types";

export type { MatrixStream, MatrixStreamDriver, MatrixStreamDriverOptions } from "./types";
export { isBeeperHomeserver } from "./homeserver";

export async function createMatrixStreamDriver(options: MatrixStreamDriverOptions): Promise<MatrixStreamDriver> {
  if (!isBeeperHomeserver(options.homeserverUrl)) {
    return new DebouncedEditStreamDriver(options);
  }
  const { BeeperStreamDriver } = await import("./beeper/driver");
  return new BeeperStreamDriver(options);
}
