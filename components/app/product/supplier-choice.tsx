"use client";

import { CheckCircle2Icon, ExternalLinkIcon, SearchXIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import type { ShopifyStoreOptionDTO, SupplierDTO, SupplierQuoteDTO } from "@/lib/services/types";
import { cn } from "@/lib/utils";

import type { ActionResult } from "../action-result";
import { Pill } from "../badges";
import { ConfirmDialog } from "../confirm-dialog";
import { SelectField, TextAreaField, TextField } from "../form-controls";
import { formatMoney, formatPercent, hostOf } from "../format";
import { ProductThumb } from "../product-thumb";
import { rebuildLimitAction } from "./limit-action";
import {
  decodeTemplate,
  encodeTemplate,
  TemplatePicker,
  templateLabel,
  type TemplateMode,
} from "./template-picker";

export type PriceInput = {
  supplierMatchId: string;
  fxRate?: number;
  sellingPrice?: number;
  compareAtPrice?: number | null;
  otherCosts?: number;
};

type SelectInput = PriceInput & {
  shopifyConnectionId?: string;
  /** Omitted: the store's default template. */
  templateSuffix?: string | null;
  templateMode?: TemplateMode;
  templateWithImages?: boolean;
  acceptLowMargin: boolean;
  note?: string;
};

type StoreTemplates =
  | { storeId: string; ok: true; suffixes: (string | null)[] }
  | { storeId: string; ok: false; error: string };

const PRICE_SOURCE_LABEL: Record<SupplierQuoteDTO["priceSource"], string> = {
  pricing_rule: "Brand pricing rule",
  default_rule: "Default pricing rule",
  min_margin: "Raised to meet the brand minimum margin",
  manual: "Set manually",
};

type Fields = {
  sellingPrice: string;
  compareAtPrice: string;
  noCompareAt: boolean;
  otherCosts: string;
  fxRate: string;
};

const EMPTY_FIELDS: Fields = {
  sellingPrice: "",
  compareAtPrice: "",
  noCompareAt: false,
  otherCosts: "",
  fxRate: "",
};

/** "" → undefined, invalid → NaN (reported as a field error). */
function parseAmount(value: string): number | undefined {
  const trimmed = value.trim().replace(",", ".");
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : Number.NaN;
}

function toPriceInput(
  supplierMatchId: string,
  f: Fields,
): { input: PriceInput; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const read = (key: keyof Fields, positive: boolean) => {
    const n = parseAmount(f[key] as string);
    if (n === undefined) return undefined;
    if (Number.isNaN(n) || n < 0 || (positive && n === 0)) {
      errors[key] = positive ? "Enter a number above 0." : "Enter a number, 0 or more.";
      return undefined;
    }
    return n;
  };
  const sellingPrice = read("sellingPrice", true);
  const compareAt = f.noCompareAt ? null : read("compareAtPrice", true);
  const otherCosts = read("otherCosts", false);
  const fxRate = read("fxRate", true);
  return {
    input: {
      supplierMatchId,
      ...(sellingPrice !== undefined ? { sellingPrice } : {}),
      ...(compareAt !== undefined ? { compareAtPrice: compareAt } : {}),
      ...(otherCosts !== undefined ? { otherCosts } : {}),
      ...(fxRate !== undefined ? { fxRate } : {}),
    },
    errors,
  };
}

function leadTimeLabel(lt: SupplierDTO["leadTime"]): string {
  if (!lt) return "Not listed";
  return lt.min === lt.max ? `${lt.min} days` : `${lt.min}–${lt.max} days`;
}

/**
 * GATE 2: pick one supplier listing, the target Shopify store and the prices,
 * with a live margin preview (quoteSupplierChoice). Read-only for roles that
 * cannot approve the gate.
 */
export function SupplierChoice({
  suppliers,
  stores,
  currency,
  minMargin,
  canDecide,
  approverLabel,
  initialQuote,
  initialQuoteError,
  onQuote,
  onSelect,
  onRejectAll,
  onListTemplates,
}: {
  suppliers: SupplierDTO[];
  stores: ShopifyStoreOptionDTO[];
  currency: string;
  minMargin: number | null;
  canDecide: boolean;
  approverLabel: string;
  initialQuote: SupplierQuoteDTO | null;
  initialQuoteError: string | null;
  onQuote: (input: PriceInput) => Promise<ActionResult<SupplierQuoteDTO>>;
  onSelect: (input: SelectInput) => Promise<ActionResult>;
  onRejectAll: (input: { note?: string }) => Promise<ActionResult>;
  /** Product templates of a store's live theme, for the template picker. */
  onListTemplates: (connectionId: string) => Promise<ActionResult<{ suffixes: (string | null)[] }>>;
}) {
  const baseId = useId();
  const [selectedId, setSelectedId] = useState(suppliers[0]?.id ?? "");
  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [quote, setQuote] = useState<SupplierQuoteDTO | null>(initialQuote);
  const [quoteError, setQuoteError] = useState<string | null>(initialQuoteError);
  const [quoting, startQuote] = useTransition();
  const [acceptLow, setAcceptLow] = useState(false);
  const [note, setNote] = useState("");
  // "expiring" stores still hold a working token (GATE 2 accepts them too).
  const isUsable = (s: ShopifyStoreOptionDTO) => s.status === "active" || s.status === "expiring";
  const activeStores = stores.filter(isUsable);
  const [storeId, setStoreId] = useState(activeStores[0]?.id ?? "");
  const timer = useRef<number | null>(null);
  const requestSeq = useRef(0);
  const [templates, setTemplates] = useState<StoreTemplates | null>(null);
  /** Picked template per store (encoded); unset = the store's default. */
  const [pickedTemplate, setPickedTemplate] = useState<Record<string, string>>({});
  const [templateMode, setTemplateMode] = useState<TemplateMode>("existing");
  const [templateWithImages, setTemplateWithImages] = useState(false);

  // The store's theme templates, read again when the store changes.
  useEffect(() => {
    if (!canDecide || !storeId) return;
    let cancelled = false;
    void onListTemplates(storeId).then((result) => {
      if (cancelled) return;
      setTemplates(
        result.ok
          ? { storeId, ok: true, suffixes: result.data.suffixes }
          : { storeId, ok: false, error: result.error },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [canDecide, storeId, onListTemplates]);

  const supplier = suppliers.find((s) => s.id === selectedId) ?? null;
  const needsFx =
    !!supplier && (supplier.currency !== currency || supplier.shippingCurrency !== currency);
  const quoteMatches = !!quote && quote.supplierMatchId === selectedId;

  function requestQuote(supplierMatchId: string, next: Fields, delay: number) {
    if (timer.current !== null) window.clearTimeout(timer.current);
    const { input, errors } = toPriceInput(supplierMatchId, next);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      requestSeq.current++;
      setQuote(null);
      setQuoteError("Fix the highlighted price fields to update the margin.");
      return;
    }
    const run = () => {
      const seq = ++requestSeq.current;
      startQuote(async () => {
        const result = await onQuote(input);
        if (seq !== requestSeq.current) return;
        if (result.ok) {
          setQuote(result.data);
          setQuoteError(null);
        } else {
          setQuote(null);
          setQuoteError(result.error);
          if (result.fieldErrors) {
            setFieldErrors(
              Object.fromEntries(
                Object.entries(result.fieldErrors).map(([k, v]) => [k, v[0] ?? "Invalid value."]),
              ),
            );
          }
        }
      });
    };
    if (delay > 0) timer.current = window.setTimeout(run, delay);
    else run();
  }

  function updateField<K extends keyof Fields>(key: K, value: Fields[K]) {
    const next = { ...fields, [key]: value };
    setFields(next);
    setAcceptLow(false);
    requestQuote(selectedId, next, 450);
  }

  function choose(id: string) {
    setSelectedId(id);
    setAcceptLow(false);
    requestQuote(id, fields, 0);
  }

  if (suppliers.length === 0) {
    return (
      <div className="grid gap-4">
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-border-strong p-4 text-sm text-muted-foreground">
          <SearchXIcon aria-hidden="true" className="size-5 shrink-0" />
          <p>No supplier listing was found for this product.</p>
        </div>
        {canDecide ? <RejectSuppliersButton onReject={onRejectAll} label="Search again" /> : null}
      </div>
    );
  }

  const lowMargin = quoteMatches && !quote.margin.meetsTarget;
  const store = stores.find((s) => s.id === storeId) ?? null;
  const storeTemplates = templates && templates.storeId === storeId ? templates : null;
  const templatesLoading = canDecide && !!storeId && !storeTemplates;
  const templateOptions = storeTemplates?.ok ? storeTemplates.suffixes : [];
  const defaultTemplate =
    store && templateOptions.includes(store.templateSuffix)
      ? store.templateSuffix
      : (templateOptions[0] ?? null);
  const templateValue = pickedTemplate[storeId] ?? encodeTemplate(defaultTemplate);
  // Unreadable theme or no JSON template: the store's default applies (undefined).
  const chosenTemplate = templateOptions.length > 0 ? decodeTemplate(templateValue) : undefined;
  const mode = store?.canWriteThemes && chosenTemplate !== undefined ? templateMode : "existing";
  const canSubmit =
    canDecide &&
    !!supplier &&
    quoteMatches &&
    !quoting &&
    !templatesLoading &&
    Object.keys(fieldErrors).length === 0 &&
    !!store &&
    isUsable(store) &&
    (!lowMargin || acceptLow);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <fieldset className="grid min-w-0 content-start gap-3">
        <legend className="mb-3 text-sm font-medium">
          {suppliers.length} {suppliers.length === 1 ? "listing" : "listings"}, best value for money
          first
        </legend>
        {suppliers.map((s) => {
          const inputId = `${baseId}-supplier-${s.id}`;
          const checked = s.id === selectedId;
          return (
            <div
              key={s.id}
              className={cn(
                "relative grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-xl border p-3 transition-colors focus-within:ring-2 focus-within:ring-ring sm:grid-cols-[auto_auto_minmax(0,1fr)]",
                checked ? "border-brand-border bg-brand-soft" : "border-border bg-background",
              )}
            >
              <input
                id={inputId}
                type="radio"
                name={`${baseId}-supplier`}
                value={s.id}
                checked={checked}
                onChange={() => choose(s.id)}
                className="mt-1 size-4 accent-brand focus-visible:outline-none"
                aria-describedby={`${inputId}-meta`}
              />
              <ProductThumb src={s.images[0] ?? null} alt="" className="hidden size-20 sm:flex" />
              <div className="col-start-2 grid min-w-0 gap-2 sm:col-start-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <label htmlFor={inputId} className="min-w-0 cursor-pointer text-sm font-medium">
                    {s.title}
                  </label>
                  <span className="flex flex-wrap gap-1">
                    {s.valueScore !== null ? (
                      <Pill tone={s.valueScore >= 0.7 ? "success" : "neutral"}>
                        Value {formatPercent(s.valueScore)}
                      </Pill>
                    ) : null}
                    <Pill tone={s.matchScore >= 0.7 ? "success" : "neutral"}>
                      Match {formatPercent(s.matchScore)}
                    </Pill>
                  </span>
                </div>
                <dl
                  id={`${inputId}-meta`}
                  className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-5"
                >
                  <div>
                    <dt className="text-muted-foreground">Price</dt>
                    <dd className="font-medium tabular-nums">{formatMoney(s.price, s.currency)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Shipping</dt>
                    <dd className="tabular-nums">
                      {s.shipping === null
                        ? "Not listed"
                        : s.shipping === 0
                          ? "Free"
                          : formatMoney(s.shipping, s.shippingCurrency)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Lead time</dt>
                    <dd>{leadTimeLabel(s.leadTime)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Source</dt>
                    <dd className="truncate">{s.source || hostOf(s.url)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Rating</dt>
                    <dd className="tabular-nums">
                      {s.rating === null
                        ? "Not listed"
                        : `${s.rating.toFixed(1)}/5${
                            s.reviewCount !== null
                              ? ` (${s.reviewCount.toLocaleString("en")} reviews)`
                              : ""
                          }`}
                    </dd>
                  </div>
                </dl>
                {s.variants.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {s.variants.map((v) => `${v.name}: ${v.values.join(", ")}`).join(" · ")}
                  </p>
                ) : null}
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative inline-flex w-fit items-center gap-1 rounded-sm text-xs text-brand-text underline-offset-4 hover:underline"
                >
                  View listing on {hostOf(s.url)}
                  <ExternalLinkIcon aria-hidden="true" className="size-3" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </div>
            </div>
          );
        })}
      </fieldset>

      <div className="grid min-w-0 content-start gap-4 rounded-xl border border-border bg-background p-4">
        <h3 className="text-sm font-semibold">Price and margin</h3>

        {stores.length === 0 || activeStores.length === 0 ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            {stores.length === 0
              ? "This brand has no Shopify store yet. "
              : "This brand's Shopify stores need to be reconnected. "}
            <Link
              href="/app/connections"
              className="font-medium text-brand-text underline-offset-4 hover:underline"
            >
              Open connections
            </Link>
          </p>
        ) : stores.length > 1 ? (
          <SelectField
            id={`${baseId}-store`}
            label="Target Shopify store"
            value={storeId}
            onChange={(e) => setStoreId(e.currentTarget.value)}
            disabled={!canDecide}
            hint="The draft product page is created on this store."
            options={stores.map((s) => ({
              value: s.id,
              label: isUsable(s) ? s.shopDomain : `${s.shopDomain} (reconnect needed)`,
            }))}
          />
        ) : (
          <p className="text-sm">
            <span className="text-muted-foreground">Target store: </span>
            {stores[0]!.shopDomain}
          </p>
        )}

        {canDecide && store && isUsable(store) ? (
          templatesLoading ? (
            <p aria-live="polite" className="text-sm text-muted-foreground">
              Reading the store&apos;s product templates…
            </p>
          ) : templateOptions.length > 0 ? (
            <TemplatePicker
              id={baseId}
              suffixes={templateOptions}
              storeDefault={store.templateSuffix}
              value={templateValue}
              onChange={(value) => setPickedTemplate((prev) => ({ ...prev, [storeId]: value }))}
              mode={mode}
              onModeChange={setTemplateMode}
              canGenerate={store.canWriteThemes}
              withImages={templateWithImages}
              onWithImagesChange={setTemplateWithImages}
            />
          ) : (
            <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              {storeTemplates && !storeTemplates.ok
                ? `The theme's templates could not be read (${storeTemplates.error}). `
                : "The live theme has no JSON product template. "}
              The store&apos;s default template is used.
            </p>
          )
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            id={`${baseId}-selling`}
            label="Selling price"
            inputMode="decimal"
            placeholder={quoteMatches ? quote.sellingPrice.toFixed(2) : "Suggested"}
            value={fields.sellingPrice}
            onChange={(e) => updateField("sellingPrice", e.currentTarget.value)}
            suffix={currency}
            hint="Leave empty to use the suggested price."
            error={fieldErrors.sellingPrice}
            disabled={!canDecide}
          />
          <div className="grid content-start gap-1.5">
            <TextField
              id={`${baseId}-compare`}
              label="Compare-at price"
              inputMode="decimal"
              placeholder={
                fields.noCompareAt
                  ? "None"
                  : quoteMatches && quote.compareAtPrice !== null
                    ? quote.compareAtPrice.toFixed(2)
                    : "Suggested"
              }
              value={fields.noCompareAt ? "" : fields.compareAtPrice}
              onChange={(e) => updateField("compareAtPrice", e.currentTarget.value)}
              suffix={currency}
              error={fieldErrors.compareAtPrice}
              disabled={!canDecide || fields.noCompareAt}
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={fields.noCompareAt}
                onChange={(e) => updateField("noCompareAt", e.currentTarget.checked)}
                disabled={!canDecide}
                className="size-4 accent-brand"
              />
              No compare-at price
            </label>
          </div>
          <TextField
            id={`${baseId}-other`}
            label="Other costs per order"
            inputMode="decimal"
            placeholder="0.00"
            value={fields.otherCosts}
            onChange={(e) => updateField("otherCosts", e.currentTarget.value)}
            suffix={currency}
            hint="Packaging, inserts, fulfilment."
            error={fieldErrors.otherCosts}
            disabled={!canDecide}
          />
          {needsFx ? (
            <TextField
              id={`${baseId}-fx`}
              label={`Exchange rate (${currency} per ${supplier.currency})`}
              inputMode="decimal"
              placeholder="e.g. 0.92"
              value={fields.fxRate}
              onChange={(e) => updateField("fxRate", e.currentTarget.value)}
              hint={`This listing is priced in ${supplier.currency}.`}
              error={fieldErrors.fxRate}
              disabled={!canDecide}
            />
          ) : null}
        </div>

        <QuotePreview
          quote={quoteMatches ? quote : null}
          error={quoteError}
          pending={quoting}
          minMargin={minMargin}
        />

        {canDecide ? (
          <div className="grid gap-3 border-t border-border pt-4">
            {lowMargin ? (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={acceptLow}
                  onChange={(e) => setAcceptLow(e.currentTarget.checked)}
                  className="mt-0.5 size-4 accent-brand"
                />
                <span>
                  Go on with a margin below the brand minimum
                  {minMargin !== null ? ` (${formatPercent(minMargin)})` : ""}.
                </span>
              </label>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <ConfirmDialog
                trigger={
                  <Button size="xl" disabled={!canSubmit}>
                    <CheckCircle2Icon aria-hidden="true" />
                    Choose this supplier
                  </Button>
                }
                title="Choose this supplier and price?"
                description={
                  supplier && quoteMatches && store ? (
                    <>
                      <p>
                        {supplier.title}, sold at{" "}
                        <strong className="text-foreground">
                          {formatMoney(quote.sellingPrice, quote.currency)}
                        </strong>
                        {quote.compareAtPrice !== null
                          ? ` (compare-at ${formatMoney(quote.compareAtPrice, quote.currency)})`
                          : ""}
                        , margin {formatPercent(quote.margin.marginRate)}.
                      </p>
                      <p className="mt-2">
                        Trendcart then writes the page
                        {chosenTemplate === undefined
                          ? ""
                          : mode === "generate"
                            ? `, has Claude design a conversion-optimised template from ${templateLabel(chosenTemplate)}`
                            : ` for the template ${templateLabel(chosenTemplate)}`}{" "}
                        and creates it as a <strong className="text-foreground">draft</strong> on{" "}
                        {store.shopDomain}. Nothing is published before Gate 3. Your approval is
                        recorded with your name.
                      </p>
                    </>
                  ) : (
                    "Waiting for the margin preview."
                  )
                }
                confirmLabel="Choose and build the page"
                pendingLabel="Saving…"
                onConfirm={() => {
                  const { input, errors } = toPriceInput(selectedId, fields);
                  if (Object.keys(errors).length > 0) {
                    return Promise.resolve({
                      ok: false as const,
                      code: "invalid_input" as const,
                      error: "Please fix the price fields first.",
                    });
                  }
                  return onSelect({
                    ...input,
                    shopifyConnectionId: storeId || undefined,
                    ...(chosenTemplate !== undefined
                      ? {
                          templateSuffix: chosenTemplate,
                          templateMode: mode,
                          templateWithImages: mode === "generate" && templateWithImages,
                        }
                      : {}),
                    acceptLowMargin: acceptLow,
                    note: note.trim() || undefined,
                  });
                }}
              >
                <TextAreaField
                  id={`${baseId}-note`}
                  label="Note (optional)"
                  value={note}
                  onChange={(e) => setNote(e.currentTarget.value)}
                  maxLength={2000}
                  rows={2}
                />
              </ConfirmDialog>
              <RejectSuppliersButton onReject={onRejectAll} label="None of these" />
            </div>
            {activeStores.length > 0 && (!store || !isUsable(store)) ? (
              <p className="text-xs text-warning">Choose a store that is connected.</p>
            ) : null}
          </div>
        ) : (
          <p className="border-t border-border pt-4 text-sm text-muted-foreground">
            Waiting for: {approverLabel}. Your role can view but not choose.
          </p>
        )}
      </div>
    </div>
  );
}

function QuotePreview({
  quote,
  error,
  pending,
  minMargin,
}: {
  quote: SupplierQuoteDTO | null;
  error: string | null;
  pending: boolean;
  minMargin: number | null;
}) {
  if (!quote) {
    return (
      <div aria-live="polite" className="grid gap-2">
        {error && !pending ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            {error}
          </p>
        ) : (
          <>
            <span className="sr-only">Calculating the margin…</span>
            <div aria-hidden="true" className="grid gap-2">
              <div className="h-5 w-2/3 rounded bg-surface-2 motion-safe:animate-pulse" />
              <div className="h-24 rounded-lg bg-surface-2 motion-safe:animate-pulse" />
            </div>
          </>
        )}
      </div>
    );
  }
  const m = quote.margin;
  const c = quote.currency;
  const otherCosts = m.landedCost - m.productCost - m.shippingCost;
  return (
    <div
      aria-live="polite"
      aria-busy={pending}
      className={cn("grid gap-3 transition-opacity", pending && "opacity-60")}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-2xl font-semibold tabular-nums">
          {formatMoney(quote.sellingPrice, c)}
          {quote.compareAtPrice !== null ? (
            <span className="ml-2 text-sm font-normal text-muted-foreground line-through">
              {formatMoney(quote.compareAtPrice, c)}
            </span>
          ) : null}
        </p>
        <Pill tone={m.meetsTarget ? "success" : "danger"}>
          Margin {formatPercent(m.marginRate, 1)}
        </Pill>
      </div>
      <p className="text-xs text-muted-foreground">{PRICE_SOURCE_LABEL[quote.priceSource]}</p>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm tabular-nums">
        <dt className="text-muted-foreground">Product cost</dt>
        <dd className="text-right">{formatMoney(m.productCost, c)}</dd>
        <dt className="text-muted-foreground">Shipping</dt>
        <dd className="text-right">{formatMoney(m.shippingCost, c)}</dd>
        {otherCosts > 0.004 ? (
          <>
            <dt className="text-muted-foreground">Other costs</dt>
            <dd className="text-right">{formatMoney(otherCosts, c)}</dd>
          </>
        ) : null}
        <dt className="border-t border-border pt-1 font-medium">Landed cost</dt>
        <dd className="border-t border-border pt-1 text-right font-medium">
          {formatMoney(m.landedCost, c)}
        </dd>
        <dt className="text-muted-foreground">Payment fees</dt>
        <dd className="text-right">{formatMoney(m.fees, c)}</dd>
        <dt className="font-medium">Gross margin</dt>
        <dd className="text-right font-medium">{formatMoney(m.grossMargin, c)}</dd>
      </dl>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-border p-3 text-xs">
        <div>
          <dt className="text-muted-foreground">Break-even CPA</dt>
          <dd className="font-medium tabular-nums">{formatMoney(m.breakEvenCpa, c)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Max CPA at target</dt>
          <dd className="font-medium tabular-nums">{formatMoney(m.maxCpa, c)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Break-even ROAS</dt>
          <dd className="font-medium tabular-nums">
            {m.breakEvenRoas === null ? "—" : m.breakEvenRoas.toFixed(2)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Minimum price</dt>
          <dd className="font-medium tabular-nums">
            {quote.minimumPrice === null ? "—" : formatMoney(quote.minimumPrice, c)}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">
        Brand minimum margin:{" "}
        {minMargin === null ? "not set" : formatPercent(m.targetMarginRate ?? minMargin)}.
      </p>
      {quote.warnings.length > 0 ? (
        <ul className="grid gap-1 text-xs text-warning">
          {quote.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function RejectSuppliersButton({
  label,
  onReject,
}: {
  label: string;
  onReject: (input: { note?: string }) => Promise<ActionResult>;
}) {
  const [note, setNote] = useState("");
  const id = useId();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" size="xl">
          <SearchXIcon aria-hidden="true" />
          {label}
        </Button>
      }
      title="Reject these suppliers?"
      description="Trendcart removes these listings and searches for suppliers again, using your note as a hint."
      confirmLabel="Reject and search again"
      pendingLabel="Searching again…"
      destructive
      onConfirm={() => onReject({ note: note.trim() || undefined })}
      onSuccess={() => setNote("")}
      errorAction={rebuildLimitAction}
    >
      <TextAreaField
        id={`${id}-reject-note`}
        label="What's wrong with these listings? (optional)"
        value={note}
        onChange={(e) => setNote(e.currentTarget.value)}
        maxLength={2000}
        rows={3}
      />
    </ConfirmDialog>
  );
}
