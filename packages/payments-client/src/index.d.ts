export interface PaymentCircuitArtifact {
  name: string;
  wasmUrl: string;
  provingKeyUrl: string;
  schemaHash: string;
  verificationKeyHash: string;
}

export interface PaymentDeployment {
  format: 1;
  environment: "local" | "testnet" | "mainnet";
  network: "stellar:testnet" | "stellar:pubnet";
  networkPassphrase: string;
  rpcUrls: string[];
  apiUrls: string[];
  horizonUrl: string;
  vault: string;
  verifier: string;
  usdcContract: string;
  usdcIssuer: string;
  usdcCode: "USDC";
  treeLevels: number;
  rootHistorySize: number;
  startLedger: number;
  maximumRelayFeeAtomic: string;
  circuits: PaymentCircuitArtifact[];
}

export declare const PAYMENT_CIRCUITS: readonly string[];
export declare function validatePaymentDeployment(value: PaymentDeployment): Readonly<PaymentDeployment>;
export declare function bytesToHex(value: Uint8Array): string;
export declare function bytesToBase64(value: Uint8Array): string;
export declare function bytesToBase64Url(value: Uint8Array): string;
export declare function base64UrlToBytes(value: string): Uint8Array;

export declare class PaymentApiError extends Error {
  status: number;
  retryable: boolean;
}

export declare class PaymentHttpClient {
  constructor(options: {
    endpoints: string[];
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    attempts?: number;
    now?: () => number;
  });
  request(path: string, options?: {
    method?: string;
    body?: unknown;
    token?: string;
    signal?: AbortSignal;
  }): Promise<any>;
}

export declare class MorosPaymentClient {
  readonly deployment: Readonly<PaymentDeployment>;
  constructor(options: {
    deployment: PaymentDeployment;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    attempts?: number;
    now?: () => number;
  });
  health(options?: { signal?: AbortSignal }): Promise<any>;
  quote(input: { actionId: Uint8Array | string; actionExpiry: number }, options?: object): Promise<any>;
  relay(input: { method: "transfer" | "withdraw"; args: string[] }, options?: object): Promise<any>;
  outputs(input?: { fromLeafIndex?: number; limit?: number }, options?: object): Promise<any>;
  attachment(actionId: Uint8Array | string, options?: object): Promise<any>;
  action(actionId: Uint8Array | string, options?: object): Promise<any>;
  syncChallenge(input: { locator: Uint8Array | string; signingKey: Uint8Array | string }, options?: object): Promise<any>;
  syncAuthenticate(input: {
    locator: Uint8Array | string;
    signingKey: Uint8Array | string;
    challenge: Uint8Array | string;
    expiresAt: number;
    signature: Uint8Array | string;
  }, options?: object): Promise<any>;
  syncManifest(token: string, options?: object): Promise<any>;
  syncPages(token: string, input?: { generation?: number; fromPage?: number; limit?: number }, options?: object): Promise<any>;
  syncPutPage(token: string, page: Uint8Array | string, options?: object): Promise<any>;
  syncPutPages(token: string, pages: Array<Uint8Array | string>, options?: object): Promise<any>;
  syncCommit(token: string, input: {
    generation: number;
    pageCount: number;
    headHash: Uint8Array | string;
    expectedParentHash: Uint8Array | string;
  }, options?: object): Promise<any>;
  syncDeleteGenerationsBefore(token: string, minimumGeneration: number, options?: object): Promise<any>;
}

export declare class PaymentOutputScanner {
  checkpoint: number;
  constructor(options: {
    client: Pick<MorosPaymentClient, "outputs">;
    deployment: Pick<PaymentDeployment, "network" | "vault">;
    checkpoint?: number;
    saveCheckpoint?: (value: number) => Promise<void>;
  });
  scan(options: {
    decrypt: (output: any) => Promise<any>;
    signal?: AbortSignal;
    pageSize?: number;
  }): Promise<{ checkpoint: number; scanned: number; notes: Array<{ output: any; note: any }> }>;
}

export interface PaymentOperation {
  actionId: string;
  kind: "deposit" | "transfer" | "withdraw";
  state: string;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  errorCode?: string;
  ledger?: number;
  transactionHash?: string;
}

export declare class PaymentOperationJournal {
  constructor(options?: {
    operations?: PaymentOperation[];
    save?: (operations: PaymentOperation[]) => Promise<void>;
    now?: () => number;
  });
  create(input: { actionId: Uint8Array | string; kind: PaymentOperation["kind"] }): Promise<PaymentOperation>;
  transition(actionId: Uint8Array | string, state: string, details?: object): Promise<PaymentOperation>;
  recoverInterrupted(): Promise<PaymentOperation[]>;
  get(actionId: Uint8Array | string): PaymentOperation | null;
  list(): PaymentOperation[];
}
