export type PrivateProverArtifactSources = {
  wasm: string;
  provingKey: string;
  verificationKey: string;
  preloadBinaries: boolean;
};

export type PreparedPrivateProverArtifacts = {
  wasm: string | Uint8Array;
  provingKey: string | Uint8Array;
  verificationKey: Record<string, unknown>;
};

export class PrivateProverArtifactCache {
  private readonly prepared = new Map<
    string,
    Promise<PreparedPrivateProverArtifacts>
  >();
  private readonly fetcher: typeof fetch;

  constructor(fetcher: typeof fetch = fetch) {
    this.fetcher = (input, init) => fetcher.call(globalThis, input, init);
  }

  prepare(
    key: string,
    sources: PrivateProverArtifactSources,
  ): Promise<PreparedPrivateProverArtifacts> {
    const existing = this.prepared.get(key);
    if (existing) return existing;
    const pending = this.load(sources).catch((error) => {
      this.prepared.delete(key);
      throw error;
    });
    this.prepared.set(key, pending);
    return pending;
  }

  clear(): void {
    this.prepared.clear();
  }

  private async load(
    sources: PrivateProverArtifactSources,
  ): Promise<PreparedPrivateProverArtifacts> {
    const verificationKey = this.fetchVerificationKey(
      sources.verificationKey,
    );
    if (!sources.preloadBinaries) {
      return {
        wasm: sources.wasm,
        provingKey: sources.provingKey,
        verificationKey: await verificationKey,
      };
    }
    const [wasm, provingKey, verifiedKey] = await Promise.all([
      this.fetchBinary(sources.wasm),
      this.fetchBinary(sources.provingKey),
      verificationKey,
    ]);
    return {
      wasm,
      provingKey,
      verificationKey: verifiedKey,
    };
  }

  private async fetchBinary(url: string): Promise<Uint8Array> {
    const response = await this.fetcher(url, { cache: "force-cache" });
    if (!response.ok) {
      throw new Error(`Private prover artifact failed with HTTP ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  private async fetchVerificationKey(
    url: string,
  ): Promise<Record<string, unknown>> {
    const response = await this.fetcher(url, { cache: "force-cache" });
    if (!response.ok) {
      throw new Error("Private verification key is unavailable");
    }
    return response.json() as Promise<Record<string, unknown>>;
  }
}
