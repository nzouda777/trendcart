"use client";

import { InfoIcon } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type FooterNewsletterProps = {
  title: string;
  description?: string;
  inputLabel: string;
  placeholder: string;
  submitLabel: string;
  successMessage: string;
};

/** Newsletter signup â€” UI only (Phase 1): no request is sent. */
export function FooterNewsletter({
  title,
  description,
  inputLabel,
  placeholder,
  submitLabel,
  successMessage,
}: FooterNewsletterProps) {
  const id = useId();
  const inputId = `${id}-email`;
  const titleId = `${id}-title`;
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.currentTarget.reset();
    setSubmitted(true);
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 id={titleId} className="text-sm font-medium text-foreground">
        {title}
      </h2>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}

      {/* The form stays mounted after submit so keyboard focus is never lost. */}
      <form
        aria-labelledby={titleId}
        onSubmit={handleSubmit}
        className="mt-1 flex w-full max-w-sm flex-col gap-2 sm:flex-row"
      >
        <label htmlFor={inputId} className="sr-only">
          {inputLabel}
        </label>
        <Input
          id={inputId}
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder={placeholder}
          onChange={() => setSubmitted(false)}
          className="h-10 bg-background/60 sm:flex-1"
        />
        <Button type="submit" className="h-10 px-4">
          {submitLabel}
        </Button>
      </form>

      <p role="status" aria-live="polite" className="min-h-5 text-sm text-foreground">
        {submitted ? (
          <span className="inline-flex items-start gap-1.5">
            <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            {successMessage}
          </span>
        ) : null}
      </p>
    </div>
  );
}
