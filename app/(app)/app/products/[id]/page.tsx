import { ArrowLeftIcon, ExternalLinkIcon, FileTextIcon, PackageSearchIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ZodError } from "zod";

import { PageHeader } from "@/components/app-shell";
import { AutoRefresh } from "@/components/app/auto-refresh";
import { Pill, ProductStatusBadge } from "@/components/app/badges";
import {
  formatDateTime,
  formatMoney,
  formatPercent,
  formatRelativeTime,
  formatUsd,
  hostOf,
} from "@/components/app/format";
import {
  ConfirmProductButton,
  RejectProductButton,
  RetryButton,
} from "@/components/app/product/gate-actions";
import { GateTracker } from "@/components/app/product/gate-tracker";
import { PageReview } from "@/components/app/product/page-review";
import { pagePartState } from "@/components/app/product/page-state";
import { SupplierChoice } from "@/components/app/product/supplier-choice";
import { STEP_LABELS, whoApproves } from "@/components/app/product-status";
import { ProductThumb } from "@/components/app/product-thumb";
import { DetailList, Notice, PageSkeleton, Section, Skeleton } from "@/components/app/surface";
import { isAccessError } from "@/lib/auth/errors";
import { can, type Role } from "@/lib/auth/permissions";
import { isRunningStatus, PRODUCT_FLOW, stepForStatus } from "@/lib/domain/state-machine";
import { getProductPipeline, quoteSupplierChoice, toServiceFailure } from "@/lib/services";
import type { ProductPipelineDTO, SupplierDTO, SupplierQuoteDTO } from "@/lib/services/types";
import type { UserWorkspaceContext } from "@/lib/tenant/context";

import { getPageContext } from "../../_lib/page-context";
import {
  approvePageAction,
  confirmProductAction,
  quoteSupplierAction,
  regeneratePageCopyAction,
  rejectPageAction,
  rejectProductAction,
  rejectSuppliersAction,
  retryStepAction,
  selectSupplierAction,
  updatePageCopyAction,
} from "./actions";

export const metadata: Metadata = { title: "Product" };

// With the inline engine (local dev, PIPELINE_ENGINE=inline) gate actions and
// Retry run the next step (analysis, supplier search, page build) inside the
// request. With Vercel Workflow they return right away.
export const maxDuration = 300;

/** A queued step that has not started after this long is shown as stalled. */
const STALL_AFTER_MS = 2 * 60 * 1000;

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default function ProductPage(props: Props) {
  return (
    <div className="grid gap-6">
      <Link
        href="/app/products"
        className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        All products
      </Link>
      <Suspense fallback={<PageSkeleton panels={3} />}>
        <ProductDetail {...props} />
      </Suspense>
    </div>
  );
}

/** Position on the happy path (failed → the step that failed). */
function reached(product: ProductPipelineDTO, status: ProductPipelineDTO["status"]): boolean {
  const at = PRODUCT_FLOW.indexOf(product.status);
  return at >= 0 && at >= PRODUCT_FLOW.indexOf(status);
}

function olderThan(iso: string, ms: number): boolean {
  return Date.now() - new Date(iso).getTime() > ms;
}

/**
 * "3 minutes ago", formatted on the server and passed to client components as
 * text, so the client never reads its own clock during hydration.
 */
function sinceNow(iso: string): string {
  return formatRelativeTime(iso, Date.now());
}

