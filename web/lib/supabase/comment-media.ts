export const COMMENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export const COMMENT_IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
} as const;

export type CommentImageType = keyof typeof COMMENT_IMAGE_TYPES;

export function validateCommentImage(file: Pick<File, "size" | "type">): string | null {
  if (!(file.type in COMMENT_IMAGE_TYPES)) return "Use a JPEG, PNG, WebP, or GIF image.";
  if (file.size <= 0) return "The selected image is empty.";
  if (file.size > COMMENT_IMAGE_MAX_BYTES) return "Images must be 5 MB or smaller.";
  return null;
}

export function commentImageExtension(type: string): string | null {
  return COMMENT_IMAGE_TYPES[type as CommentImageType] ?? null;
}

export function commentImagePath(address: string, marketId: string, type: string, id: string): string | null {
  const extension = commentImageExtension(type);
  if (!extension) return null;
  const safeMarketId = marketId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  const safeId = id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  if (!safeMarketId || !safeId) return null;
  return `${address}/${safeMarketId}/${safeId}.${extension}`;
}
