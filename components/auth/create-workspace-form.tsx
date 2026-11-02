"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/client";
import { AUTH_PATHS } from "@/lib/auth/paths";

import { Field, FormError } from "./form-parts";

function slugify(name: string) {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  // Slugs are globally unique; a short suffix avoids collisions between teams.
  return `${base || "workspace"}-${crypto.randomUUID().slice(0, 6)}`;
}

/** Creates a workspace (the creator becomes owner) and makes it active. */
export function CreateWorkspaceForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    if (!name) return;
    setPending(true);
    setError(null);

    const { data, error: failure } = await authClient.organization.create({
      name,
      slug: slugify(name),
    });
    if (failure || !data) {
      setPending(false);
      setError(failure?.message ?? "Could not create the workspace.");
      return;
    }
    await authClient.organization.setActive({ organizationId: data.id });
    router.push(AUTH_PATHS.home);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <Field
        id="name"
        name="name"
        label="Workspace name"
        autoComplete="organization"
        maxLength={80}
        hint="Usually your company. You can add brands and stores inside it."
        required
        autoFocus
      />
      <FormError message={error} />
      <Button type="submit" size="xl" disabled={pending} aria-busy={pending}>
        {pending ? "Creating…" : "Create workspace"}
      </Button>
    </form>
  );
}
