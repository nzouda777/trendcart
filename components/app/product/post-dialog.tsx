"use client";

import { RefreshCwIcon, SendIcon } from "lucide-react";
import { useId, useState, useTransition } from "react";

import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import type { TikTokPrivacyLevel } from "@/lib/domain/contracts";
import type { TikTokPostingInfoDTO } from "@/lib/services";
import type { TikTokPostDTO, TikTokProfileOptionDTO } from "@/lib/services/types";
import { cn } from "@/lib/utils";

import type { ActionResult } from "../action-result";
import { Pill } from "../badges";
import { ConfirmDialog } from "../confirm-dialog";
import { DisabledReason } from "../disabled-reason";
import { FormError, SelectField, TextAreaField } from "../form-controls";
import { formatDateTime } from "../format";
import type { StatusTone } from "../product-status";

export type PublishRequest = {
  videoId: string;
  profileConnectionId: string;
  caption: string;
  privacyLevel: TikTokPrivacyLevel;
  interactions: { allowComment: boolean; allowDuet: boolean; allowStitch: boolean };
  disclosure: { enabled: boolean; yourBrand: boolean; brandedContent: boolean };
  /** The user clicked "Post on TikTok" after the consent declaration. */
  consent: true;
};

const PRIVACY_LABEL: Record<TikTokPrivacyLevel, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  FOLLOWER_OF_CREATOR: "Followers",
  MUTUAL_FOLLOW_FRIENDS: "Friends (followers you follow back)",
  SELF_ONLY: "Only me",
};

const USABLE = new Set(["active", "expiring"]);
const MAX_CAPTION = 2200;

const MUSIC_URL = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
const BC_POLICY_URL = "https://www.tiktok.com/legal/page/global/bc-policy/en";
/** TikTok's wording (Content Sharing Guidelines). */
const DISCLOSURE_REQUIRED =
  "You need to indicate if your content promotes yourself, a third party, or both.";
const BRANDED_NOT_PRIVATE = "Branded content visibility cannot be set to private.";

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

function InteractionBox({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex items-start gap-2 text-sm",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked && !disabled}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
        className="mt-1 accent-brand"
      />
      <span>
        {label}
        {disabled ? (
          <span className="block text-xs text-muted-foreground">
            Turned off in this account&apos;s TikTok settings.
          </span>
        ) : null}
      </span>
    </label>
  );
}

/**
 * Posts an approved video to a TikTok profile, following TikTok's Content
 * Sharing Guidelines for Direct Post:
 * - creator_info is fetched fresh when the screen opens (and when the
 *   profile changes): nickname and @username shown, posting refused when
 *   TikTok says the creator cannot post now, video length checked;
 * - privacy: a dropdown of the creator's own options, nothing preselected;
 * - Allow Comment / Duet / Stitch: unchecked, greyed out when the creator's
 *   account disables them;
 * - commercial content disclosure (Your brand / Branded content) with
 *   TikTok's labels, branded content never private;
 * - preview, editable caption, explicit consent line and processing notice
 *   right before "Post on TikTok". Nothing is sent before that click.
 */
