import { hash, nativeToScVal } from "@stellar/stellar-sdk";

export type EventRules = {
  title: string;
  category: string;
  resolutionSource: string;
  backupResolutionSources?: string[];
  resolutionRules: string;
  voidRules: string;
};

export function normalizeEventRules(input: EventRules): EventRules {
  const normalized = {
    title: input.title.trim(),
    category: input.category.trim(),
    resolutionSource: input.resolutionSource.trim(),
    resolutionRules: input.resolutionRules.trim(),
    voidRules: input.voidRules.trim(),
  };
  const backupResolutionSources = [...new Set(
    (input.backupResolutionSources ?? []).map((source) => source.trim()).filter(Boolean),
  )];
  return backupResolutionSources.length > 0
    ? { ...normalized, backupResolutionSources }
    : normalized;
}

export function canonicalEventRules(input: EventRules): string {
  return JSON.stringify(normalizeEventRules(input));
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
