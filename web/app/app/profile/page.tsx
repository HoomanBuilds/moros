"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader, Panel, Tag } from "@/components/app/app-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { SocialSignIn } from "@/components/social/social-sign-in";
import { getBrowserClient } from "@/lib/supabase/client";
import { getProfile, upsertProfile, uploadAvatar } from "@/lib/supabase/profile";
import { getKit, truncate } from "@/lib/wallet";

export default function ProfilePage() {
  const enabled = !!getBrowserClient();
  const [authed, setAuthed] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saved, setSaved] = useState(false);

  const refresh = useCallback(async () => {
    const client = getBrowserClient();
    if (!client) return;
    const { data } = await client.auth.getSession();
    setAuthed(!!data.session);
    if (!data.session) return;

    try {
      const { address: addr } = await getKit().getAddress();
      if (!addr) return;
      setAddress(addr);
      const profile = await getProfile(addr);
      if (profile) {
        setDisplayName(profile.display_name ?? "");
        setAvatarUrl(profile.avatar_url);
      }
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
  }, [enabled, refresh]);

  async function save() {
    setSaving(true);
    setSaveError(false);
    setSaved(false);
    const ok = await upsertProfile({ display_name: displayName, avatar_url: avatarUrl ?? undefined });
    setSaving(false);
    if (ok) setSaved(true);
    else setSaveError(true);
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const url = await uploadAvatar(file);
    setUploading(false);
    if (url) setAvatarUrl(url);
  }

  return (
    <div>
      <PageHeader
        label="Moros"
        title="Profile"
        description="Your public display name and avatar - separate from your private bets."
      />

      {!enabled ? (
        <Panel className="p-6">
          <p className="text-sm text-muted-foreground">Profiles require a connected Supabase project.</p>
        </Panel>
      ) : !authed ? (
        <Panel className="p-6">
          <SocialSignIn onSignedIn={refresh} />
        </Panel>
      ) : (
        <Panel className="p-6 space-y-6 max-w-lg">
          <div className="space-y-1">
            <Tag>Wallet</Tag>
            <p className="font-mono text-sm">{address ? truncate(address) : ""}</p>
          </div>

          <div className="space-y-2">
            <Tag>Avatar</Tag>
            <div className="flex items-center gap-4">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt=""
                  className="w-16 h-16 rounded-full object-cover border border-foreground/10"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-foreground/10" />
              )}
              <div className="flex items-center gap-2">
                <input type="file" accept="image/*" onChange={onFileChange} disabled={uploading} className="text-sm" />
                {uploading && <Spinner className="size-3" />}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Tag>Display name</Tag>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Anonymous"
              disabled={saving}
            />
          </div>

          <Button onClick={save} disabled={saving}>
            {saving && <Spinner className="size-3" />}
            {saving ? "Saving" : "Save"}
          </Button>
          {saved && (
            <p className="text-sm" style={{ color: "#16c784" }}>
              Saved.
            </p>
          )}
          {saveError && (
            <p className="text-sm" style={{ color: "#f0564a" }}>
              Could not save - try again.
            </p>
          )}
        </Panel>
      )}
    </div>
  );
}
