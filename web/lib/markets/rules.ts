import { hash, nativeToScVal } from "@stellar/stellar-sdk";

export type EventRules = {
  title: string;
  category: string;
  resolutionSource: string;
  resolutionRules: string;
  voidRules: string;
};

export function normalizeEventRules(input: EventRules): EventRules {
  return {
    title: input.title.trim(),
    category: input.category.trim(),
    resolutionSource: input.resolutionSource.trim(),
    resolutionRules: input.resolutionRules.trim(),
    voidRules: input.voidRules.trim(),
  };
}

export function canonicalEventRules(input: EventRules): string {
  const rules = normalizeEventRules(input);
  return JSON.stringify({ version: 1, ...rules });
}

export function sha256Hex(value: string): string {
  return Buffer.from(hash(Buffer.from(value, "utf8"))).toString("hex");
}

export function eventRulesHashHex(input: EventRules): string {
  return sha256Hex(canonicalEventRules(input));
}

export function stellarStringHashHex(value: string): string {
  const scVal = nativeToScVal(value, { type: "string" });
  return Buffer.from(hash(scVal.toXDR())).toString("hex");
}
