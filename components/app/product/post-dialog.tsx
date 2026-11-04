"use client";

import { RefreshCwIcon, SendIcon } from "lucide-react";
import { useId, useState, useTransition } from "react";

import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import type { TikTokPrivacyLevel } from "@/lib/domain/contracts";
import type { TikTokPostDTO, TikTokProfileOptionDTO } from "@/lib/services/types";
import { cn } from "@/lib/utils";

import type { ActionResult } from "../action-result";
import { Pill } from "../badges";
import { ConfirmDialog } from "../confirm-dialog";
import { DisabledReason } from "../disabled-reason";
import { FormError, SelectField, TextAreaField } from "../form-controls";
import { formatDateTime } from "../format";
import type { StatusTone } from "../product-status";
import { DISCLOSURE_UNSUPPORTED } from "./action-markers";

export type PublishRequest = {
  videoId: string;
  profileConnectionId: string;
  caption: string;
  privacyLevel: TikTokPrivacyLevel;
  disclosure: { enabled: boolean; yourBrand: boolean; brandedContent: boolean };
};

const PRIVACY_LABEL: Record<TikTokPrivacyLevel, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  FOLLOWER_OF_CREATOR: "Followers",
  MUTUAL_FOLLOW_FRIENDS: "Friends (followers you follow back)",
  SELF_ONLY: "Only me",
};

const ALL_LEVELS: TikTokPrivacyLevel[] = [
  "PUBLIC_TO_EVERYONE",
  "FOLLOWER_OF_CREATOR",
  "MUTUAL_FOLLOW_FRIENDS",
  "SELF_ONLY",
];

const USABLE = new Set(["active", "expiring"]);
const MAX_CAPTION = 2200;

const MUSIC_URL = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
const BC_POLICY_URL = "https://www.tiktok.com/legal/page/global/bc-policy/en";

