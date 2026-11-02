import "server-only";

import { createHash } from "node:crypto";

import { siteConfig } from "@/config/site";
import { resolveIntegrationsMode } from "@/lib/integrations/mode";

import { ROLE_LABELS, type Role } from "./permissions";

/*
 * Auth emails (verification, workspace invitations).
 *
 * - mock mode: the link is printed to the server console, nothing is sent.
 * - live mode: sent through Resend's REST API (POST /emails) with
 *   RESEND_API_KEY and MAIL_FROM. A missing key or sender throws at send time,
 *   and a Resend error throws too: emails are never dropped silently.
 *   Links are never logged in live mode (a log reader could take over accounts).
 *
 * Links come from Better Auth / lib/auth/server.ts, built on BETTER_AUTH_URL
 * or NEXT_PUBLIC_SITE_URL.
 */

export const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type AuthEmail = {
  to: string;
  subject: string;
  /** The action link (verify, accept invitation); only logged in mock mode. */
  url: string;
  html: string;
  text: string;
};

export type MailDeps = {
  fetch?: typeof fetch;
  env?: Record<string, string | undefined>;
};

/** Same rule as the integration registry: throws in production unless "live". */
export function integrationsMode(env: Record<string, string | undefined> = process.env) {
  return resolveIntegrationsMode(env);
}

export class MailError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MailError";
    this.status = status;
  }
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                  */
/* -------------------------------------------------------------------------- */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Plain, accessible layout: real text, one link, a copyable URL fallback. */
function layout(input: {
  title: string;
  paragraphs: string[];
  actionLabel: string;
  url: string;
  footer: string;
}): string {
  const url = escapeHtml(input.url);
  const paragraphs = input.paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:24px">${escapeHtml(p)}</p>`)
    .join("");
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.title)}</title></head>
<body style="margin:0;padding:24px;background:#ffffff;color:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<main style="max-width:560px;margin:0 auto">
<h1 style="margin:0 0 16px;font-size:22px;line-height:30px">${escapeHtml(input.title)}</h1>
${paragraphs}
<p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#008060;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${escapeHtml(input.actionLabel)}</a></p>
<p style="margin:0 0 8px;font-size:14px;line-height:20px;color:#5c5c5c">If the button does not work, copy this link into your browser:</p>
<p style="margin:0 0 24px;font-size:14px;line-height:20px;word-break:break-all"><a href="${url}" style="color:#00664c">${url}</a></p>
<p style="margin:0;font-size:13px;line-height:20px;color:#5c5c5c">${escapeHtml(input.footer)}</p>
</main>
</body>
</html>`;
}

export function verificationEmail(input: { to: string; name: string; url: string }): AuthEmail {
  const subject = `Verify your ${siteConfig.name} email`;
  const greeting = input.name ? `Hi ${input.name},` : "Hi,";
  const body = `Confirm that ${input.to} is your email address to activate your ${siteConfig.name} account.`;
  const footer = `If you did not create a ${siteConfig.name} account, you can ignore this email.`;
  return {
    to: input.to,
    subject,
    url: input.url,
    html: layout({
      title: subject,
      paragraphs: [greeting, body],
      actionLabel: "Verify email",
      url: input.url,
      footer,
    }),
    text: `${greeting}\n\n${body}\n\nVerify your email: ${input.url}\n\n${footer}\n`,
  };
}

export function invitationEmail(input: {
  to: string;
  inviterName: string;
  workspaceName: string;
  role: Role | null;
  url: string;
}): AuthEmail {
  const subject = `${input.inviterName} invited you to ${input.workspaceName} on ${siteConfig.name}`;
  const role = input.role ? ` as ${ROLE_LABELS[input.role]}` : "";
  const body = `${input.inviterName} invited you to join the ${input.workspaceName} workspace${role}. The invitation expires in 7 days.`;
  const footer = `If you were not expecting this invitation, you can ignore this email.`;
  return {
    to: input.to,
    subject,
    url: input.url,
    html: layout({
      title: subject,
      paragraphs: [body],
      actionLabel: "View invitation",
      url: input.url,
      footer,
    }),
    text: `${body}\n\nView the invitation: ${input.url}\n\n${footer}\n`,
  };
}

/* -------------------------------------------------------------------------- */
/* Sending                                                                    */
/* -------------------------------------------------------------------------- */

export async function sendAuthEmail(email: AuthEmail, deps: MailDeps = {}): Promise<void> {
  const env = deps.env ?? process.env;
  if (integrationsMode(env) === "mock") {
    console.info(`\n[auth:mock-email] To: ${email.to}\n  ${email.subject}\n  ${email.url}\n`);
    return;
  }

  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.MAIL_FROM?.trim();
  if (!apiKey || !from) {
    throw new MailError(
      `Cannot send "${email.subject}": ${!apiKey ? "RESEND_API_KEY" : "MAIL_FROM"} is not set (required when INTEGRATIONS_MODE=live).`,
    );
  }

  // Retries of the same message (same recipient + link) are deduplicated by Resend.
  const idempotencyKey = createHash("sha256")
    .update(`${email.to}\n${email.subject}\n${email.url}`)
    .digest("hex");

  let res: Response;
  try {
    res = await (deps.fetch ?? fetch)(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (cause) {
    throw new MailError(`Could not reach Resend to send "${email.subject}".`, null, { cause });
  }

  if (!res.ok) {
    const detail = await res
      .json()
      .then((b: unknown) =>
        b && typeof b === "object" && "message" in b
          ? String((b as { message: unknown }).message)
          : "",
      )
      .catch(() => "");
    throw new MailError(
      `Resend rejected "${email.subject}" (HTTP ${res.status})${detail ? `: ${detail}` : ""}.`,
      res.status,
    );
  }
}
