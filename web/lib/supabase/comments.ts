"use client";

import { getKit } from "@/lib/wallet";
import { commentImagePath, isOwnedCommentImagePath, validateCommentImage, validateCommentImageDimensions } from "./comment-media";
import { getBrowserClient } from "./client";

export type Comment = {
  id: string;
  market_id: string;
  wallet: string;
  body: string;
  parent_id: string | null;
  image_url: string | null;
  image_path: string | null;
  image_width: number | null;
  image_height: number | null;
  image_alt: string | null;
  created_at: string;
};

export type CommentImage = {
  file: File;
  width: number;
  height: number;
};

export type PostCommentResult =
  | { ok: true; comment: Comment }
  | { ok: false; error: string };

const COMMENT_FIELDS =
  "id, market_id, wallet, body, parent_id, image_url, image_path, image_width, image_height, image_alt, created_at";

function withTrustedImageUrl(
  client: NonNullable<ReturnType<typeof getBrowserClient>>,
  comment: Comment,
): Comment {
  const imagePath = isOwnedCommentImagePath(comment.image_path, comment.wallet) ? comment.image_path : null;
  return {
    ...comment,
    image_path: imagePath,
    image_url: imagePath ? client.storage.from("comment-media").getPublicUrl(imagePath).data.publicUrl : null,
  };
}

export async function listComments(marketId: string): Promise<Comment[]> {
  const client = getBrowserClient();
  if (!client) return [];

  const { data, error } = await client
    .from("comments")
    .select(COMMENT_FIELDS)
    .eq("market_id", marketId)
    .order("created_at", { ascending: true });

  if (error || !data) return [];
  return (data as Comment[]).map((comment) => withTrustedImageUrl(client, comment));
}

export async function postComment(
  marketId: string,
  body: string,
  image?: CommentImage,
  parentId?: string,
): Promise<PostCommentResult> {
  const client = getBrowserClient();
  if (!client) return { ok: false, error: "Comments are not configured." };

  const cleanBody = body.trim();
  if (!cleanBody && !image) return { ok: false, error: "Write a comment or add an image." };
  if (cleanBody.length > 2000) return { ok: false, error: "Comments must be 2,000 characters or shorter." };
  if (image) {
    const imageError = validateCommentImage(image.file);
    if (imageError) return { ok: false, error: imageError };
    const dimensionError = validateCommentImageDimensions(image.width, image.height);
    if (dimensionError) return { ok: false, error: dimensionError };
  }

  try {
    const { address } = await getKit().getAddress();
    if (!address) return { ok: false, error: "Connect your Stellar wallet first." };

    const { data: sessionData } = await client.auth.getSession();
    const sessionWallet = sessionData.session?.user.app_metadata?.wallet;
    if (sessionWallet !== address) {
      return { ok: false, error: "Sign in with the currently connected wallet before posting." };
    }

    let imagePath: string | null = null;
    let imageUrl: string | null = null;
    if (image) {
      imagePath = commentImagePath(address, marketId, image.file.type, globalThis.crypto.randomUUID());
      if (!imagePath) return { ok: false, error: "The image could not be prepared for upload." };

      const { error: uploadError } = await client.storage.from("comment-media").upload(imagePath, image.file, {
        cacheControl: "31536000",
        contentType: image.file.type,
        upsert: false,
      });
      if (uploadError) return { ok: false, error: uploadError.message };
      imageUrl = client.storage.from("comment-media").getPublicUrl(imagePath).data.publicUrl;
    }

    const { data, error } = await client
      .from("comments")
      .insert({
        market_id: marketId,
        wallet: address,
        body: cleanBody,
        parent_id: parentId ?? null,
        image_url: imageUrl,
        image_path: imagePath,
        image_width: image?.width ?? null,
        image_height: image?.height ?? null,
        image_alt: image ? "Comment attachment" : null,
      })
      .select(COMMENT_FIELDS)
      .single();

    if (error || !data) {
      if (imagePath) await client.storage.from("comment-media").remove([imagePath]);
      return { ok: false, error: error?.message ?? "The comment could not be saved." };
    }
    return { ok: true, comment: withTrustedImageUrl(client, data as Comment) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The comment could not be posted.";
    return { ok: false, error: message };
  }
}

export function subscribeComments(marketId: string, cb: (comment: Comment) => void): () => void {
  const client = getBrowserClient();
  if (!client) return () => {};

  const channel = client
    .channel(`comments-${marketId}`)
    .on<Comment>(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "comments", filter: `market_id=eq.${marketId}` },
      (payload) => cb(withTrustedImageUrl(client, payload.new)),
    )
    .subscribe();

  return () => {
    client.removeChannel(channel);
  };
}