async function ProductDetail({ params, searchParams }: Props) {
  const [{ id }, query, { ctx, role, brands }] = await Promise.all([
    params,
    searchParams,
    getPageContext(),
  ]);

  let product: ProductPipelineDTO;
  try {
    product = await getProductPipeline(ctx, id);
  } catch (error) {
    if ((isAccessError(error) && error.code === "not_found") || error instanceof ZodError) {
      notFound();
    }
    throw error;
  }

  const brand = brands.find((b) => b.id === product.brandId);
  const running = isRunningStatus(product.status);
  const step = stepForStatus(product.status);
  const openJob = step ? product.jobs.find((j) => j.step === step) : undefined;
  const stalled =
    running &&
    (openJob?.status === "failed" ||
      ((!openJob || openJob.status === "queued") &&
        olderThan(openJob?.updatedAt ?? product.updatedAt, STALL_AFTER_MS)));
  const canRetry = can(role, "product:update");
  const analysis = product.analysis;
  const chosen = product.supplierChoice
    ? (product.suppliers.find((s) => s.id === product.supplierChoice!.supplierMatchId) ?? null)
    : null;

  return (
    <>
      {/* Also poll while the approved page is being published on Shopify
          (slower once the publish looks stuck: it may still finish). */}
      {(running && !stalled) || pagePartState(product.contentParts) === "publishing" ? (
        <AutoRefresh intervalMs={product.pagePublishClaim?.stale ? 30_000 : 5000} />
      ) : null}

      <PageHeader
        title={product.name ?? analysis?.productName ?? "Unidentified product"}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{brand?.name ?? "Unknown brand"}</span>
            <span aria-hidden="true">·</span>
            <a
              href={product.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-brand-text underline-offset-4 hover:underline"
            >
              {product.sourceType === "tiktok_video" ? "TikTok video" : hostOf(product.sourceUrl)}
              <ExternalLinkIcon aria-hidden="true" className="size-3.5" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
            <span aria-hidden="true">·</span>
            <span>Imported {formatDateTime(product.createdAt)}</span>
          </span>
        }
        actions={<ProductStatusBadge status={product.status} />}
      />

      {query.existing === "1" ? (
        <Notice tone="info" title="Already imported">
          This link was imported for this brand before, so here is the existing product.
        </Notice>
      ) : null}

      <Section
        id="tracker"
        title="Preparation"
        description="Nothing goes live without an approval at each gate."
      >
        <GateTracker
          status={product.status}
          failedStep={product.failedStep}
          approvals={product.approvals}
          contentParts={product.contentParts}
        />
      </Section>

      {product.status === "failed" ? (
        <Notice
          tone="danger"
          title={`${product.failedStep ? STEP_LABELS[product.failedStep] : "A step"} failed`}
          action={
            canRetry ? (
              <RetryButton label="Retry step" onRetry={retryStepAction.bind(null, product.id)} />
            ) : undefined
          }
        >
          {product.error ?? "No error message was recorded."}
          {!canRetry ? " Ask a Creative or higher to retry." : null}
        </Notice>
      ) : null}

      {stalled ? (
        <Notice
          tone="warning"
          title={`${step ? STEP_LABELS[step] : "This step"} is not running`}
          action={
            canRetry ? (
              <RetryButton label="Resume" onRetry={retryStepAction.bind(null, product.id)} />
            ) : undefined
          }
        >
          It is queued or was interrupted. Resume it to continue.
        </Notice>
      ) : running && step ? (
        <Notice tone="info" title={`Trendcart is working: ${STEP_LABELS[step] ?? step}`}>
          {RUNNING_HINT[step] ?? "This screen updates on its own."}
        </Notice>
      ) : null}

      {product.status === "awaiting_product_confirmation" ? (
        <GateOne product={product} role={role} />
      ) : null}

      {product.status === "awaiting_supplier_choice" ? (
        <GateTwo product={product} role={role} ctx={ctx} />
      ) : null}

      {product.status === "awaiting_content_approval" ? (
        <GateThree product={product} role={role} />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Section
          id="analysis"
          title="AI analysis"
          actions={
            analysis ? (
              <Pill tone={analysis.confidence >= 0.7 ? "success" : "action"}>
                Confidence {formatPercent(analysis.confidence)}
              </Pill>
            ) : undefined
          }
        >
          {analysis ? (
            <div className="grid gap-5">
              <DetailList
                items={[
                  { label: "Identified product", value: analysis.productName },
                  { label: "Category", value: analysis.category },
                ]}
              />
              {analysis.description ? (
                <p className="text-sm text-pretty text-muted-foreground">{analysis.description}</p>
              ) : null}
              <div className="grid gap-5 sm:grid-cols-2">
                <BulletList title="Features" items={analysis.features} />
                <BulletList title="Selling points" items={analysis.sellingPoints} />
              </div>
              <div>
                <h3 className="text-xs text-muted-foreground">Keywords</h3>
                <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Keywords">
                  {analysis.keywords.map((k) => (
                    <li
                      key={k}
                      className="rounded-full border border-border bg-background px-2.5 py-0.5 text-xs"
                    >
                      {k}
                    </li>
                  ))}
                </ul>
              </div>
              {analysis.confidence < 0.7 && product.status === "awaiting_product_confirmation" ? (
                <p className="text-xs text-warning">
                  Low confidence: check the product before confirming.
                </p>
              ) : null}
            </div>
          ) : running ? (
            <div className="grid gap-3" aria-busy="true">
              <p className="text-sm text-muted-foreground">The AI is analyzing the source…</p>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-20" />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No analysis yet.</p>
          )}
        </Section>

        <Section id="source" title="Source">
          <SourcePreview
            product={product}
            referenceImage={analysis?.referenceImageUrl ?? null}
            supplierImage={chosen?.images[0] ?? null}
          />
        </Section>
      </div>

      {product.status !== "awaiting_supplier_choice" ? (
        <Section
          id="suppliers"
          title="Supplier and price"
          description="The listing chosen at Gate 2, with the landed cost and margin."
        >
          <SupplierSummary product={product} chosen={chosen} />
        </Section>
      ) : null}

      {product.status !== "awaiting_content_approval" ? (
        <Section
          id="page"
          title="Product page"
          description="Written by the AI from the analysis and the chosen listing, created as a Shopify draft."
        >
          <PageSummary product={product} />
        </Section>
      ) : null}

      <Section id="activity" title="Activity">
        <Activity product={product} />
      </Section>
    </>
  );
}

const RUNNING_HINT: Record<string, string> = {
  analyze: "The AI is identifying the product from the source. This screen updates on its own.",
  source:
    "Searching online listings with images, prices and shipping, then computing margins. This screen updates on its own.",
  build:
    "Writing the product page and creating it as a draft on the Shopify store. Nothing is published. This screen updates on its own.",
  prepare_campaign: "Preparing the campaign. This screen updates on its own.",
};

function BulletList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-xs text-muted-foreground">{title}</h3>
      {items.length > 0 ? (
        <ul className="mt-1.5 grid list-disc gap-1 pl-4 text-sm marker:text-brand-text">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-sm text-muted-foreground">None found.</p>
      )}
    </div>
  );
}

