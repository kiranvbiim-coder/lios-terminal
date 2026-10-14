// Imported from OpenClaw (MIT, Copyright (c) 2026 OpenClaw Foundation), commit c074824a27c96d3983043f9eeb33823cd1772d8c.
// Upstream path: src/shared/deferred.ts
// LiOS (GM-10a): unchanged except import specifiers (extensionless, flattened into server/exec).
export type Deferred<T = void> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

type PromiseConstructorWithResolvers = PromiseConstructor & {
  withResolvers<T>(): Deferred<T>;
};

const promiseWithResolvers = Promise as PromiseConstructorWithResolvers;

export function createDeferredCore<T = void>(): Deferred<T> {
  return promiseWithResolvers.withResolvers<T>();
}
