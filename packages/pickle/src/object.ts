type StripUndefined<T extends object> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

export function stripUndefined<T extends object>(value: T): StripUndefined<T> {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, unknown] => entry[1] !== undefined)
  ) as StripUndefined<T>;
}