export function PostToTikTokButton({
  videoId,
  videoUrl,
  videoDurationSec,
  profiles,
  posts,
  postingAudited,
  defaultCaption,
  canPublish,
  onLoadCreator,
  onPublish,
}: {
  videoId: string;
  /** Stable Shopify URL of the approved video, for the preview. */
  videoUrl: string | null;
  videoDurationSec: number | null;
  profiles: TikTokProfileOptionDTO[];
  posts: TikTokPostDTO[];
  postingAudited: boolean;
  defaultCaption: string;
  canPublish: boolean;
  onLoadCreator: (
    videoId: string,
    profileConnectionId: string,
  ) => Promise<ActionResult<TikTokPostingInfoDTO>>;
  onPublish: (input: PublishRequest) => Promise<ActionResult>;
}) {
  const uid = useId();
  // One post per (video, profile): a failed one can be posted again.
  const taken = new Set(
    posts.filter((p) => p.status !== "failed").map((p) => p.profileConnectionId),
  );
  const available = profiles.filter((p) => USABLE.has(p.status) && !taken.has(p.id));
  const [profileId, setProfileId] = useState(available.length === 1 ? available[0]!.id : "");
  const [creator, setCreator] = useState<TikTokPostingInfoDTO | null>(null);
  const [creatorError, setCreatorError] = useState<string | null>(null);
  const [loadingCreator, startLoading] = useTransition();
  const [privacy, setPrivacy] = useState<TikTokPrivacyLevel | "">("");
  const [caption, setCaption] = useState(defaultCaption);
  const [allowComment, setAllowComment] = useState(false);
  const [allowDuet, setAllowDuet] = useState(false);
  const [allowStitch, setAllowStitch] = useState(false);
  const [disclose, setDisclose] = useState(false);
  const [yourBrand, setYourBrand] = useState(false);
  const [branded, setBranded] = useState(false);

  function resetChoices() {
    setPrivacy("");
    setAllowComment(false);
    setAllowDuet(false);
    setAllowStitch(false);
    setDisclose(false);
    setYourBrand(false);
    setBranded(false);
  }

  function loadCreator(id: string) {
    setCreator(null);
    setCreatorError(null);
    resetChoices();
    if (!id) return;
    startLoading(async () => {
      const result = await onLoadCreator(videoId, id);
      if (result.ok) setCreator(result.data);
      else setCreatorError(result.error);
    });
  }

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
      <DisabledReason reason="Optional: connect a TikTok profile (Connections) to post this video organically. The campaign does not need it.">
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

  const handle = creator?.username ? `@${creator.username}` : null;
  const disclosureMissing = disclose && !yourBrand && !branded;
  const brandedPrivate = disclose && branded && privacy === "SELF_ONLY";
  const tooLong = creator?.tooLong ?? false;
  const ready =
    !!creator &&
    !tooLong &&
    privacy !== "" &&
    caption.trim().length > 0 &&
    !disclosureMissing &&
    !brandedPrivate;

  return (
    <ConfirmDialog
      trigger={trigger}
      title="Post to TikTok"
      description={
        creator ? (
          <span className="flex items-center gap-2">
            {creator.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={creator.avatarUrl}
                alt=""
                className="size-8 shrink-0 rounded-full border border-border object-cover"
              />
            ) : null}
            <span>
              Posting to <strong className="text-foreground">{creator.displayName}</strong>
              {handle ? <span className="text-muted-foreground"> ({handle})</span> : null} on
              TikTok.
            </span>
          </span>
        ) : loadingCreator ? (
          "Loading the TikTok account…"
        ) : (
          "Choose the TikTok profile to post to."
        )
      }
      confirmLabel="Post on TikTok"
      pendingLabel="Sending to TikTok…"
      confirmDisabled={!ready}
      onOpenChange={(open) => {
        if (open) {
          setCaption(defaultCaption);
          loadCreator(profileId);
        }
      }}
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
              interactions: {
                allowComment: allowComment && !creator?.commentDisabled,
                allowDuet: allowDuet && !creator?.duetDisabled,
                allowStitch: allowStitch && !creator?.stitchDisabled,
              },
              disclosure: { enabled: disclose, yourBrand, brandedContent: branded },
              consent: true,
            })
      }
      onSuccess={resetChoices}
    >
      <div className="grid gap-4">
        {available.length > 1 ? (
          <SelectField
            id={`${uid}-profile`}
            label="TikTok profile"
            value={profileId}
            onChange={(e) => {
              const id = e.currentTarget.value;
              setProfileId(id);
              loadCreator(id);
            }}
            options={[
              { value: "", label: "Choose a profile" },
              ...available.map((p) => ({ value: p.id, label: p.displayName })),
            ]}
          />
        ) : null}

        {videoUrl ? (
          <video
            src={videoUrl}
            controls
            muted
            playsInline
            preload="metadata"
            aria-label="Preview of the video to post"
            className="max-h-64 w-full rounded-lg border border-border bg-black object-contain"
          />
        ) : null}

        <FormError message={creatorError} />

        {creator ? (
          <>
            {tooLong ? (
              <FormError
                message={`This video is ${Math.round(videoDurationSec ?? creator.videoDurationSec ?? 0)} s long; this TikTok account can post videos up to ${creator.maxVideoPostDurationSec} s.`}
              />
            ) : null}

            <TextAreaField
              id={`${uid}-caption`}
              label="Caption"
              value={caption}
              onChange={(e) => setCaption(e.currentTarget.value)}
              maxLength={MAX_CAPTION}
              rows={3}
              hint={`Prefilled from the first ad text, edit it freely. ${caption.length}/${MAX_CAPTION} characters.`}
            />

            <div className="grid content-start gap-1.5">
              <label htmlFor={`${uid}-privacy`} className="text-sm font-medium">
                Who can see this video
              </label>
              <select
                id={`${uid}-privacy`}
                value={privacy}
                onChange={(e) => setPrivacy(e.currentTarget.value as TikTokPrivacyLevel | "")}
                className="h-10 rounded-lg border border-border bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <option value="" disabled>
                  Choose who can see this video
                </option>
                {creator.privacyLevelOptions.map((level) => {
                  const blocked = level === "SELF_ONLY" && disclose && branded;
                  return (
                    <option
                      key={level}
                      value={level}
                      disabled={blocked}
                      title={blocked ? BRANDED_NOT_PRIVATE : undefined}
                    >
                      {PRIVACY_LABEL[level]}
                      {blocked ? " (not available for branded content)" : ""}
                    </option>
                  );
                })}
              </select>
              {!postingAudited ? (
                <p className="text-xs text-muted-foreground">
                  Only &ldquo;Only me&rdquo; is available until TikTok audits Trendcart&rsquo;s app.
                  You can change the visibility in the TikTok app after posting.
                </p>
              ) : null}
              {brandedPrivate ? (
                <p className="text-xs text-warning">{BRANDED_NOT_PRIVATE}</p>
              ) : null}
            </div>

            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Allow users to</legend>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <InteractionBox
                  id={`${uid}-comment`}
                  label="Comment"
                  checked={allowComment}
                  disabled={creator.commentDisabled}
                  onChange={setAllowComment}
                />
                <InteractionBox
                  id={`${uid}-duet`}
                  label="Duet"
                  checked={allowDuet}
                  disabled={creator.duetDisabled}
                  onChange={setAllowDuet}
                />
                <InteractionBox
                  id={`${uid}-stitch`}
                  label="Stitch"
                  checked={allowStitch}
                  disabled={creator.stitchDisabled}
                  onChange={setAllowStitch}
                />
              </div>
            </fieldset>

            <div className="grid gap-2 rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-3">
                <label htmlFor={`${uid}-disclose`} className="grid gap-0.5 text-sm">
                  <span className="font-medium">Disclose video content</span>
                  <span className="text-xs text-muted-foreground">
                    Turn on to disclose that this video promotes goods or services in exchange for
                    something of value. It could promote yourself, a third party, or both.
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
                      onChange={(e) => {
                        const next = e.currentTarget.checked;
                        setBranded(next);
                        // Branded content cannot be private: clear "Only me".
                        if (next && privacy === "SELF_ONLY") setPrivacy("");
                      }}
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
                    <p className="text-xs text-warning">{DISCLOSURE_REQUIRED}</p>
                  ) : branded ? (
                    <p className="text-xs text-muted-foreground">
                      Your video will be labeled as &lsquo;Paid partnership&rsquo;.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Your video will be labeled as &lsquo;Promotional content&rsquo;.
                    </p>
                  )}
                </div>
              ) : null}
            </div>

            <div className="grid gap-1.5 rounded-lg bg-surface-2 p-3 text-xs text-muted-foreground">
              <p>
                When you click <strong className="text-foreground">Post on TikTok</strong>, this
                video and caption will be published to{" "}
                <strong className="text-foreground">{handle ?? creator.displayName}</strong>
                &rsquo;s TikTok account with the settings above. Nothing is sent to TikTok before
                you click.
              </p>
              <p>
                By posting, you agree to TikTok&rsquo;s{" "}
                {disclose && branded ? (
                  <>
                    <ExternalLegal href={BC_POLICY_URL}>Branded Content Policy</ExternalLegal>{" "}
                    and{" "}
                  </>
                ) : null}
                <ExternalLegal href={MUSIC_URL}>Music Usage Confirmation</ExternalLegal>.
              </p>
              <p>
                After you post, it may take a few minutes for the video to process and appear on
                your TikTok profile. Its status shows below the video.
              </p>
              {disclosureMissing ? <p className="text-warning">{DISCLOSURE_REQUIRED}</p> : null}
            </div>
          </>
        ) : null}
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

/** Link to the published post, else to the creator's profile (private posts have no public id). */
function PostLink({ post }: { post: TikTokPostDTO }) {
  const href = post.postUrl ?? post.profileUrl;
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-brand-text underline-offset-4 hover:underline"
    >
      {post.postUrl ? "View the post on TikTok" : "Open the TikTok profile"}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

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
          {p.status === "published" ? <PostLink post={p} /> : null}
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
