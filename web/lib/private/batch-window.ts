type PrivateBatchPhase = string | { tag: string } | string[];

type PrivateBatchRegistration = {
  finalized: boolean;
  current_epoch: bigint;
  maximum_batch_size: number;
};

type PrivateBatchEpoch = {
  epoch: bigint;
  phase: PrivateBatchPhase;
  accepted_count: number;
  cutoff: bigint;
};

export type PrivateBatchWindow<
  Registration extends PrivateBatchRegistration = PrivateBatchRegistration,
  Epoch extends PrivateBatchEpoch = PrivateBatchEpoch,
> = {
  registration?: Registration;
  epoch?: Epoch;
};

function phaseName(value: PrivateBatchPhase): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? "";
  return value.tag;
}

function acceptsOrders<
  Registration extends PrivateBatchRegistration,
  Epoch extends PrivateBatchEpoch,
>(
  window: PrivateBatchWindow<Registration, Epoch>,
  nowSeconds: bigint,
): boolean {
  return Boolean(
    window.registration &&
    window.epoch &&
    !window.registration.finalized &&
    window.epoch.epoch === window.registration.current_epoch &&
    phaseName(window.epoch.phase) === "Collecting" &&
    window.epoch.accepted_count < window.registration.maximum_batch_size &&
    nowSeconds < window.epoch.cutoff
  );
}

export async function waitForPrivateBatch<
  Registration extends PrivateBatchRegistration,
  Epoch extends PrivateBatchEpoch,
>({
  read,
  onWait,
  sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  nowSeconds = () => BigInt(Math.floor(Date.now() / 1_000)),
  retryMilliseconds = 5_000,
  maximumAttempts = 48,
}: {
  read: () => Promise<PrivateBatchWindow<Registration, Epoch>>;
  onWait?: () => void;
  sleep?: (milliseconds: number) => Promise<void>;
  nowSeconds?: () => bigint;
  retryMilliseconds?: number;
  maximumAttempts?: number;
}): Promise<{ registration: Registration; epoch: Epoch }> {
  for (let attempt = 0; attempt < maximumAttempts; attempt++) {
    const window = await read();
    if (!window.registration || window.registration.finalized) {
      throw new Error("This private market is not accepting orders");
    }
    if (acceptsOrders(window, nowSeconds()) && window.epoch) {
      return {
        registration: window.registration,
        epoch: window.epoch,
      };
    }
    if (attempt + 1 < maximumAttempts) {
      onWait?.();
      await sleep(retryMilliseconds);
    }
  }
  throw new Error("A new private batch did not open in time");
}
