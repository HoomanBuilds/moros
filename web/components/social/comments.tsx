"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { Panel, Tag } from "@/components/app/app-kit";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { SocialSignIn } from "@/components/social/social-sign-in";
import { getBrowserClient } from "@/lib/supabase/client";
import {
  listComments,
  postComment,
  subscribeComments,
  type Comment,
  type CommentImage,
} from "@/lib/supabase/comments";
import { validateCommentImage, validateCommentImageDimensions } from "@/lib/supabase/comment-media";
import { truncate } from "@/lib/wallet";
import { useWalletAddress } from "@/lib/wallet-store";

async function imageDimensions(file: File): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dimensions;
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve({ width: element.naturalWidth, height: element.naturalHeight });
      element.onerror = () => reject(new Error("image decode failed"));
      element.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function CommentBody({ comment }: { comment: Comment }) {
  return (
    <>
      {comment.body && <p className="mt-1 whitespace-pre-wrap break-words">{comment.body}</p>}
      {comment.image_url && (
        <a href={comment.image_url} target="_blank" rel="noreferrer" className="mt-3 block w-fit">
          <img
            src={comment.image_url}
            alt={comment.image_alt ?? "Comment attachment"}
            width={comment.image_width ?? undefined}
            height={comment.image_height ?? undefined}
            loading="lazy"
            className="max-h-96 max-w-full rounded-md border border-foreground/10 object-contain"
          />
        </a>
      )}
    </>
  );
}

export function Comments({ marketId }: { marketId: string }) {
  const enabled = !!getBrowserClient();
  const address = useWalletAddress();
  const [comments, setComments] = useState<Comment[]>([]);
  const [authed, setAuthed] = useState(false);
  const [body, setBody] = useState("");
  const [image, setImage] = useState<CommentImage | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshAuth = useCallback(async (expectedAddress?: string) => {
    const client = getBrowserClient();
    if (!client) return;
    const { data } = await client.auth.getSession();
    const sessionWallet = data.session?.user.app_metadata?.wallet;
    const currentAddress = expectedAddress ?? address;
    setAuthed(!!currentAddress && sessionWallet === currentAddress);
  }, [address]);

  useEffect(() => {
    if (!enabled) return;
    listComments(marketId).then(setComments);
    refreshAuth();
    const unsubscribe = subscribeComments(marketId, (comment) => {
      setComments((prev) => (prev.some((c) => c.id === comment.id) ? prev : [...prev, comment]));
    });
    const client = getBrowserClient();
    const auth = client?.auth.onAuthStateChange(() => refreshAuth());
    return () => {
      unsubscribe();
      auth?.data.subscription.unsubscribe();
    };
  }, [marketId, enabled, refreshAuth]);

  useEffect(() => {
    if (!image) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(image.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  async function selectImage(file?: File) {
    setPostError("");
    if (!file) return;
    const error = validateCommentImage(file);
    if (error) {
      setPostError(error);
      return;
    }
    try {
      const dimensions = await imageDimensions(file);
      const dimensionError = validateCommentImageDimensions(dimensions.width, dimensions.height);
      if (dimensionError) {
        setPostError(dimensionError);
        return;
      }
      setImage({ file, ...dimensions });
      if (fileRef.current) fileRef.current.value = "";
    } catch {
      setPostError("The image could not be read.");
    }
  }

  async function submit() {
    if (!body.trim() && !image) return;
    setPosting(true);
    setPostError("");
    const result = await postComment(marketId, body, image ?? undefined);
    setPosting(false);
    if (result.ok) {
      setBody("");
      setImage(null);
      setComments((prev) => (prev.some((comment) => comment.id === result.comment.id) ? prev : [...prev, result.comment]));
    } else {
      setPostError(result.error);
      if (/sign in|connected wallet/i.test(result.error)) setAuthed(false);
    }
  }

  const topLevel = comments.filter((c) => !c.parent_id);
  const repliesByParent = comments.reduce<Record<string, Comment[]>>((acc, c) => {
    if (!c.parent_id) return acc;
    acc[c.parent_id] = [...(acc[c.parent_id] ?? []), c];
    return acc;
  }, {});

  return (
    <Panel className="p-6 space-y-6">
      <div className="space-y-1">
        <Tag>Comments</Tag>
        <p className="text-sm text-muted-foreground">
          Comments are public and tied to your wallet - separate from your private bets.
        </p>
      </div>

      {!enabled ? (
        <p className="text-sm text-muted-foreground">Comments require a connected Supabase project.</p>
      ) : (
        <>
          {authed ? (
            <div className="space-y-3">
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Share your take or add an image"
                maxLength={2000}
                disabled={posting}
              />
              <div
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  selectImage(event.dataTransfer.files[0]);
                }}
                className={`rounded-md border border-dashed p-3 transition-colors ${dragging ? "border-foreground/50 bg-foreground/[0.04]" : "border-foreground/15"}`}
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="sr-only"
                  disabled={posting}
                  onChange={(event) => selectImage(event.target.files?.[0])}
                />
                {image && previewUrl ? (
                  <div className="flex items-start gap-3">
                    <img src={previewUrl} alt="Selected comment attachment" className="h-20 w-20 rounded object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{image.file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(image.file.size / 1024 / 1024).toFixed(2)} MB, {image.width} x {image.height}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      disabled={posting}
                      onClick={() => {
                        setImage(null);
                        if (fileRef.current) fileRef.current.value = "";
                      }}
                      aria-label="Remove image"
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={posting}
                    onClick={() => fileRef.current?.click()}
                    className="flex w-full items-center justify-center gap-2 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    <ImagePlus className="size-4" />
                    Drop an image here or choose a file
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[10px] text-muted-foreground">{body.length}/2000</span>
                <Button onClick={submit} disabled={posting || (!body.trim() && !image)}>
                  {posting && <Spinner className="size-3" />}
                  {posting ? "Uploading and posting" : "Post comment"}
                </Button>
              </div>
              {postError && (
                <p className="text-sm" style={{ color: "#f0564a" }}>
                  {postError}
                </p>
              )}
            </div>
          ) : (
            <SocialSignIn onSignedIn={refreshAuth} />
          )}

          <div className="space-y-6 border-t border-foreground/10 pt-6">
            {topLevel.length === 0 ? (
              <p className="text-sm text-muted-foreground">No comments yet.</p>
            ) : (
              topLevel.map((comment) => {
                const replies = repliesByParent[comment.id] ?? [];
                return (
                  <div key={comment.id} className="space-y-3">
                    <div className="text-sm">
                      <span className="font-mono text-xs text-muted-foreground">{truncate(comment.wallet)}</span>
                      <CommentBody comment={comment} />
                    </div>
                    {replies.length > 0 && (
                      <div className="ml-6 space-y-3 border-l border-foreground/10 pl-4">
                        {replies.map((reply) => (
                          <div key={reply.id} className="text-sm">
                            <span className="font-mono text-xs text-muted-foreground">
                              {truncate(reply.wallet)}
                            </span>
                            <CommentBody comment={reply} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </Panel>
  );
}