/* Gates ---------------------------------------------------------------------- */

function GateOne({ product, role }: { product: ProductPipelineDTO; role: Role }) {
  const allowed = can(role, "gate:product_confirmation");
  return (
    <Section
      id="gate-1"
      title="Gate 1: is this the right product?"
      description="Check the analysis below. Confirming starts the supplier search."
      className="border-warning/40"
    >
      {allowed ? (
        <div className="flex flex-wrap gap-2">
          <ConfirmProductButton
            suggestedName={product.analysis?.productName ?? product.name}
            onConfirm={confirmProductAction.bind(null, product.id)}
          />
          <RejectProductButton onReject={rejectProductAction.bind(null, product.id)} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Waiting for: {whoApproves("product_confirmation")}. Your role can view but not approve.
        </p>
      )}
    </Section>
  );
}

async function GateTwo({
  product,
  role,
  ctx,
}: {
  product: ProductPipelineDTO;
  role: Role;
  ctx: UserWorkspaceContext;
}) {
  // Margin preview of the best match, computed on the server for the first paint.
  const first = product.suppliers[0];
  let initialQuote: SupplierQuoteDTO | null = null;
  let initialQuoteError: string | null = null;
  if (first) {
    try {
      initialQuote = await quoteSupplierChoice(ctx, {
        productId: product.id,
        supplierMatchId: first.id,
      });
    } catch (error) {
      initialQuoteError = toServiceFailure(error).error;
    }
  }

  return (
    <Section
      id="gate-2"
      title="Gate 2: choose a supplier and a price"
      description={
        <>
          Pick the listing to source from and confirm the selling price. Trendcart then writes the
          page and creates it as a Shopify <strong className="text-foreground">draft</strong>.
        </>
      }
      className="border-warning/40"
    >
      <SupplierChoice
        suppliers={product.suppliers}
        stores={product.shopifyStores}
        currency={product.currency}
        minMargin={product.minMargin}
        canDecide={can(role, "gate:supplier_choice")}
        approverLabel={whoApproves("supplier_choice")}
        initialQuote={initialQuote}
        initialQuoteError={initialQuoteError}
        onQuote={quoteSupplierAction.bind(null, product.id)}
        onSelect={selectSupplierAction.bind(null, product.id)}
        onRejectAll={rejectSuppliersAction.bind(null, product.id)}
      />
    </Section>
  );
}

function pricesOf(product: ProductPipelineDTO) {
  return {
    currency: product.margin?.currency ?? product.currency,
    sellingPrice: product.sellingPrice,
    compareAtPrice: product.compareAtPrice,
    marginRate: product.margin?.marginRate ?? null,
  };
}

