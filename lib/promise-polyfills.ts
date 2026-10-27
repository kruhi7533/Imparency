/**
 * pdfjs-dist v6 calls Promise.withResolvers, which Node only ships from v22.
 * CI (and possibly the Vercel runtime) run Node 20, where every PDF read threw
 * "Promise.withResolvers is not a function". Import this before loading pdfjs.
 */
type Resolvers<T> = { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void; reject: (reason?: unknown) => void };

const P = Promise as unknown as { withResolvers?: <T>() => Resolvers<T> };
if (typeof P.withResolvers !== "function") {
  P.withResolvers = function withResolvers<T>(): Resolvers<T> {
    let resolve!: Resolvers<T>["resolve"];
    let reject!: Resolvers<T>["reject"];
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

export {};
