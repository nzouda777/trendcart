"use client";

import {
  CheckCircle2Icon,
  ExternalLinkIcon,
  LoaderIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCwIcon,
  Trash2Icon,
  XCircleIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import type { PageCopy } from "@/lib/domain/contracts";

/** Same as TEMPLATE_FIELD_MAX in lib/domain/contracts (not imported: keeps zod out of the bundle). */
const TEMPLATE_FIELD_MAX = 5000;
import type { ShopifyPageDTO } from "@/lib/services/types";
import { cn } from "@/lib/utils";

import { fieldError, type ActionResult } from "../action-result";
import { Pill } from "../badges";
import { ConfirmDialog } from "../confirm-dialog";
import { FormError, FormSuccess, TextAreaField, TextField } from "../form-controls";
import { formatDateTime, formatMoney, formatPercent } from "../format";
import { Notice } from "../surface";
import { rebuildLimitAction } from "./limit-action";
import { STALE_COPY_FIELD } from "./page-state";

type Prices = {
  currency: string;
  sellingPrice: number | null;
  compareAtPrice: number | null;
  marginRate: number | null;
};

const HIGHLIGHTS = { min: 3, max: 6 };
const FAQ = { min: 3, max: 8 };
const AD_TEXTS = { min: 1, max: 5, chars: 100 };
const SEO = { title: 70, description: 320 };

export type PublishClaimView = { startedAt: string; startedLabel: string; stale: boolean };

/**
 * GATE 3, page part: preview of the copy that goes on the Shopify draft, with
 * inline editing, regenerate, reject and "approve and publish". `open` is
 * false once the page is approved or outside GATE 3 (read-only preview).
 *
 * The approval is bound to `copyVersion`, the version of the copy rendered
 * here. After an edit, the version returned by the save is used until the
 * server props catch up, so the approval always names the copy on screen.
 * While `publishing`, every page action is disabled (the parent keeps
 * polling until the publish is recorded). Once the server reports the claim
 * as stale (`publishClaim.stale`, the same 5-minute rule approvePage uses to
 * take a stuck claim over), only "Retry approval" is offered; edit,
 * regenerate and reject stay disabled.
 */
export function PageReview({
  copy,
  copyVersion,
  generatedAt,
  prices,
  shopify,
  open,
  publishing = false,
  publishClaim = null,
  canEdit,
  canPublish,
  approverLabel,
  onSave,
  onRegenerate,
  onReject,
  onApprove,
}: {
  copy: PageCopy;
  copyVersion: string | null;
  generatedAt: string | null;
  prices: Prices;
  shopify: ShopifyPageDTO | null;
  open: boolean;
  publishing?: boolean;
  /**
   * The publish claim while `publishing`. `startedLabel` is the relative time
   * ("3 minutes ago"), formatted on the server so the hydrated text matches.
   */
  publishClaim?: PublishClaimView | null;
  canEdit: boolean;
  canPublish: boolean;
  approverLabel: string;
  onSave: (
    copy: Partial<PageCopy>,
  ) => Promise<ActionResult<{ previewUrl: string | null; copyVersion: string | null }>>;
  onRegenerate: () => Promise<ActionResult>;
  onReject: (input: { note?: string }) => Promise<ActionResult>;
  onApprove: (input: { copyVersion: string; note?: string }) => Promise<ActionResult>;
}) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [freshPreview, setFreshPreview] = useState<string | null>(null);
  // Version returned by the last save, valid only while the props still carry
  // the version it replaced (a later server render always wins).
  const [savedVersion, setSavedVersion] = useState<{ from: string | null; to: string } | null>(
    null,
  );
  const router = useRouter();
  const [reloading, startReload] = useTransition();
  const [reloaded, setReloaded] = useState(false);
  const previewUrl = freshPreview ?? shopify?.previewUrl ?? null;
  const reviewedVersion =
    savedVersion && savedVersion.from === copyVersion ? savedVersion.to : copyVersion;
  const stuck = publishing && Boolean(publishClaim?.stale);

  return (
    <div className="grid gap-5">
      <ShopifyLinks shopify={shopify} previewUrl={previewUrl} />

      {publishing && stuck && publishClaim ? (
        <Notice
          tone="warning"
          title="Publishing seems stuck. Check the product in Shopify, then retry."
        >
          <PublishStarted claim={publishClaim} />{" "}
          {open && canPublish
            ? "Retry approval publishes the page again; it is safe if Shopify already shows the product as Active."
            : null}
        </Notice>
      ) : publishing ? (
        <div
          role="status"
          className="flex items-center gap-3 rounded-xl border border-brand-border bg-brand-soft p-3 text-sm"
        >
          <LoaderIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-brand-text motion-safe:animate-spin"
          />
          <p>
            <span className="font-medium">Publishing to Shopify…</span>{" "}
            <span className="text-muted-foreground">
              The page was approved. Page actions are paused until the store confirms; this screen
              updates on its own.
              {publishClaim ? (
                <>
                  {" "}
                  <PublishStarted claim={publishClaim} />
                </>
              ) : null}
            </span>
          </p>
        </div>
      ) : null}

      {editing ? (
        <PageCopyEditor
          copy={copy}
          locked={publishing}
          onCancel={() => setEditing(false)}
          onSave={async (next) => {
            const from = copyVersion;
            const result = await onSave(next);
            if (result.ok) {
              setEditing(false);
              setSaved("Saved. The Shopify draft was updated.");
              if (result.data.previewUrl) setFreshPreview(result.data.previewUrl);
              if (result.data.copyVersion) {
                setSavedVersion({ from, to: result.data.copyVersion });
              }
            }
            return result;
          }}
        />
      ) : (
        <>
          <PageCopyPreview copy={copy} prices={prices} />
          <p className="text-xs text-muted-foreground">
            {generatedAt ? `Copy written ${formatDateTime(generatedAt)}.` : null} AI-written: check
            claims, sizes and shipping promises before publishing.
          </p>
          <FormSuccess message={saved} />
          {reloading || reloaded ? (
            <p role="status" aria-busy={reloading} className="text-sm text-muted-foreground">
              {reloading
                ? "Loading the latest version of the page…"
                : "This is the latest version of the page. Review it before approving."}
            </p>
          ) : null}
        </>
      )}

      {open && !editing ? (
        canEdit ? (
          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:flex-wrap sm:items-center">
            {canPublish ? (
              <ApprovePageButton
                shopDomain={shopify?.shopDomain ?? null}
                price={
                  prices.sellingPrice !== null
                    ? formatMoney(prices.sellingPrice, prices.currency)
                    : null
                }
                copyVersion={reviewedVersion}
                retry={stuck}
                disabled={(publishing && !stuck) || reloading}
                onApprove={onApprove}
                onReload={() => {
                  setSaved(null);
                  setReloaded(false);
                  startReload(() => {
                    router.refresh();
                    setReloaded(true);
                  });
                }}
              />
            ) : null}
            <Button
              variant="outline"
              size="xl"
              disabled={publishing}
              onClick={() => {
                setSaved(null);
                setEditing(true);
              }}
            >
              <PencilIcon aria-hidden="true" />
              Edit copy
            </Button>
            <RegenerateButton onRegenerate={onRegenerate} disabled={publishing} />
            <RejectPageButton onReject={onReject} disabled={publishing} />
            {!canPublish ? (
              <p className="text-sm text-muted-foreground">
                Your role can edit the page but not publish it.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="border-t border-border pt-4 text-sm text-muted-foreground">
            Waiting for: {approverLabel}. Your role can view but not approve.
          </p>
        )
      ) : null}
    </div>
  );
}

/** "Started 3 minutes ago." with the exact UTC time on hover. */
function PublishStarted({ claim }: { claim: PublishClaimView }) {
  return (
    <>
      Started{" "}
      <time dateTime={claim.startedAt} title={formatDateTime(claim.startedAt)}>
        {claim.startedLabel}
      </time>
      .
    </>
  );
}

/* Links to Shopify ----------------------------------------------------------- */

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-brand-text underline-offset-4 hover:underline"
    >
      {children}
      <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function ShopifyLinks({
  shopify,
  previewUrl,
}: {
  shopify: ShopifyPageDTO | null;
  previewUrl: string | null;
}) {
  if (!shopify) {
    return (
      <p className="rounded-xl border border-dashed border-border-strong p-3 text-sm text-muted-foreground">
        No Shopify draft is linked to this product yet.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
        <Pill tone={shopify.status === "active" ? "success" : "neutral"}>
          {shopify.status === "active"
            ? "Published"
            : shopify.status === "draft"
              ? "Draft"
              : "Archived"}
        </Pill>
        <span className="truncate">{shopify.shopDomain}</span>
        <span className="truncate font-mono text-xs text-muted-foreground">/{shopify.handle}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {shopify.storefrontUrl ? (
          <ExternalLink href={shopify.storefrontUrl}>View on store</ExternalLink>
        ) : previewUrl ? (
          <ExternalLink href={previewUrl}>Preview the draft</ExternalLink>
        ) : null}
        <ExternalLink href={shopify.adminUrl}>Open in Shopify admin</ExternalLink>
      </div>
    </div>
  );
}

/* Preview -------------------------------------------------------------------- */

/**
 * The AI-written description is HTML: it is rendered in a sandboxed iframe
 * (no scripts, no forms, no top navigation) instead of being injected into
 * the app. Light background on purpose: it previews a storefront.
 *
 * SECURITY (QA M2 N7): the sandbox must NEVER combine `allow-scripts` with
 * `allow-same-origin`. `allow-same-origin` is only here so onLoad can read
 * the body height; with scripts also allowed, the description HTML would run
 * with the app's origin (session, server actions) and could remove its own
 * sandbox. If scripts are ever needed, drop `allow-same-origin` and measure
 * the height another way.
 */
function DescriptionFrame({ html, title }: { html: string; title: string }) {
  const [height, setHeight] = useState(240);
  const doc = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;padding:16px;font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:#18181b;background:#fff;overflow-wrap:anywhere}
img,video{max-width:100%;height:auto}h1,h2,h3{line-height:1.25}a{color:#15803d}
</style></head><body>${html}</body></html>`;
  return (
    <iframe
      title={`Product description: ${title}`}
      srcDoc={doc}
      // Never add allow-scripts next to allow-same-origin (see the comment above).
      sandbox="allow-same-origin"
      referrerPolicy="no-referrer"
      loading="lazy"
      onLoad={(e) => {
        const body = e.currentTarget.contentDocument?.body;
        if (body) setHeight(Math.min(Math.max(body.scrollHeight + 4, 120), 640));
      }}
      style={{ height }}
      className="w-full rounded-xl border border-border bg-white"
    />
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-medium tracking-wide text-muted-foreground">{children}</h3>;
}

export function PageCopyPreview({ copy, prices }: { copy: PageCopy; prices: Prices }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="grid min-w-0 content-start gap-5">
        <div className="grid gap-2">
          <p className="text-xl font-semibold text-balance">{copy.title}</p>
          <p className="flex flex-wrap items-baseline gap-2 tabular-nums">
            <span className="text-lg font-semibold">
              {formatMoney(prices.sellingPrice, prices.currency)}
            </span>
            {prices.compareAtPrice !== null ? (
              <span className="text-sm text-muted-foreground line-through">
                <span className="sr-only">Compare-at price </span>
                {formatMoney(prices.compareAtPrice, prices.currency)}
              </span>
            ) : null}
            {prices.marginRate !== null ? (
              <span className="text-xs text-muted-foreground">
                Margin {formatPercent(prices.marginRate, 1)}
              </span>
            ) : null}
          </p>
        </div>
        <div className="grid gap-2">
          <SubHeading>Highlights</SubHeading>
          <ul className="grid list-disc gap-1 pl-4 text-sm marker:text-brand-text">
            {copy.highlights.map((h, i) => (
              <li key={`${i}-${h}`}>{h}</li>
            ))}
          </ul>
        </div>
        <div className="grid gap-2">
          <SubHeading>Description</SubHeading>
          <DescriptionFrame html={copy.descriptionHtml} title={copy.title} />
        </div>
        <div className="grid gap-2">
          <SubHeading>Guarantee</SubHeading>
          <p className="text-sm text-pretty">{copy.guarantee}</p>
        </div>
        <div className="grid gap-2">
          <SubHeading>FAQ</SubHeading>
          <div className="grid gap-2">
            {copy.faq.map((item, i) => (
              <details
                key={`${i}-${item.question}`}
                className="group rounded-lg border border-border bg-background"
              >
                <summary className="cursor-pointer rounded-lg px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {item.question}
                </summary>
                <p className="px-3 pb-3 text-sm text-pretty text-muted-foreground">{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
        {copy.templateFields?.length ? (
          <div className="grid gap-2">
            <SubHeading>Template sections</SubHeading>
            <dl className="grid gap-2">
              {copy.templateFields.map((f) => (
                <div
                  key={`${f.namespace}.${f.key}`}
                  className="grid gap-1 rounded-lg border border-border bg-background p-3"
                >
                  <dt className="text-xs text-muted-foreground">
                    {f.label}{" "}
                    <span className="font-mono">
                      ({f.namespace}.{f.key})
                    </span>
                  </dt>
                  <dd className="text-sm text-pretty">
                    {f.type === "list.single_line_text_field" ? (
                      <ul className="list-disc pl-4 marker:text-brand-text">
                        {f.value.split("\n").map((item, i) => (
                          <li key={`${i}-${item}`}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      f.value.split(/\n\s*\n/).map((para, i) => (
                        <p key={`${i}-${para.slice(0, 20)}`} className="whitespace-pre-line">
                          {para}
                        </p>
                      ))
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </div>

      <div className="grid min-w-0 content-start gap-5">
        <div className="grid gap-2">
          <SubHeading>Search listing (SEO)</SubHeading>
          {copy.seo ? (
            <div className="grid gap-0.5 rounded-lg border border-border bg-background p-3">
              <p className="text-sm font-medium text-brand-text">{copy.seo.title}</p>
              <p className="text-xs text-pretty text-muted-foreground">{copy.seo.description}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Not set: Shopify uses the title and description.
            </p>
          )}
        </div>
        <div className="grid gap-2">
          <SubHeading>Ad texts</SubHeading>
          <ol className="grid gap-2">
            {copy.adTexts.map((t, i) => (
              <li
                key={`${i}-${t}`}
                className="flex items-start justify-between gap-3 rounded-lg border border-border bg-background p-3 text-sm"
              >
                <span className="text-pretty">{t}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {t.length}/{AD_TEXTS.chars}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

/* Editor --------------------------------------------------------------------- */

type FaqItem = PageCopy["faq"][number];

/** Zod paths come as "copy.faq.1.answer" (patch) or "faq.1.answer" (merged copy). */
function normalizeErrors(fieldErrors: Record<string, string[]> | undefined) {
  const out: Record<string, string> = {};
  for (const [key, messages] of Object.entries(fieldErrors ?? {})) {
    out[key.replace(/^copy\./, "")] = messages[0] ?? "Invalid value.";
  }
  return out;
}

/**
 * Inline copy editor. On a refusal (validation or copy-safety rules) the
 * draft stays as typed and the service message, which names the fields and
 * rules, is shown above the buttons.
 */
function PageCopyEditor({
  copy,
  locked,
  onCancel,
  onSave,
}: {
  copy: PageCopy;
  /** The page is being published: saving is paused, the draft is kept. */
  locked: boolean;
  onCancel: () => void;
  onSave: (copy: Partial<PageCopy>) => Promise<ActionResult<unknown>>;
}) {
  const id = useId();
  const [title, setTitle] = useState(copy.title);
  const [descriptionHtml, setDescriptionHtml] = useState(copy.descriptionHtml);
  const [highlights, setHighlights] = useState(copy.highlights);
  const [faq, setFaq] = useState<FaqItem[]>(copy.faq);
  const [guarantee, setGuarantee] = useState(copy.guarantee);
  const [adTexts, setAdTexts] = useState(copy.adTexts);
  const [seoTitle, setSeoTitle] = useState(copy.seo?.title ?? "");
  const [seoDescription, setSeoDescription] = useState(copy.seo?.description ?? "");
  const [templateFields, setTemplateFields] = useState(copy.templateFields ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = "Enter a title.";
    if (!descriptionHtml.trim()) e.descriptionHtml = "Enter a description.";
    if (!guarantee.trim()) e.guarantee = "Enter a guarantee.";
    highlights.forEach((h, i) => {
      if (!h.trim()) e[`highlights.${i}`] = "Enter a highlight or remove it.";
    });
    faq.forEach((f, i) => {
      if (!f.question.trim()) e[`faq.${i}.question`] = "Enter a question.";
      if (!f.answer.trim()) e[`faq.${i}.answer`] = "Enter an answer.";
    });
    adTexts.forEach((t, i) => {
      if (!t.trim()) e[`adTexts.${i}`] = "Enter a text or remove it.";
      else if (t.trim().length > AD_TEXTS.chars) {
        e[`adTexts.${i}`] = `Keep it to ${AD_TEXTS.chars} characters.`;
      }
    });
    templateFields.forEach((f, i) => {
      if (!f.value.trim()) e[`templateFields.${i}.value`] = "Enter some text for this section.";
    });
    const st = seoTitle.trim();
    const sd = seoDescription.trim();
    if (st || sd || copy.seo) {
      if (!st) e["seo.title"] = "Enter a search title.";
      if (!sd) e["seo.description"] = "Enter a search description.";
    }
    return e;
  }

  function save() {
    if (locked) return;
    setFormError(null);
    const local = validate();
    setErrors(local);
    if (Object.keys(local).length > 0) {
      setFormError("Please check the highlighted fields.");
      return;
    }
    const st = seoTitle.trim();
    const sd = seoDescription.trim();
    const patch: Partial<PageCopy> = {
      title: title.trim(),
      descriptionHtml: descriptionHtml.trim(),
      highlights: highlights.map((h) => h.trim()),
      faq: faq.map((f) => ({ question: f.question.trim(), answer: f.answer.trim() })),
      guarantee: guarantee.trim(),
      adTexts: adTexts.map((t) => t.trim()),
      ...(st && sd ? { seo: { title: st, description: sd } } : {}),
      ...(copy.templateFields
        ? { templateFields: templateFields.map((f) => ({ ...f, value: f.value.trim() })) }
        : {}),
    };
    startTransition(async () => {
      const result = await onSave(patch);
      if (!result.ok) {
        setErrors(normalizeErrors(result.fieldErrors));
        setFormError(result.error);
      }
    });
  }

  return (
    <form
      className="grid gap-5"
      aria-label="Edit page copy"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <TextField
        id={`${id}-title`}
        label="Title"
        value={title}
        onChange={(e) => setTitle(e.currentTarget.value)}
        maxLength={255}
        error={errors.title}
        required
      />

      <TextAreaField
        id={`${id}-description`}
        label="Description (HTML)"
        value={descriptionHtml}
        onChange={(e) => setDescriptionHtml(e.currentTarget.value)}
        rows={8}
        className="font-mono"
        hint="Shown on the product page. Basic HTML: paragraphs, lists, bold."
        error={errors.descriptionHtml}
        required
      />

      <ListEditor
        legend={`Highlights (${HIGHLIGHTS.min} to ${HIGHLIGHTS.max})`}
        items={highlights}
        min={HIGHLIGHTS.min}
        max={HIGHLIGHTS.max}
        addLabel="Add a highlight"
        onAdd={() => setHighlights([...highlights, ""])}
        onRemove={(i) => setHighlights(highlights.filter((_, j) => j !== i))}
        render={(h, i) => (
          <TextField
            id={`${id}-highlight-${i}`}
            label={`Highlight ${i + 1}`}
            value={h}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setHighlights(highlights.map((x, j) => (j === i ? v : x)));
            }}
            error={errors[`highlights.${i}`]}
          />
        )}
      />

      <ListEditor
        legend={`FAQ (${FAQ.min} to ${FAQ.max} questions)`}
        items={faq}
        min={FAQ.min}
        max={FAQ.max}
        addLabel="Add a question"
        onAdd={() => setFaq([...faq, { question: "", answer: "" }])}
        onRemove={(i) => setFaq(faq.filter((_, j) => j !== i))}
        render={(item, i) => (
          <div className="grid gap-2">
            <TextField
              id={`${id}-faq-q-${i}`}
              label={`Question ${i + 1}`}
              value={item.question}
              onChange={(e) => {
                const v = e.currentTarget.value;
                setFaq(faq.map((x, j) => (j === i ? { ...x, question: v } : x)));
              }}
              error={errors[`faq.${i}.question`]}
            />
            <TextAreaField
              id={`${id}-faq-a-${i}`}
              label={`Answer ${i + 1}`}
              value={item.answer}
              rows={2}
              onChange={(e) => {
                const v = e.currentTarget.value;
                setFaq(faq.map((x, j) => (j === i ? { ...x, answer: v } : x)));
              }}
              error={errors[`faq.${i}.answer`]}
            />
          </div>
        )}
      />

      <TextAreaField
        id={`${id}-guarantee`}
        label="Guarantee"
        value={guarantee}
        onChange={(e) => setGuarantee(e.currentTarget.value)}
        rows={2}
        hint="Only promise what the store really offers (returns, shipping)."
        error={errors.guarantee}
        required
      />

      {templateFields.length > 0 ? (
        <fieldset className="grid gap-3 rounded-xl border border-border p-3">
          <legend className="px-1 text-sm font-medium">Template sections</legend>
          {templateFields.map((f, i) => (
            <TextAreaField
              key={`${f.namespace}.${f.key}`}
              id={`${id}-tpl-${i}`}
              label={`${f.label} (${f.namespace}.${f.key})`}
              value={f.value}
              rows={f.type === "single_line_text_field" ? 1 : 4}
              maxLength={TEMPLATE_FIELD_MAX}
              onChange={(e) => {
                const v = e.currentTarget.value;
                setTemplateFields(templateFields.map((x, j) => (j === i ? { ...x, value: v } : x)));
              }}
              hint={
                f.type === "list.single_line_text_field"
                  ? "One item per line."
                  : f.type === "single_line_text_field"
                    ? "One line."
                    : "Plain text. Separate paragraphs with a blank line."
              }
              error={errors[`templateFields.${i}.value`]}
            />
          ))}
        </fieldset>
      ) : null}

      <ListEditor
        legend={`Ad texts (${AD_TEXTS.min} to ${AD_TEXTS.max}, ${AD_TEXTS.chars} characters max)`}
        items={adTexts}
        min={AD_TEXTS.min}
        max={AD_TEXTS.max}
        addLabel="Add an ad text"
        onAdd={() => setAdTexts([...adTexts, ""])}
        onRemove={(i) => setAdTexts(adTexts.filter((_, j) => j !== i))}
        render={(t, i) => (
          <TextField
            id={`${id}-ad-${i}`}
            label={`Ad text ${i + 1}`}
            value={t}
            maxLength={AD_TEXTS.chars}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setAdTexts(adTexts.map((x, j) => (j === i ? v : x)));
            }}
            hint={`${t.length}/${AD_TEXTS.chars}`}
            error={errors[`adTexts.${i}`]}
          />
        )}
      />

      <fieldset className="grid gap-3 rounded-xl border border-border p-3">
        <legend className="px-1 text-sm font-medium">Search listing (SEO)</legend>
        <TextField
          id={`${id}-seo-title`}
          label="Search title"
          value={seoTitle}
          maxLength={SEO.title}
          onChange={(e) => setSeoTitle(e.currentTarget.value)}
          hint={`${seoTitle.length}/${SEO.title}`}
          error={errors["seo.title"]}
        />
        <TextAreaField
          id={`${id}-seo-description`}
          label="Search description"
          value={seoDescription}
          maxLength={SEO.description}
          rows={2}
          onChange={(e) => setSeoDescription(e.currentTarget.value)}
          hint={`${seoDescription.length}/${SEO.description}`}
          error={errors["seo.description"]}
        />
      </fieldset>

      <FormError message={formError} />
      {locked ? (
        <p role="status" className="text-sm text-muted-foreground">
          The page is being published, so it cannot be saved now. Your changes are kept here.
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" size="lg" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" size="lg" disabled={pending || locked} aria-busy={pending}>
          {pending ? "Saving and updating the draft…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

function ListEditor<T>({
  legend,
  items,
  min,
  max,
  addLabel,
  onAdd,
  onRemove,
  render,
}: {
  legend: string;
  items: T[];
  min: number;
  max: number;
  addLabel: string;
  onAdd: () => void;
  onRemove: (index: number) => void;
  render: (item: T, index: number) => React.ReactNode;
}) {
  return (
    <fieldset className="grid gap-3 rounded-xl border border-border p-3">
      <legend className="px-1 text-sm font-medium">{legend}</legend>
      {items.map((item, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
          {render(item, i)}
          <Button
            type="button"
            variant="ghost"
            size="icon-lg"
            className={cn("mt-6", items.length <= min && "invisible")}
            disabled={items.length <= min}
            onClick={() => onRemove(i)}
          >
            <Trash2Icon aria-hidden="true" />
            <span className="sr-only">Remove item {i + 1}</span>
          </Button>
        </div>
      ))}
      {items.length < max ? (
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={onAdd}>
          <PlusIcon aria-hidden="true" />
          {addLabel}
        </Button>
      ) : null}
    </fieldset>
  );
}

/* Decisions ------------------------------------------------------------------ */

/**
 * The approval names `copyVersion`, the copy on screen. When it is stale the
 * dialog swaps its confirm button for "Reload": the route is refreshed and
 * the dialog closes, so the reviewer sees the new copy before approving it.
 */
function ApprovePageButton({
  shopDomain,
  price,
  copyVersion,
  retry = false,
  disabled,
  onApprove,
  onReload,
}: {
  shopDomain: string | null;
  price: string | null;
  copyVersion: string | null;
  /** The first publish is stuck (stale claim): the same approval, worded as a retry. */
  retry?: boolean;
  disabled: boolean;
  onApprove: (input: { copyVersion: string; note?: string }) => Promise<ActionResult>;
  onReload: () => void;
}) {
  const [note, setNote] = useState("");
  const id = useId();
  const store = shopDomain ?? "the brand's Shopify store";
  return (
    <ConfirmDialog
      trigger={
        <Button size="xl" disabled={disabled || !copyVersion}>
          {retry ? <RotateCwIcon aria-hidden="true" /> : <CheckCircle2Icon aria-hidden="true" />}
          {retry ? "Retry approval" : "Approve and publish"}
        </Button>
      }
      errorAction={(failure, close) =>
        fieldError(failure, STALE_COPY_FIELD) ? (
          <Button
            size="lg"
            onClick={() => {
              close();
              onReload();
            }}
          >
            <RotateCwIcon aria-hidden="true" />
            Reload
          </Button>
        ) : null
      }
      title={retry ? "Retry publishing this page?" : "Publish this page on your store?"}
      description={
        <>
          {retry ? (
            <p className="mb-2">
              The first attempt did not finish. Check the product in Shopify admin first: retrying
              takes over that attempt and publishes the page again, recorded with your name.
            </p>
          ) : null}
          <p>
            This <strong className="text-foreground">publishes the product on {store}</strong>: it
            becomes Active on the Online Store sales channel, so anyone visiting the store can see
            it{price ? ` and buy it at ${price}` : " and buy it"}.
          </p>
          <p className="mt-2">
            Trendcart cannot unpublish it for you: to take it down, set it back to draft in Shopify
            admin. Your approval is recorded with your name.
          </p>
        </>
      }
      confirmLabel={retry ? "Retry approval" : "Approve and publish"}
      pendingLabel="Publishing…"
      onConfirm={async () => {
        if (!copyVersion) {
          return {
            ok: false,
            code: "invalid_state",
            error: "The page changed since you loaded it.",
            fieldErrors: { [STALE_COPY_FIELD]: ["missing"] },
          };
        }
        return onApprove({ copyVersion, note: note.trim() || undefined });
      }}
      onSuccess={() => setNote("")}
    >
      <TextAreaField
        id={`${id}-approve-note`}
        label="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.currentTarget.value)}
        maxLength={2000}
        rows={2}
      />
    </ConfirmDialog>
  );
}

function RegenerateButton({
  onRegenerate,
  disabled,
}: {
  onRegenerate: () => Promise<ActionResult>;
  disabled: boolean;
}) {
  return (
    <ConfirmDialog
      errorAction={rebuildLimitAction}
      trigger={
        <Button variant="outline" size="xl" disabled={disabled}>
          <RefreshCwIcon aria-hidden="true" />
          Regenerate
        </Button>
      }
      title="Write the page again?"
      description="Trendcart discards this copy, including your edits, and writes a new version on the same Shopify draft. Nothing is published."
      confirmLabel="Regenerate copy"
      pendingLabel="Regenerating…"
      onConfirm={onRegenerate}
    />
  );
}

function RejectPageButton({
  onReject,
  disabled,
}: {
  onReject: (input: { note?: string }) => Promise<ActionResult>;
  disabled: boolean;
}) {
  const [note, setNote] = useState("");
  const id = useId();
  return (
    <ConfirmDialog
      errorAction={rebuildLimitAction}
      trigger={
        <Button
          variant="ghost"
          size="xl"
          className="text-danger hover:text-danger"
          disabled={disabled}
        >
          <XCircleIcon aria-hidden="true" />
          Reject
        </Button>
      }
      title="Reject this page?"
      description="Trendcart writes a new version of the copy, using your note as guidance, and updates the same Shopify draft. Nothing is published."
      confirmLabel="Reject and rewrite"
      pendingLabel="Rejecting…"
      destructive
      onConfirm={() => onReject({ note: note.trim() || undefined })}
      onSuccess={() => setNote("")}
    >
      <TextAreaField
        id={`${id}-reject-note`}
        label="What should change?"
        value={note}
        onChange={(e) => setNote(e.currentTarget.value)}
        maxLength={2000}
        rows={3}
        hint="For example: shorter title, no shipping promise, more about the materials."
      />
    </ConfirmDialog>
  );
}
