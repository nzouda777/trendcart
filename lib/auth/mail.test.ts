import { describe, expect, it, vi } from "vitest";

import {
  invitationEmail,
  MailError,
  RESEND_ENDPOINT,
  sendAuthEmail,
  verificationEmail,
} from "./mail";

const LIVE = {
  INTEGRATIONS_MODE: "live",
  RESEND_API_KEY: "re_test_123",
  MAIL_FROM: "Trendcart <no-reply@example.test>",
};

const verify = () =>
  verificationEmail({
    to: "ana@example.test",
    name: "Ana <b>",
    url: "https://app.example.test/api/auth/verify-email?token=abc&callbackURL=%2Fapp",
  });

function okFetch() {
  return vi.fn(async () => new Response(JSON.stringify({ id: "email_1" }), { status: 200 }));
}

describe("templates", () => {
  it("builds escaped, accessible HTML and a text body carrying the link", () => {
    const mail = verify();
    expect(mail.subject).toBe("Verify your Trendcart email");
    expect(mail.html).toContain('<html lang="en">');
    expect(mail.html).toContain("Hi Ana &lt;b&gt;,");
    expect(mail.html).not.toContain("<b>,");
    expect(mail.html).toContain(
      'href="https://app.example.test/api/auth/verify-email?token=abc&amp;callbackURL=%2Fapp"',
    );
    expect(mail.text).toContain(mail.url);

    const invite = invitationEmail({
      to: "bo@example.test",
      inviterName: "Olivia",
      workspaceName: "Northwind",
      role: "media_buyer",
      url: "https://app.example.test/sign-up/invite/inv_1",
    });
    expect(invite.subject).toBe("Olivia invited you to Northwind on Trendcart");
    expect(invite.text).toContain("as Media buyer");
    expect(invite.html).toContain("https://app.example.test/sign-up/invite/inv_1");
  });
});

describe("sendAuthEmail", () => {
  it("mock mode logs the link and never calls fetch", async () => {
    const fetch = okFetch();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await sendAuthEmail(verify(), { fetch, env: { INTEGRATIONS_MODE: "mock" } });
    expect(fetch).not.toHaveBeenCalled();
    expect(info.mock.calls.flat().join(" ")).toContain("verify-email?token=abc");
    info.mockRestore();
  });

  it("live mode posts to Resend with auth, idempotency key, html and text", async () => {
    const fetch = okFetch();
    const mail = verify();
    await sendAuthEmail(mail, { fetch, env: LIVE });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(RESEND_ENDPOINT);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test_123");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Idempotency-Key"]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(String(init.body))).toEqual({
      from: LIVE.MAIL_FROM,
      to: ["ana@example.test"],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
  });

  it("live mode throws without RESEND_API_KEY or MAIL_FROM", async () => {
    const fetch = okFetch();
    await expect(
      sendAuthEmail(verify(), { fetch, env: { ...LIVE, RESEND_API_KEY: "" } }),
    ).rejects.toThrow(/RESEND_API_KEY is not set/);
    await expect(
      sendAuthEmail(verify(), { fetch, env: { ...LIVE, MAIL_FROM: undefined } }),
    ).rejects.toThrow(/MAIL_FROM is not set/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("surfaces Resend and network errors without leaking the link", async () => {
    const rejected = vi.fn(
      async () =>
        new Response(JSON.stringify({ statusCode: 403, message: "Domain not verified" }), {
          status: 403,
        }),
    );
    const error = await sendAuthEmail(verify(), { fetch: rejected, env: LIVE }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(MailError);
    expect((error as MailError).status).toBe(403);
    expect((error as MailError).message).toContain("Domain not verified");
    expect((error as MailError).message).not.toContain("token=abc");

    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(sendAuthEmail(verify(), { fetch: offline, env: LIVE })).rejects.toThrow(
      /Could not reach Resend/,
    );
  });

  it("refuses mock mode on Vercel production", async () => {
    await expect(
      sendAuthEmail(verify(), { fetch: okFetch(), env: { VERCEL_ENV: "production" } }),
    ).rejects.toThrow(/INTEGRATIONS_MODE/);
  });
});
