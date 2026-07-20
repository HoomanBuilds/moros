"use client";

import { getBrowserClient } from "./client";
import { signInWithWallet } from "./auth";
import { isCommonsDownloadUrl } from "@/lib/media/commons";

export const MARKET_BANNER_MAX_BYTES = 5 * 1024 * 1024;

export const MARKET_BANNER_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type MarketBannerType = keyof typeof MARKET_BANNER_TYPES;

export type MarketBannerSource =
  | { kind: "upload"; file: File }
  | { kind: "commons"; downloadUrl: string };

export function validateMarketBanner(file: Pick<File, "size" | "type">): string | null {
  if (!(file.type in MARKET_BANNER_TYPES)) return "Use a JPEG, PNG, or WebP image.";
  if (file.size <= 0) return "The selected image is empty.";
  if (file.size > MARKET_BANNER_MAX_BYTES) return "Images must be 5 MB or smaller.";
  return null;
}

export function marketBannerPath(address: string, marketId: string, type: string, id: string): string | null {
  const extension = MARKET_BANNER_TYPES[type as MarketBannerType];
  const safeAddress = address.replace(/[^A-Za-z0-9]/g, "").slice(0, 80);
  const safeMarketId = marketId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  const safeId = id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  if (!extension || !safeAddress || !safeMarketId || !safeId) return null;
  return `${safeAddress}/${safeMarketId}/${safeId}.${extension}`;
}

async function sourceBlob(source: MarketBannerSource): Promise<Blob> {
  if (source.kind === "upload") {
    const validationError = validateMarketBanner(source.file);
    if (validationError) throw new Error(validationError);
    return source.file;
  }
  if (!isCommonsDownloadUrl(source.downloadUrl)) throw new Error("The selected Commons image URL is invalid.");
  const response = await fetch(source.downloadUrl, { headers: { Accept: "image/jpeg,image/png,image/webp" } });
  if (!response.ok) throw new Error("The selected Commons image could not be downloaded.");
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MARKET_BANNER_MAX_BYTES) throw new Error("The selected Commons image is larger than 5 MB.");
  const blob = await response.blob();
  const validationError = validateMarketBanner(blob);
  if (validationError) throw new Error(validationError);
  return blob;
}

export async function uploadMarketBanner({
  address,
  marketId,
  source,
}: {
  address: string;
  marketId: string;
  source: MarketBannerSource;
}): Promise<string> {
  const client = getBrowserClient();
  if (!client) throw new Error("Market images are not configured.");

  const { data } = await client.auth.getSession();
  const sessionWallet = data.session?.user.app_metadata?.wallet;
  if (sessionWallet !== address) {
    const result = await signInWithWallet(address);
    if (!result.ok) throw new Error(result.error);
  }

  const blob = await sourceBlob(source);
  const path = marketBannerPath(address, marketId, blob.type, globalThis.crypto.randomUUID());
  if (!path) throw new Error("The market image could not be prepared for upload.");

  const { error: uploadError } = await client.storage.from("market-banners").upload(path, blob, {
    cacheControl: "31536000",
    contentType: blob.type,
    upsert: false,
  });
  if (uploadError) throw new Error(uploadError.message);

  const publicUrl = client.storage.from("market-banners").getPublicUrl(path).data.publicUrl;
  const { error: updateError } = await client
    .from("markets_meta")
    .update({ banner_url: publicUrl })
    .eq("market_id", marketId)
    .eq("creator", address);
  if (updateError) {
    await client.storage.from("market-banners").remove([path]);
    throw new Error("The market was listed, but its image could not be attached.");
  }
  return publicUrl;
}