function GateThree({ product, role }: { product: ProductPipelineDTO; role: Role }) {
  const pagePart = pagePartState(product.contentParts);
  const pageApproved = pagePart === "approved";
  const publishing = pagePart === "publishing";
  const claim = publishing ? product.pagePublishClaim : null;
  const publishClaim = claim ? { ...claim, startedLabel: sinceNow(claim.startedAt) } : null;
  const canEdit = can(role, "gate:content_approval");
  const canPublish = canEdit && can(role, "page:publish");
  return (
    <Section
      id="gate-3"
      title={
        pageApproved
          ? "Gate 3: page published"
          : publishing
            ? "Gate 3: publishing the page"
            : "Gate 3: review the product page"
      }
      description={
        pageApproved ? (
          "The page is approved and live on the store. Gate 3 also needs the videos approval before the campaign is prepared; video review is not available yet."
        ) : publishing ? (
          "The page was approved. Trendcart is publishing it on the store; if Shopify fails, it goes back to draft and the review reopens."
        ) : (
          <>
            Check the copy and the Shopify draft. Approving{" "}
            <strong className="text-foreground">publishes the product on the store</strong>.
          </>
        )
      }
      className={pageApproved ? undefined : "border-warning/40"}
    >
      {product.pageCopy ? (
        <PageReview
          copy={product.pageCopy}
          copyVersion={product.pageCopyVersion}
          generatedAt={product.pageCopyGeneratedAt}
          prices={pricesOf(product)}
          shopify={product.shopify}
          open={!pageApproved}
          publishing={publishing}
          publishClaim={publishClaim}
          canEdit={canEdit}
          canPublish={canPublish}
          approverLabel={whoApproves("content_approval")}
          onSave={updatePageCopyAction.bind(null, product.id)}
          onRegenerate={regeneratePageCopyAction.bind(null, product.id)}
          onReject={rejectPageAction.bind(null, product.id)}
          onApprove={approvePageAction.bind(null, product.id)}
        />
      ) : (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">
            This product has no page copy. Retry the page build to write it.
          </p>
          {can(role, "product:update") ? (
            <RetryButton
              label="Rebuild the page"
              onRetry={retryStepAction.bind(null, product.id)}
            />
          ) : null}
        </div>
      )}
    </Section>
  );
}

/* Summaries outside their gate ------------------------------------------------- */

function EmptyPanel({ icon, children }: { icon: "suppliers" | "page"; children: React.ReactNode }) {
  const Icon = icon === "suppliers" ? PackageSearchIcon : FileTextIcon;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-border-strong p-4 text-sm text-muted-foreground">
      <Icon aria-hidden="true" className="size-5 shrink-0" />
      <p>{children}</p>
    </div>
  );
}

