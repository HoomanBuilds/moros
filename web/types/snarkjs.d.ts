declare module "snarkjs" {
  export const groth16: {
    fullProve(
      input: Record<string, unknown>,
      wasmFile: string,
      zkeyFile: string,
    ): Promise<{ proof: unknown; publicSignals: string[] }>;
    verify(
      verificationKey: Record<string, unknown>,
      publicSignals: string[],
      proof: unknown,
    ): Promise<boolean>;
  };

  export const wtns: {
    calculate(
      input: Record<string, unknown>,
      wasmFile: string,
      output: { type: "mem" },
    ): Promise<void>;
    exportJson(output: { type: "mem" }): Promise<Array<string | number | bigint>>;
  };
}
