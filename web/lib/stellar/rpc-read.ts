export type RpcReadPriority = "interactive" | "normal" | "background";

export type RpcReadOptions = {
  priority?: RpcReadPriority;
  maxRetries?: number;
};

type QueueItem = {
  operation: () => Promise<unknown>;
  maxRetries: number;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

type Sleep = (milliseconds: number) => Promise<void>;

const PRIORITIES: RpcReadPriority[] = [
  "interactive",
  "normal",
  "background",
];

function statusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as {
    status?: unknown;
    response?: { status?: unknown };
  };
  const value = record.response?.status ?? record.status;
  return typeof value === "number" ? value : undefined;
}

function retryAfterHeader(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const response = (error as {
    response?: {
      headers?: Headers | Record<string, unknown>;
    };
  }).response;
  const headers = response?.headers;
  if (!headers) return undefined;
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get("retry-after") ?? undefined;
  }
  const value = (headers as Record<string, unknown>)["retry-after"];
  return typeof value === "string" ? value : undefined;
}

export function isRpcRateLimitError(error: unknown): boolean {
  if (statusCode(error) === 429) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b|rate limit|too many requests/iu.test(message);
}

function retryDelay(error: unknown, retry: number): number {
  const header = retryAfterHeader(error);
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(60_000, Math.ceil(seconds * 1_000));
    }
    const timestamp = Date.parse(header);
    if (Number.isFinite(timestamp)) {
      return Math.min(60_000, Math.max(0, timestamp - Date.now()));
    }
  }
  return Math.min(15_000, 1_000 * 2 ** retry);
}

function rateLimitError(cause: unknown): Error {
  return new Error(
    "Stellar is temporarily rate-limiting reads. Please retry in a few seconds.",
    { cause },
  );
}

export class RpcReadScheduler {
  private active = 0;
  private readonly queues: Record<RpcReadPriority, QueueItem[]> = {
    interactive: [],
    normal: [],
    background: [],
  };

  constructor(
    private readonly concurrency = 2,
    private readonly sleep: Sleep = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error("RPC read concurrency must be positive");
    }
  }

  schedule<T>(
    operation: () => Promise<T>,
    options: RpcReadOptions = {},
  ): Promise<T> {
    const priority = options.priority ?? "normal";
    const maxRetries = options.maxRetries ?? 5;
    if (!Number.isInteger(maxRetries) || maxRetries < 0) {
      return Promise.reject(new Error("RPC read retries cannot be negative"));
    }
    return new Promise<T>((resolve, reject) => {
      this.queues[priority].push({
        operation,
        maxRetries,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.pump();
    });
  }

  private next(): QueueItem | undefined {
    for (const priority of PRIORITIES) {
      const item = this.queues[priority].shift();
      if (item) return item;
    }
    return undefined;
  }

  private pump(): void {
    while (this.active < this.concurrency) {
      const item = this.next();
      if (!item) return;
      this.active++;
      void this.run(item);
    }
  }

  private async run(item: QueueItem): Promise<void> {
    let retry = 0;
    try {
      while (true) {
        try {
          item.resolve(await item.operation());
          return;
        } catch (error) {
          if (!isRpcRateLimitError(error) || retry >= item.maxRetries) {
            item.reject(
              isRpcRateLimitError(error) ? rateLimitError(error) : error,
            );
            return;
          }
          await this.sleep(retryDelay(error, retry));
          retry++;
        }
      }
    } finally {
      this.active--;
      this.pump();
    }
  }
}

export const rpcReadScheduler = new RpcReadScheduler();