function SupplierSummary({
  product,
  chosen,
}: {
  product: ProductPipelineDTO;
  chosen: SupplierDTO | null;
}) {
  if (product.status === "sourcing") {
    return (
      <div className="grid gap-2" aria-busy="true">
        <span className="sr-only">Searching suppliers…</span>
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
      </div>
    );
  }
  if (!chosen || !product.supplierChoice) {
    return (
      <EmptyPanel icon="suppliers">
        {reached(product, "sourcing")
          ? "No supplier was chosen for this product."
          : "After Gate 1, Trendcart finds matching listings and computes the margin so you can choose a supplier and a price."}
      </EmptyPanel>
    );
  }
  const store = product.shopifyStores.find(
    (s) => s.id === product.supplierChoice!.shopifyConnectionId,
  );
  const m = product.margin;
  const c = m?.currency ?? product.currency;
  return (
    <div className="grid gap-4 md:grid-cols-[auto_minmax(0,1fr)]">
      <ProductThumb src={chosen.images[0] ?? null} alt="" className="size-24" />
      <div className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <a
            href={chosen.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-w-0 items-center gap-1 rounded-sm text-sm font-medium underline-offset-4 hover:underline"
          >
            {chosen.title}
            <ExternalLinkIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          {m ? (
            <Pill
              tone={
                product.minMargin === null || m.marginRate >= product.minMargin
                  ? "success"
                  : "danger"
              }
            >
              Margin {formatPercent(m.marginRate, 1)}
            </Pill>
          ) : null}
        </div>
        <DetailList
          className="sm:grid-cols-3"
          items={[
            { label: "Selling price", value: formatMoney(product.sellingPrice, c) },
            {
              label: "Compare-at price",
              value:
                product.compareAtPrice === null ? "None" : formatMoney(product.compareAtPrice, c),
            },
            { label: "Store", value: store?.shopDomain ?? "—" },
            { label: "Supplier price", value: formatMoney(chosen.price, chosen.currency) },
            { label: "Landed cost", value: m ? formatMoney(m.landedCost, c) : "—" },
            { label: "Gross margin", value: m ? formatMoney(m.grossMargin, c) : "—" },
          ]}
        />
        {product.supplierChoice.warnings.length > 0 ? (
          <ul className="grid gap-1 text-xs text-warning">
            {product.supplierChoice.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function PageSummary({ product }: { product: ProductPipelineDTO }) {
  if (product.status === "building_page_and_videos") {
    return (
      <div className="grid gap-3" aria-busy="true">
        <span className="sr-only">Writing the page…</span>
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    );
  }
  if (!product.pageCopy) {
    return (
      <EmptyPanel icon="page">
        {reached(product, "building_page_and_videos")
          ? "No page copy is stored for this product."
          : "After Gate 2, Trendcart writes the page from the store's template and creates it as a Shopify draft for your review at Gate 3."}
      </EmptyPanel>
    );
  }
  return (
    <PageReview
      copy={product.pageCopy}
      copyVersion={product.pageCopyVersion}
      generatedAt={product.pageCopyGeneratedAt}
      prices={pricesOf(product)}
      shopify={product.shopify}
      open={false}
      canEdit={false}
      canPublish={false}
      approverLabel={whoApproves("content_approval")}
      onSave={updatePageCopyAction.bind(null, product.id)}
      onRegenerate={regeneratePageCopyAction.bind(null, product.id)}
      onReject={rejectPageAction.bind(null, product.id)}
      onApprove={approvePageAction.bind(null, product.id)}
    />
  );
}

function SourcePreview({
  product,
  referenceImage,
  supplierImage,
}: {
  product: ProductPipelineDTO;
  referenceImage: string | null;
  supplierImage: string | null;
}) {
  const video =
    product.videos.find((v) => v.origin === "imported") ??
    product.videos.find((v) => v.tiktokUrl === product.sourceUrl);
  // Stable URLs first; TikTok thumbnails are signed and expire (ProductThumb falls back).
  const image =
    product.sourceType === "product_link"
      ? (referenceImage ?? supplierImage ?? product.thumbnailUrl)
      : (video?.thumbnailUrl ?? product.thumbnailUrl ?? supplierImage ?? referenceImage);
  return (
    <div className="grid gap-3">
      <ProductThumb
        src={image}
        alt={
          video
            ? `Thumbnail of the TikTok video${video.author ? ` by ${video.author}` : ""}`
            : "Product image"
        }
        className="aspect-[9/16] max-h-80 w-full max-w-48"
      />
      <DetailList
        className="sm:grid-cols-1"
        items={[
          {
            label: "Type",
            value: product.sourceType === "tiktok_video" ? "TikTok video" : "Product link",
          },
          ...(video?.author ? [{ label: "Creator", value: video.author }] : []),
          {
            label: "Link",
            value: <span className="font-mono text-xs break-all">{product.sourceUrl}</span>,
          },
        ]}
      />
    </div>
  );
}

const GATE_NAMES: Record<string, string> = {
  product_confirmation: "Gate 1 (product)",
  supplier_choice: "Gate 2 (supplier and price)",
  content_approval: "Gate 3 (page and videos)",
  launch: "Gate 4 (launch)",
};

function Activity({ product }: { product: ProductPipelineDTO }) {
  if (product.jobs.length === 0 && product.approvals.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  }
  const totalCost = product.jobs.reduce((sum, j) => sum + j.aiCostUsd, 0);
  return (
    <div className="grid gap-4">
      {product.jobs.length > 0 ? (
        <ul className="grid gap-2" aria-label="Pipeline steps">
          {product.jobs.map((j) => (
            <li
              key={j.id}
              className="grid gap-1 rounded-xl border border-border bg-background p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {STEP_LABELS[j.step] ?? j.step}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {j.status === "succeeded"
                      ? "Done"
                      : j.status === "failed"
                        ? "Failed"
                        : j.status === "running"
                          ? "Running"
                          : "Queued"}
                    {j.attempts > 1 ? ` · ${j.attempts} attempts` : ""}
                  </span>
                </p>
                {j.error ? (
                  <p className="mt-0.5 text-xs break-words text-danger">{j.error}</p>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground tabular-nums sm:text-right">
                {formatDateTime(j.finishedAt ?? j.startedAt ?? j.updatedAt)}
                {j.aiCostUsd > 0 ? ` · AI ${formatUsd(j.aiCostUsd, 4)}` : ""}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      {product.approvals.length > 0 ? (
        <ul className="grid gap-1 text-sm" aria-label="Approvals">
          {product.approvals.map((a) => (
            <li key={a.id} className="text-muted-foreground">
              <span className="text-foreground">
                {a.decision === "approved" ? "Approved" : "Rejected"}
              </span>{" "}
              {GATE_NAMES[a.gate] ?? a.gate} on {formatDateTime(a.createdAt)}
              {a.note ? <> &middot; &ldquo;{a.note}&rdquo;</> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {totalCost > 0 ? (
        <p className="text-xs text-muted-foreground">
          AI cost for this product: {formatUsd(totalCost, 4)}
        </p>
      ) : null}
    </div>
  );
}
