"use client";

import { LayoutTemplateIcon, SparklesIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import type { PageTemplateChoice } from "@/lib/domain/contracts";

import type { ActionResult } from "../action-result";
import { Pill } from "../badges";
import { ConfirmDialog } from "../confirm-dialog";
import { rebuildLimitAction } from "./limit-action";
import {
  decodeTemplate,
  encodeTemplate,
  TemplatePicker,
  templateLabel,
  type TemplateMode,
} from "./template-picker";

/**
 * GATE 3: the template the page is built on (and the sections Claude designed
 * for a generated one), with "Change template": rebuild the page on another
 * template, or have Claude design one. The page copy is written again.
 */
export function PageTemplatePanel({
  template,
  store,
  canChange,
  onListTemplates,
  onChange,
}: {
  template: PageTemplateChoice;
  store: { id: string; templateSuffix: string | null; canWriteThemes: boolean };
  canChange: boolean;
  onListTemplates: (connectionId: string) => Promise<ActionResult<{ suffixes: (string | null)[] }>>;
  onChange: (input: {
    mode: TemplateMode;
    templateSuffix: string | null;
    withImages: boolean;
  }) => Promise<ActionResult>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [suffixes, setSuffixes] = useState<(string | null)[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [value, setValue] = useState(encodeTemplate(template.suffix));
  const [mode, setMode] = useState<TemplateMode>(template.mode);
  const [withImages, setWithImages] = useState(template.withImages);

  useEffect(() => {
    if (!open || suffixes) return;
    let cancelled = false;
    void onListTemplates(store.id).then((r) => {
      if (cancelled) return;
      if (r.ok) setSuffixes(r.data.suffixes);
      else setLoadError(r.error);
    });
    return () => {
      cancelled = true;
    };
  }, [open, suffixes, onListTemplates, store.id]);

  const generated = template.mode === "generate" ? template.generated : null;
  return (
    <div className="mb-6 grid gap-3 rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <LayoutTemplateIcon aria-hidden="true" className="size-4 text-muted-foreground" />
            Page template
          </h3>
          <p className="text-sm text-muted-foreground">
            {template.mode === "generate" ? (
              <>
                Designed by Claude for this product
                {generated ? ` (${templateLabel(generated.suffix)})` : ""}, from the buy box of{" "}
                {templateLabel(template.suffix)}.
              </>
            ) : (
              <>Built on {templateLabel(template.suffix)} of the live theme.</>
            )}
            {template.mode === "generate"
              ? template.withImages
                ? " Image sections allowed."
                : " Text sections only (images not allowed)."
              : ""}
          </p>
          {!canChange ? (
            <p className="text-xs text-muted-foreground">
              The page is published: the template can no longer be changed here.
            </p>
          ) : null}
        </div>
        {template.mode === "generate" ? (
          <Pill tone="success">
            <SparklesIcon aria-hidden="true" className="size-3" />
            CRO template
          </Pill>
        ) : null}
      </div>

      {generated && generated.sections.length > 0 ? (
        <ol className="grid gap-1.5 text-sm">
          {generated.sections.map((s, i) => (
            <li key={`${i}-${s.type}`} className="flex gap-2">
              <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                {i + 1}.
              </span>
              <span>
                <span className="font-medium">{s.name}</span>
                {s.purpose ? <span className="text-muted-foreground"> · {s.purpose}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {canChange ? (
        <ConfirmDialog
          trigger={
            <Button variant="outline" className="w-fit" onClick={() => setOpen(true)}>
              <LayoutTemplateIcon aria-hidden="true" />
              Change template
            </Button>
          }
          title="Rebuild the page on another template?"
          description="Trendcart writes the page again for this template and updates the same Shopify draft. With Claude, the sections below the buy box are designed for this product (conversion-optimised) from your theme's own sections."
          confirmLabel="Rebuild the page"
          pendingLabel="Rebuilding…"
          errorAction={rebuildLimitAction}
          onConfirm={() =>
            suffixes
              ? onChange({ mode, templateSuffix: decodeTemplate(value), withImages })
              : Promise.resolve({
                  ok: false as const,
                  code: "invalid_input" as const,
                  error: loadError ?? "The theme's templates are still loading.",
                })
          }
        >
          {suffixes ? (
            <TemplatePicker
              id={id}
              suffixes={suffixes}
              storeDefault={store.templateSuffix}
              value={value}
              onChange={setValue}
              mode={store.canWriteThemes ? mode : "existing"}
              onModeChange={setMode}
              canGenerate={store.canWriteThemes}
              withImages={withImages}
              onWithImagesChange={setWithImages}
            />
          ) : (
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {loadError ?? "Reading the store's product templates…"}
            </p>
          )}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
