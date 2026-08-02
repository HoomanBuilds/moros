import {
  getPrivateOutputStatus,
  type PrivateOutputStatus,
} from "./client";

export async function waitForPrivateOutput(
  commitment: bigint,
  {
    read = () => getPrivateOutputStatus(commitment),
    sleep = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    retryMilliseconds = 2_000,
    maximumAttempts = 30,
  }: {
    read?: () => Promise<PrivateOutputStatus>;
    sleep?: (milliseconds: number) => Promise<void>;
    retryMilliseconds?: number;
    maximumAttempts?: number;
  } = {},
): Promise<PrivateOutputStatus> {
  if (commitment <= 0n) {
    throw new Error("Private output commitment is invalid");
  }
  if (!Number.isInteger(maximumAttempts) || maximumAttempts < 1) {
    throw new Error("Private output attempts must be positive");
  }
  for (let attempt = 0; attempt < maximumAttempts; attempt++) {
    const status = await read();
    if (status.indexed) return status;
    if (attempt + 1 < maximumAttempts) {
      await sleep(retryMilliseconds);
    }
  }
  throw new Error("The confirmed private output is not indexed yet");
}
