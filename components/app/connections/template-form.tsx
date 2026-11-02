"use client";

import { PencilIcon } from "lucide-react";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import type { ShopifyTemplatesDTO } from "@/lib/services/types";

import type { ActionResult } from "../action-result";
import {
  FormError,
  FormSuccess,
  SelectField,
  TextField,
  type SelectOption,
} from "../form-controls";
import { Skeleton } from "../surface";

/** The template the Trendcart template kit installs (product.trendcart.json). */
const RECOMMENDED = "trendcart";
/** Select value for the default template (null suffix). */
const DEFAULT_VALUE = "";
const DEFAULT_LABEL = "Default product template";
const KIT_DOC = "docs/shopify-template-kit.md";

type Mode =
  | { kind: "view" }
  | { kind: "loading" }
  | { kind: "pick"; templates: ShopifyTemplatesDTO }
  /** The theme could not be read: free-text suffix, validated on save. */
  | { kind: "manual"; loadError: string };

export function templateOptions(
  suffixes: (string | null)[],
  current: string | null,
): SelectOption[] {
  const named = [...new Set(suffixes.filter((s): s is string => s !== null))];
  // Keep a saved suffix visible even if the live theme no longer has it.
  if (current !== null && !named.includes(current)) named.push(current);
  return [
    { value: DEFAULT_VALUE, label: DEFAULT_LABEL },
    ...named.map((suffix) => ({
      value: suffix,
      label:
        suffix === RECOMMENDED
          ? `${suffix} (recommended)`
          : suffixes.includes(suffix)
            ? suffix
            : `${suffix} (not in the live theme)`,
    })),
  ];
}

/**
 * Theme template used for generated product pages (product.<suffix>.json).
 *
 * The theme's templates are read from Shopify only when an editor opens the
 * picker of this connection ("Change template"), never on render. If that
 * read fails (expired connection, Shopify error), the suffix can still be
 * typed; the service validates it against the theme on save. Viewers see the
 * current value only.
 */
export function TemplateForm({
  connectionId,
  current,
  canEdit,
  onLoad,
  onSave,
}: {
  connectionId: string;
  current: string | null;
  canEdit: boolean;
  onLoad: () => Promise<ActionResult<ShopifyTemplatesDTO>>;
  onSave: (templateSuffix: string | null) => Promise<ActionResult>;
}) {
  const [mode, setMode] = useState<Mode>({ kind: "view" });
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const changeButton = useRef<HTMLButtonElement>(null);
  const request = useRef(0);
  const returnFocus = useRef(false);
  const id = `template-${connectionId}`;
  const editing = mode.kind === "pick" || mode.kind === "manual";

  // Move focus into the field when it appears, and back to "Change" after.
  useEffect(() => {
    if (editing) document.getElementById(id)?.focus();
    else if (mode.kind === "view" && returnFocus.current) {
      returnFocus.current = false;
      changeButton.current?.focus();
    }
  }, [editing, mode.kind, id]);

  function open() {
    const ticket = ++request.current;
    setError(null);
    setSaved(false);
    setMode({ kind: "loading" });
    void onLoad().then(
      (result) => {
        if (ticket !== request.current) return;
        setMode(
          result.ok
            ? { kind: "pick", templates: result.data }
            : { kind: "manual", loadError: result.error },
        );
      },
      () => {
        if (ticket !== request.current) return;
        setMode({ kind: "manual", loadError: "The store's theme could not be read." });
      },
    );
  }

  function close() {
    request.current++;
    returnFocus.current = true;
    setError(null);
    setMode({ kind: "view" });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const raw = String(new FormData(event.currentTarget).get("templateSuffix") ?? "").trim();
    setError(null);
    setSaved(false);
    startSave(async () => {
      const result = await onSave(raw || null);
      if (!result.ok) {
        setError(result.fieldErrors?.templateSuffix?.[0] ?? result.error);
        return;
      }
      returnFocus.current = true;
      setMode({ kind: "view" });
      setSaved(true);
    });
  }

  if (!editing) {
    return (
      <div className="grid gap-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm">
            <span className="font-medium">Product page template: </span>
            {current === null ? (
              <span className="text-muted-foreground">{DEFAULT_LABEL}</span>
            ) : (
              <code className="font-mono text-muted-foreground">product.{current}</code>
            )}
          </p>
          {canEdit ? (
            <Button
              ref={changeButton}
              variant="outline"
              size="sm"
              onClick={open}
              disabled={mode.kind === "loading"}
              aria-busy={mode.kind === "loading"}
            >
              <PencilIcon aria-hidden="true" />
              {mode.kind === "loading" ? "Loading templates…" : "Change template"}
            </Button>
          ) : null}
        </div>
        {mode.kind === "loading" ? (
          <div role="status" aria-label="Loading the theme's templates">
            <Skeleton className="h-10" />
          </div>
        ) : null}
        <FormSuccess message={saved ? "Template saved." : null} />
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-2">
      {mode.kind === "manual" ? (
        <FormError
          message={`${mode.loadError} Type the template suffix instead; it is checked against the live theme when you save.`}
        />
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        {mode.kind === "pick" ? (
          <SelectField
            id={id}
            name="templateSuffix"
            label="Product page template"
            options={templateOptions(mode.templates.suffixes, current)}
            defaultValue={current ?? DEFAULT_VALUE}
            disabled={saving}
            hint={
              mode.templates.hasTrendcartTemplate ? (
                "Templates of the store's live theme."
              ) : (
                <>
                  The recommended <code className="font-mono">product.trendcart</code> template is
                  not installed. To add it, follow the Shopify template kit guide (
                  <code className="font-mono">{KIT_DOC}</code>).
                </>
              )
            }
            className="flex-1"
          />
        ) : (
          <TextField
            id={id}
            name="templateSuffix"
            label="Product page template"
            placeholder="Default template"
            defaultValue={current ?? ""}
            maxLength={100}
            disabled={saving}
            hint={
              <>
                Suffix of a product template in the live theme, for example{" "}
                <code className="font-mono">trendcart</code> for{" "}
                <code className="font-mono">product.trendcart.json</code>. Leave empty for the
                default.
              </>
            }
            className="flex-1"
          />
        )}
        <div className="flex gap-2 sm:mb-[1.375rem]">
          <Button type="submit" size="lg" disabled={saving} aria-busy={saving}>
            {saving ? "Saving…" : "Save template"}
          </Button>
          <Button type="button" variant="ghost" size="lg" onClick={close} disabled={saving}>
            Cancel
          </Button>
        </div>
      </div>
      <FormError message={error} />
    </form>
  );
}
