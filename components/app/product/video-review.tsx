"use client";

import {
  CheckIcon,
  ExternalLinkIcon,
  FilmIcon,
  LoaderIcon,
  PlusIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import type {
  GatePartState,
  TikTokAdAccountOptionDTO,
  TikTokProfileOptionDTO,
  VideoDTO,
} from "@/lib/services/types";

import type { ActionResult } from "../action-result";
import { Pill } from "../badges";
import { ConfirmDialog } from "../confirm-dialog";
import { DisabledReason } from "../disabled-reason";
import { FormError, FormSuccess, SelectField, TextAreaField, TextField } from "../form-controls";
import { formatNumber } from "../format";
import type { StatusTone } from "../product-status";
import { ProductThumb } from "../product-thumb";
import { ComplianceReportView } from "./compliance-report";
import { PostList, PostToTikTokButton, type PublishRequest } from "./post-dialog";

const ORIGIN_LABEL: Record<VideoDTO["origin"], string> = {
  imported: "Imported link",
  related_search: "Found by search",
  user_supplied: "Added by your team",
};

type Meta = {
  durationSec?: number;
  caption?: string;
  stats?: { views?: number };
  displayName?: string;
};

function metaOf(v: VideoDTO): Meta {
  return (v.metadata ?? {}) as Meta;
}

function formatDuration(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Why the approve button is disabled for this video (null = it can be approved). */
export function approveBlocker(v: VideoDTO): string | null {
  if (v.approval === "approved" && v.onShopify)
    return "Already approved and on the Shopify product.";
  if (v.checkError) return "The ad rules check could not run on this video.";
  if (!v.compliance) return "Wait for the ad rules check to finish.";
  if (v.compliance.overall === "fail") return "This video breaks TikTok ad rules.";
  return null;
}

function approvalPill(v: VideoDTO): { label: string; tone: StatusTone } {
  if (v.approval === "approved") {
    return v.onShopify
      ? { label: "Approved", tone: "success" }
      : { label: "Approved, upload not finished", tone: "action" };
  }
  if (v.approval === "rejected") return { label: "Rejected", tone: "danger" };
  return { label: "Pending review", tone: "neutral" };
}

export type VideoReviewProps = {
  videos: VideoDTO[];
  /** GATE 3 is open for video decisions (product at GATE 3, videos part not approved). */
  open: boolean;
  /** The build step is still checking videos. */
  checking: boolean;
  pagePart: GatePartState;
  videosPart: GatePartState;
  canReview: boolean;
  /** Owner / media buyer: may choose the TikTok Ads account and approve the videos part. */
  canChooseAdAccount: boolean;
  /** Brand selling currency (the exchange rate is 1 brand unit = ? advertiser units). */
  brandCurrency: string;
  canPublish: boolean;
  approverLabel: string;
  adAccounts: TikTokAdAccountOptionDTO[];
  /** TikTok Ads account chosen with the videos part, once approved. */
  chosenAdConnectionId: string | null;
  profiles: TikTokProfileOptionDTO[];
  postingAudited: boolean;
  defaultCaption: string;
  onApprove: (videoId: string) => Promise<ActionResult>;
  onReject: (videoId: string, input: { note?: string }) => Promise<ActionResult>;
  onAdd: (input: { url: string }) => Promise<ActionResult>;
  onRecheck: (videoId: string) => Promise<ActionResult>;
  onApproveVideos: (input: {
    adConnectionId?: string;
    fxRate?: number;
    note?: string;
  }) => Promise<ActionResult>;
  onPublish: (input: PublishRequest) => Promise<ActionResult>;
};

/**
 * Video library: candidate cards with their ad rules check, per-video
 * approve / reject while GATE 3 is open, adding a video by link, the TikTok
 * Ads account choice and the videos part approval; posting from approved
 * videos at any time after.
 */
export function VideoReview(props: VideoReviewProps) {
  const { videos, open, canReview } = props;
  const visible = open ? videos : videos.filter((v) => v.approval !== "rejected");
  const rejected = videos.length - visible.length;
  const chosenAccount = props.adAccounts.find((a) => a.id === props.chosenAdConnectionId) ?? null;

  return (
    <div className="grid gap-5">
      {open && canReview ? <AddVideoForm onAdd={props.onAdd} /> : null}

      {visible.length === 0 ? (
        props.checking ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            <span className="sr-only">Looking for videos of this product…</span>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-72 rounded-xl bg-surface-2 motion-safe:animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl border border-dashed border-border-strong p-4 text-sm text-muted-foreground">
            <FilmIcon aria-hidden="true" className="size-5 shrink-0" />
            <p>
              {open
                ? "No videos yet. Add a TikTok video of this product with its link."
                : "No videos were approved for this product."}
            </p>
          </div>
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Videos">
          {visible.map((v) => (
            <li key={v.id}>
              <VideoCard video={v} {...props} />
            </li>
          ))}
        </ul>
      )}
      {!open && rejected > 0 ? (
        <p className="text-xs text-muted-foreground">
          {rejected} rejected video{rejected === 1 ? "" : "s"} not shown.
        </p>
      ) : null}
      {!open && chosenAccount ? (
        <p className="text-xs text-muted-foreground">
          Campaign account: {chosenAccount.name} ({chosenAccount.advertiserId})
        </p>
      ) : null}

      {open ? <VideosPartApproval {...props} /> : null}
    </div>
  );
}

function VideoCard({
  video: v,
  open,
  checking,
  canReview,
  canPublish,
  approverLabel,
  profiles,
  postingAudited,
  defaultCaption,
  onApprove,
  onReject,
  onRecheck,
  onPublish,
}: VideoReviewProps & { video: VideoDTO }) {
  const meta = metaOf(v);
  const pill = approvalPill(v);
  const blocker = approveBlocker(v);
  const [pending, startTransition] = useTransition();
  const [rechecking, startRecheck] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const uid = useId();
  const author = v.author ? `@${v.author}` : null;

  const approveLabel = v.approval === "approved" && !v.onShopify ? "Approve again" : "Approve";
  const approveButton = (
    <Button
      size="lg"
      disabled={!canReview || pending || blocker !== null}
      aria-busy={pending}
      onClick={() => {
        setError(null);
        startTransition(async () => {
          const result = await onApprove(v.id);
          if (!result.ok) setError(result.error);
        });
      }}
    >
      {pending ? (
        <LoaderIcon aria-hidden="true" className="motion-safe:animate-spin" />
      ) : (
        <CheckIcon aria-hidden="true" />
      )}
      {pending ? "Uploading to Shopify…" : approveLabel}
    </Button>
  );

  const canRecheck =
    open && canReview && v.approval !== "rejected" && (v.complianceOutdated || !!v.checkError);
  const recheckButton = canRecheck ? (
    <Button
      variant="outline"
      size="lg"
      disabled={pending || rechecking}
      aria-busy={rechecking}
      onClick={() => {
        setError(null);
        startRecheck(async () => {
          const result = await onRecheck(v.id);
          if (!result.ok) setError(result.error);
        });
      }}
    >
      {rechecking ? (
        <LoaderIcon aria-hidden="true" className="motion-safe:animate-spin" />
      ) : (
        <RefreshCwIcon aria-hidden="true" />
      )}
      {rechecking ? "Checking…" : "Check again"}
    </Button>
  ) : null;

  const rejectTrigger = (
    <Button variant="outline" size="lg" disabled={!canReview || pending}>
      <XIcon aria-hidden="true" />
      Reject
    </Button>
  );

  return (
    <article
      aria-labelledby={`${uid}-title`}
      className="grid h-full content-start gap-3 rounded-xl border border-border bg-background p-3"
    >
      <div className="flex gap-3">
        <ProductThumb
          src={v.thumbnailUrl}
          alt={`Thumbnail of the TikTok video${author ? ` by ${author}` : ""}`}
          className="aspect-[9/16] w-20 shrink-0"
        />
        <div className="grid min-w-0 content-start gap-1.5">
          <h4 id={`${uid}-title`} className="truncate text-sm font-medium">
            {author ?? "Unknown creator"}
          </h4>
          <p className="text-xs text-muted-foreground">
            {ORIGIN_LABEL[v.origin]}
            {typeof meta.durationSec === "number" ? ` · ${formatDuration(meta.durationSec)}` : ""}
            {typeof meta.stats?.views === "number"
              ? ` · ${formatNumber(meta.stats.views)} views`
              : ""}
          </p>
          <a
            href={v.tiktokUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-1 rounded-sm text-xs text-brand-text underline-offset-4 hover:underline"
          >
            Open on TikTok
            <ExternalLinkIcon aria-hidden="true" className="size-3" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          <Pill tone={pill.tone} className="w-fit">
            {pill.label}
          </Pill>
        </div>
      </div>

      {meta.caption ? (
        <p className="line-clamp-2 text-xs text-pretty text-muted-foreground">{meta.caption}</p>
      ) : null}

      {v.checkError ? (
        <p className="flex gap-2 rounded-lg border border-danger/30 bg-danger/10 px-2.5 py-2 text-xs text-danger">
          <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>Ad rules check failed: {v.checkError}</span>
        </p>
      ) : v.compliance ? (
        <ComplianceReportView report={v.compliance} />
      ) : (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          {checking ? (
            <>
              <LoaderIcon aria-hidden="true" className="size-3.5 motion-safe:animate-spin" />
              Checking against TikTok ad rules…
            </>
          ) : (
            "Not checked against the ad rules yet."
          )}
        </p>
      )}

      {v.complianceOutdated ? (
        <p className="flex gap-2 rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-2 text-xs text-warning">
          <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>
            This check was made against older ad texts. The page copy changed since: check the video
            again before using it.
          </span>
        </p>
      ) : null}

      {v.approval === "approved" && !v.onShopify ? (
        <p className="text-xs text-warning">
          The upload to the Shopify product did not finish. Approve it again to resume.
        </p>
      ) : null}

      {open ? (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          {v.approval === "approved" && v.onShopify ? null : !canReview ? (
            <DisabledReason
              reason={`Waiting for: ${approverLabel}. Your role can view but not approve.`}
            >
              {approveButton}
            </DisabledReason>
          ) : blocker ? (
            <DisabledReason reason={blocker}>{approveButton}</DisabledReason>
          ) : (
            approveButton
          )}
          {v.approval !== "rejected" ? (
            canReview ? (
              <ConfirmDialog
                trigger={rejectTrigger}
                title="Reject this video?"
                description={
                  v.onShopify
                    ? "It is removed from the Shopify product and will not be used in the campaign."
                    : "It will not be used in the campaign."
                }
                confirmLabel="Reject video"
                pendingLabel="Rejecting…"
                destructive
                onConfirm={() => onReject(v.id, { note: note.trim() || undefined })}
                onSuccess={() => setNote("")}
              >
                <TextAreaField
                  id={`${uid}-note`}
                  label="Why? (optional)"
                  value={note}
                  onChange={(e) => setNote(e.currentTarget.value)}
                  maxLength={2000}
                  rows={2}
                />
              </ConfirmDialog>
            ) : (
              <DisabledReason reason="Your role can view but not reject videos.">
                {rejectTrigger}
              </DisabledReason>
            )
          ) : null}
          {recheckButton}
          <FormError message={error} />
        </div>
      ) : null}

      {v.approval === "approved" && v.onShopify ? (
        <div className="grid gap-2 border-t border-border pt-3">
          <PostToTikTokButton
            videoId={v.id}
            profiles={profiles}
            posts={v.posts}
            postingAudited={postingAudited}
            defaultCaption={defaultCaption}
            canPublish={canPublish}
            onPublish={onPublish}
          />
          <PostList posts={v.posts} />
        </div>
      ) : null}
    </article>
  );
}

function AddVideoForm({ onAdd }: { onAdd: (input: { url: string }) => Promise<ActionResult> }) {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const urlError = result && !result.ok ? result.fieldErrors?.url?.[0] : undefined;
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setResult(null);
        startTransition(async () => {
          const r = await onAdd({ url });
          setResult(r);
          if (r.ok) setUrl("");
        });
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <TextField
          id="add-video-url"
          label="Add a TikTok video of this product"
          type="url"
          inputMode="url"
          placeholder="https://www.tiktok.com/@creator/video/…"
          value={url}
          onChange={(e) => setUrl(e.currentTarget.value)}
          error={urlError}
          hint="It is checked against TikTok ad rules right away. Only the link and its details are stored."
          className="flex-1"
        />
        <Button
          type="submit"
          size="lg"
          variant="outline"
          className="h-10 sm:mt-6.5"
          disabled={pending || url.trim() === ""}
          aria-busy={pending}
        >
          {pending ? (
            <LoaderIcon aria-hidden="true" className="motion-safe:animate-spin" />
          ) : (
            <PlusIcon aria-hidden="true" />
          )}
          {pending ? "Checking the video…" : "Add video"}
        </Button>
      </div>
      {result && !result.ok && !urlError ? <FormError message={result.error} /> : null}
      <FormSuccess message={result?.ok ? "Video added and checked." : null} />
    </form>
  );
}

/** Parses a positive decimal ("0,92" accepted); null when invalid or empty. */
function parseRate(value: string): number | null {
  const n = Number.parseFloat(value.trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 && n <= 1_000_000 ? n : null;
}

function VideosPartApproval({
  videos,
  pagePart,
  canReview,
  canChooseAdAccount,
  brandCurrency,
  adAccounts,
  onApproveVideos,
}: VideoReviewProps) {
  const usable = adAccounts.filter((a) => a.usable);
  const unusable = adAccounts.filter((a) => !a.usable);
  const [accountId, setAccountId] = useState(usable.length === 1 ? usable[0]!.id : "");
  const [fx, setFx] = useState("");
  const [note, setNote] = useState("");
  const ready = videos.filter((v) => v.approval === "approved" && v.onShopify);
  const uploading = videos.some((v) => v.approval === "approved" && !v.onShopify);
  const account = usable.find((a) => a.id === accountId) ?? null;
  const needsFx = !!account?.needsFxRate;
  const rate = needsFx ? parseRate(fx) : null;
  const canApprove = canReview && canChooseAdAccount;

  const blocker = !canApprove
    ? "Waiting for: Media buyer or Owner. They choose the TikTok Ads account and approve the videos for the campaign."
    : ready.length === 0
      ? "Approve at least one video first."
      : uploading
        ? "A video is not on the Shopify product yet. Approve it again or reject it."
        : usable.length === 0
          ? "Connect a TikTok Ads account to this brand first."
          : !account
            ? "Choose the TikTok Ads account."
            : needsFx && rate === null
              ? `Enter the exchange rate from ${brandCurrency} to ${account.currency}.`
              : null;

  const trigger = (
    <Button size="xl" disabled={blocker !== null}>
      <CheckIcon aria-hidden="true" />
      Approve {ready.length} video{ready.length === 1 ? "" : "s"} for the campaign
    </Button>
  );

  return (
    <div className="grid gap-4 border-t border-border pt-4">
      <h4 className="text-sm font-semibold">Approve the videos part</h4>
      {adAccounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No TikTok Ads account is connected to this brand.{" "}
          <Link href="/app/connections" className="text-brand-text underline underline-offset-4">
            Connect one
          </Link>{" "}
          to prepare the campaign.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            id="videos-ad-account"
            label="TikTok Ads account for the campaign"
            value={accountId}
            disabled={!canApprove}
            onChange={(e) => {
              setAccountId(e.currentTarget.value);
              setFx("");
            }}
            className="max-w-md"
            hint={
              unusable.length > 0 ? (
                <>
                  Not available:{" "}
                  {unusable
                    .map((a) => `${a.name} (${a.unusableReason ?? "reconnect it"})`)
                    .join("; ")}
                  .
                </>
              ) : (
                "The campaign is created on this account, paused."
              )
            }
            options={[
              ...(usable.length === 1 ? [] : [{ value: "", label: "Choose an account" }]),
              ...usable.map((a) => ({
                value: a.id,
                label: `${a.name} (${a.advertiserId})${a.currency ? `, ${a.currency}` : ""}`,
              })),
            ]}
          />
          {needsFx && account ? (
            <TextField
              id="videos-fx-rate"
              label={`Exchange rate: 1 ${brandCurrency} = ? ${account.currency}`}
              inputMode="decimal"
              placeholder="e.g. 0.92"
              value={fx}
              disabled={!canApprove}
              onChange={(e) => setFx(e.currentTarget.value)}
              suffix={account.currency ?? undefined}
              hint={`This account bills in ${account.currency}, the brand sells in ${brandCurrency}. The test budget is converted with this rate and the rate is recorded with your approval.`}
              error={fx.trim() !== "" && rate === null ? "Enter a number above zero." : undefined}
            />
          ) : null}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {blocker ? (
          <DisabledReason reason={blocker}>{trigger}</DisabledReason>
        ) : (
          <ConfirmDialog
            trigger={trigger}
            title="Approve these videos for the campaign?"
            description={
              <>
                {ready.length} video{ready.length === 1 ? "" : "s"} will be used on{" "}
                <strong className="text-foreground">{account?.name}</strong>
                {needsFx && rate !== null ? (
                  <>
                    {" "}
                    (1 {brandCurrency} = {rate} {account?.currency})
                  </>
                ) : null}
                .{" "}
                {pagePart === "approved"
                  ? "Trendcart then prepares the campaign on TikTok Ads, paused. Nothing spends until someone approves the launch at Gate 4."
                  : "The page still needs its approval: the campaign is prepared, paused, once both parts are approved."}
              </>
            }
            confirmLabel="Approve videos"
            pendingLabel="Approving…"
            onConfirm={() =>
              onApproveVideos({
                adConnectionId: accountId,
                ...(needsFx && rate !== null ? { fxRate: rate } : {}),
                note: note.trim() || undefined,
              })
            }
          >
            <TextAreaField
              id="videos-note"
              label="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.currentTarget.value)}
              maxLength={2000}
              rows={2}
            />
          </ConfirmDialog>
        )}
        {blocker && canApprove ? <p className="text-sm text-muted-foreground">{blocker}</p> : null}
      </div>
    </div>
  );
}