function ExternalLegal({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-brand-text underline underline-offset-4"
    >
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/**
 * Posts an approved video to a TikTok profile, following TikTok's Direct
 * Post UX rules: the creator's name is shown, the privacy level has no
 * default (only "Only me" until the app passes TikTok's audit), the caption
 * is editable, the commercial content disclosure is offered, and the Music
 * Usage Confirmation consent is shown next to the post button.
 */
export function PostToTikTokButton({
  videoId,
  profiles,
  posts,
  postingAudited,
  defaultCaption,
  canPublish,
  onPublish,
}: {
  videoId: string;
  profiles: TikTokProfileOptionDTO[];
  posts: TikTokPostDTO[];
  postingAudited: boolean;
  defaultCaption: string;
  canPublish: boolean;
  onPublish: (input: PublishRequest) => Promise<ActionResult>;
}) {
  const uid = useId();
  // One post per (video, profile): a failed one can be posted again.
  const taken = new Set(
    posts.filter((p) => p.status !== "failed").map((p) => p.profileConnectionId),
  );
  const available = profiles.filter((p) => USABLE.has(p.status) && !taken.has(p.id));
  const [profileId, setProfileId] = useState(available.length === 1 ? available[0]!.id : "");
  const [privacy, setPrivacy] = useState<TikTokPrivacyLevel | "">("");
  const [caption, setCaption] = useState(defaultCaption);
  const [disclose, setDisclose] = useState(false);
  const [yourBrand, setYourBrand] = useState(false);
  const [branded, setBranded] = useState(false);

  const trigger = (
    <Button variant="outline" size="lg" disabled={!canPublish || available.length === 0}>
      <SendIcon aria-hidden="true" />
      Post to TikTok
    </Button>
  );

  if (!canPublish) {
    return (
      <DisabledReason reason="Your role cannot post to TikTok. Ask a Creative or higher.">
        {trigger}
      </DisabledReason>
    );
  }
  if (profiles.length === 0) {
    return (
      <DisabledReason reason="Connect a TikTok profile to this brand first (Connections).">
        {trigger}
      </DisabledReason>
    );
  }
  if (available.length === 0) {
    return (
      <DisabledReason reason="Already posted to every connected profile, or the profiles need to be reconnected.">
        {trigger}
      </DisabledReason>
    );
  }

  const profile = available.find((p) => p.id === profileId) ?? null;
  const levels = postingAudited ? ALL_LEVELS : (["SELF_ONLY"] as TikTokPrivacyLevel[]);
  const brandedPrivate = disclose && branded && privacy === "SELF_ONLY";
  const disclosureMissing = disclose && !yourBrand && !branded;
  // The posting service has no disclosure field yet: a disclosed post is
  // never sent unlabelled (the server action refuses it too).
  const ready = !!profile && privacy !== "" && caption.trim().length > 0 && !disclose;

  function reset() {
    setPrivacy("");
    setDisclose(false);
    setYourBrand(false);
    setBranded(false);
    setCaption(defaultCaption);
  }

  return (
    <ConfirmDialog
      trigger={trigger}
      title="Post to TikTok"
      description={
        profile ? (
          <>
            Posting to <strong className="text-foreground">{profile.displayName}</strong> on TikTok.
          </>
        ) : (
          "Choose the TikTok profile to post to."
        )
      }
      confirmLabel="Post"
      pendingLabel="Sending to TikTok…"
      confirmDisabled={!ready}
      onConfirm={() =>
        privacy === ""
          ? Promise.resolve({
              ok: false as const,
              code: "invalid_input" as const,
              error: "Choose who can see this post.",
            })
          : onPublish({
              videoId,
              profileConnectionId: profileId,
              caption: caption.trim(),
              privacyLevel: privacy,
              disclosure: { enabled: disclose, yourBrand, brandedContent: branded },
            })
      }
      onSuccess={reset}
    >
      <div className="grid gap-4">
        {available.length > 1 ? (
          <SelectField
            id={`${uid}-profile`}
            label="TikTok profile"
            value={profileId}
            onChange={(e) => setProfileId(e.currentTarget.value)}
            options={[
              { value: "", label: "Choose a profile" },
              ...available.map((p) => ({ value: p.id, label: p.displayName })),
            ]}
          />
        ) : null}

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">Who can see this post</legend>
          {levels.map((level) => (
            <label
              key={level}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm has-checked:border-brand-border has-checked:bg-brand-soft has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
            >
              <input
                type="radio"
                name={`${uid}-privacy`}
                value={level}
                checked={privacy === level}
                onChange={() => setPrivacy(level)}
                className="accent-brand outline-none"
              />
              {PRIVACY_LABEL[level]}
            </label>
          ))}
          {!postingAudited ? (
            <p className="text-xs text-muted-foreground">
              Only &ldquo;Only me&rdquo; is available: Trendcart&rsquo;s TikTok app has not passed
              TikTok&rsquo;s audit yet, and TikTok keeps posts from unaudited apps private. You can
              change the visibility in the TikTok app after posting.
            </p>
          ) : null}
        </fieldset>

        <TextAreaField
          id={`${uid}-caption`}
          label="Caption"
          value={caption}
          onChange={(e) => setCaption(e.currentTarget.value)}
          maxLength={MAX_CAPTION}
          rows={3}
          hint={`Prefilled from the first ad text. ${caption.length}/${MAX_CAPTION} characters.`}
        />

        <div className="grid gap-2 rounded-lg border border-border p-3">
          <div className="flex items-start justify-between gap-3">
            <label htmlFor={`${uid}-disclose`} className="grid gap-0.5 text-sm">
              <span className="font-medium">Disclose commercial content</span>
              <span className="text-xs text-muted-foreground">
                Turn on if this post promotes yourself, a third party, or both.
              </span>
            </label>
            <Switch
              id={`${uid}-disclose`}
              checked={disclose}
              onCheckedChange={(next) => {
                setDisclose(next);
                if (!next) {
                  setYourBrand(false);
                  setBranded(false);
                }
              }}
            />
          </div>
          {disclose ? (
            <div className="grid gap-2 border-t border-border pt-2 text-sm">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={yourBrand}
                  onChange={(e) => setYourBrand(e.currentTarget.checked)}
                  className="mt-1 accent-brand"
                />
                <span>
                  Your brand
                  <span className="block text-xs text-muted-foreground">
                    You are promoting yourself or your own business.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={branded}
                  onChange={(e) => setBranded(e.currentTarget.checked)}
                  className="mt-1 accent-brand"
                />
                <span>
                  Branded content
                  <span className="block text-xs text-muted-foreground">
                    You are promoting another brand or a third party.
                  </span>
                </span>
              </label>
              {disclosureMissing ? (
                <p className="text-xs text-warning">
                  Choose at least one: your brand, branded content, or both.
                </p>
              ) : branded ? (
                <p className="text-xs text-muted-foreground">
                  Your video will be labeled &ldquo;Paid partnership&rdquo;.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Your video will be labeled &ldquo;Promotional content&rdquo;.
                </p>
              )}
              {brandedPrivate ? (
                <p className="text-xs text-warning">
                  Branded content visibility cannot be set to only you.
                </p>
              ) : null}
              <p role="status" className="text-xs text-warning">
                {DISCLOSURE_UNSUPPORTED}
              </p>
            </div>
          ) : null}
        </div>

        <p className="text-xs text-muted-foreground">
          By posting, you agree to TikTok&rsquo;s{" "}
          {disclose && branded ? (
            <>
              <ExternalLegal href={BC_POLICY_URL}>Branded Content Policy</ExternalLegal> and{" "}
            </>
          ) : null}
          <ExternalLegal href={MUSIC_URL}>Music Usage Confirmation</ExternalLegal>.
        </p>
        <p className="text-xs text-muted-foreground">
          After you post, TikTok can take a few minutes to process the video before it appears on
          the profile.
        </p>
      </div>
    </ConfirmDialog>
  );
}

const POST_STATUS: Record<TikTokPostDTO["status"], { label: string; tone: StatusTone }> = {
  pending: { label: "Sending", tone: "running" },
  processing: { label: "Processing on TikTok", tone: "running" },
  published: { label: "Posted", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

/** Posts of one video, newest first. */
export function PostList({ posts }: { posts: TikTokPostDTO[] }) {
  if (posts.length === 0) return null;
  return (
    <ul className="grid gap-1.5" aria-label="TikTok posts">
      {posts.map((p) => (
        <li key={p.id} className="grid gap-0.5 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={POST_STATUS[p.status].tone}>{POST_STATUS[p.status].label}</Pill>
            <span className="text-foreground">{p.profileName ?? "Removed profile"}</span>
            <span className="text-muted-foreground">{formatDateTime(p.updatedAt)}</span>
          </div>
          {p.error ? <p className="break-words text-danger">{p.error}</p> : null}
        </li>
      ))}
    </ul>
  );
}

/** Polls TikTok for posts still processing. */
export function RefreshPostsButton({
  onRefresh,
  className,
}: {
  onRefresh: () => Promise<ActionResult>;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={cn("grid justify-items-start gap-2", className)}>
      <Button
        variant="outline"
        size="lg"
        disabled={pending}
        aria-busy={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await onRefresh();
            if (!result.ok) setError(result.error);
          });
        }}
      >
        <RefreshCwIcon
          aria-hidden="true"
          className={pending ? "motion-safe:animate-spin" : undefined}
        />
        {pending ? "Checking TikTok…" : "Refresh post status"}
      </Button>
      <FormError message={error} />
    </div>
  );
}
