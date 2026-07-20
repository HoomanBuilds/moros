export const COMMENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const COMMENT_IMAGE_MAX_DIMENSION = 8192;
export const COMMENT_IMAGE_MAX_PIXELS = 40_000_000;

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

export function validateCommentImageDimensions(width: number, height: number): string | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return "The image dimensions are invalid.";
  }
  if (width > COMMENT_IMAGE_MAX_DIMENSION || height > COMMENT_IMAGE_MAX_DIMENSION || width * height > COMMENT_IMAGE_MAX_PIXELS) {
    return "Images must be no larger than 8,192 pixels per side and 40 megapixels.";
  }
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

export function isOwnedCommentImagePath(path: string | null, wallet: string): path is string {
  if (!path) return false;
  const parts = path.split("/");
  if (parts.length !== 3 || parts[0] !== wallet) return false;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(parts[1])) return false;
  return /^[A-Za-z0-9_-]{1,80}\.(jpg|png|webp|gif)$/.test(parts[2]);
}
