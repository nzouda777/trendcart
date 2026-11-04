"use client";

import { SparklesIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { SelectField } from "../form-controls";

/** <select> value of the default template (product.json): null is not a valid option value. */
export const DEFAULT_TEMPLATE = "__default__";
export const encodeTemplate = (suffix: string | null) => suffix ?? DEFAULT_TEMPLATE;
export const decodeTemplate = (value: string) => (value === DEFAULT_TEMPLATE ? null : value);
export const templateLabel = (suffix: string | null) =>
  suffix === null ? "product.json" : `product.${suffix}.json`;

export type TemplateMode = "existing" | "generate";

/**
 * Template choice for a product page: one of the live theme's product
 * templates, used as is or as the base of a template Claude designs for the
 * product (CRO). Generation needs the store to allow theme writes.
 */
export function TemplatePicker({
  id,
  suffixes,
  storeDefault,
  value,
  onChange,
  mode,
  onModeChange,
  canGenerate,
  withImages,
  onWithImagesChange,
  disabled,
}: {
  id: string;
  suffixes: (string | null)[];
  storeDefault: string | null;
  /** Encoded suffix (encodeTemplate). */
  value: string;
  onChange: (value: string) => void;
  mode: TemplateMode;
  onModeChange: (mode: TemplateMode) => void;
  canGenerate: boolean;
  /** generate: the designed sections may show the product photos. */
  withImages: boolean;
  onWithImagesChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  // Generated templates (product.tc-*) are per product: never offered as a base.
  const options = suffixes.filter((s) => s === null || !s.startsWith("tc-"));
  const choices: { mode: TemplateMode; title: string; text: string }[] = [
    {
      mode: "existing",
      title: "Use this template",
      text: "Trendcart fills the sections and blocks it already has.",
    },
    {
      mode: "generate",
      title: "Rebuild it with Claude",
      text: canGenerate
        ? "Keeps its buy box, then Claude designs the sections below for this product, optimised for conversion."
        : "Needs the store to allow theme writes (write_themes): reconnect the store once it is enabled.",
    },
  ];
  return (
    <div className="grid gap-3">
      <SelectField
        id={`${id}-template`}
        label="Page template"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.value)}
        options={options.map((s) => ({
          value: encodeTemplate(s),
          label: s === storeDefault ? `${templateLabel(s)} (store default)` : templateLabel(s),
        }))}
      />
      <fieldset className="grid gap-2" disabled={disabled}>
        <legend className="sr-only">How to use the template</legend>
        {choices.map((c) => {
          const off = c.mode === "generate" && !canGenerate;
          const inputId = `${id}-mode-${c.mode}`;
          return (
            <label
              key={c.mode}
              htmlFor={inputId}
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm focus-within:ring-2 focus-within:ring-ring",
                mode === c.mode ? "border-brand-border bg-brand-soft" : "border-border",
                off && "cursor-not-allowed opacity-60",
              )}
            >
              <input
                id={inputId}
                type="radio"
                name={`${id}-mode`}
                value={c.mode}
                checked={mode === c.mode}
                disabled={off}
                onChange={() => onModeChange(c.mode)}
                className="mt-0.5 size-4 accent-brand"
              />
              <span className="grid gap-0.5">
                <span className="flex items-center gap-1 font-medium">
                  {c.mode === "generate" ? (
                    <SparklesIcon aria-hidden="true" className="size-3.5 text-brand-text" />
                  ) : null}
                  {c.title}
                </span>
                <span className="text-xs text-muted-foreground">{c.text}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {/* Always shown, so the option is discoverable; usable once Claude rebuilds the page. */}
      <label
        className={cn(
          "flex items-start gap-2 rounded-lg border border-border p-3 text-sm",
          (mode !== "generate" || !canGenerate) && "opacity-60",
        )}
      >
        <input
          type="checkbox"
          checked={mode === "generate" && canGenerate && withImages}
          disabled={disabled || mode !== "generate" || !canGenerate}
          onChange={(e) => onWithImagesChange(e.currentTarget.checked)}
          className="mt-0.5 size-4 accent-brand"
        />
        <span className="grid gap-0.5">
          <span className="font-medium">Allow sections with images</span>
          <span className="text-xs text-muted-foreground">
            {!canGenerate
              ? "Needs “Rebuild it with Claude”, which needs the store to allow theme writes (write_themes)."
              : mode !== "generate"
                ? "Choose “Rebuild it with Claude” above to use it."
                : "Claude can use image sections (image with text, columns with photos...) filled with the product photos uploaded to the store."}
          </span>
        </span>
      </label>
    </div>
  );
}
