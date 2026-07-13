"use client";

import { useCallback, useEffect, useState } from "react";
import { Panel, Tag } from "@/components/app/app-kit";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import { SocialSignIn } from "@/components/social/social-sign-in";
import { getBrowserClient } from "@/lib/supabase/client";
import { listComments, postComment, subscribeComments, type Comment } from "@/lib/supabase/comments";
import { truncate } from "@/lib/wallet";

export function Comments({ marketId }: { marketId: string }) {
  const enabled = !!getBrowserClient();
  const [comments, setComments] = useState<Comment[]>([]);
  const [authed, setAuthed] = useState(false);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState(false);

  const refreshAuth = useCallback(async () => {
    const client = getBrowserClient();
    if (!client) return;
    const { data } = await client.auth.getSession();
    setAuthed(!!data.session);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    listComments(marketId).then(setComments);
    refreshAuth();
    const unsubscribe = subscribeComments(marketId, (comment) => {
      setComments((prev) => (prev.some((c) => c.id === comment.id) ? prev : [...prev, comment]));
    });
    return unsubscribe;
  }, [marketId, enabled, refreshAuth]);

  async function submit() {
    if (!body.trim()) return;
    setPosting(true);
    setPostError(false);
    const ok = await postComment(marketId, body.trim());
    setPosting(false);
    if (ok) {
      setBody("");
    } else {
      setPostError(true);
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
                placeholder="Share your take"
                disabled={posting}
              />
              <Button onClick={submit} disabled={posting || !body.trim()}>
                {posting && <Spinner className="size-3" />}
                {posting ? "Posting" : "Post"}
              </Button>
              {postError && (
                <p className="text-sm" style={{ color: "#f0564a" }}>
                  Could not post - check your wallet connection and try again.
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
                      <p className="mt-1">{comment.body}</p>
                    </div>
                    {replies.length > 0 && (
                      <div className="ml-6 space-y-3 border-l border-foreground/10 pl-4">
                        {replies.map((reply) => (
                          <div key={reply.id} className="text-sm">
                            <span className="font-mono text-xs text-muted-foreground">
                              {truncate(reply.wallet)}
                            </span>
                            <p className="mt-1">{reply.body}</p>
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
