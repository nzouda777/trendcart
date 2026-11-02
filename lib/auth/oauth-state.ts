import "server-only";

import { randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";

import { decrypt, encrypt, type Cipher } from "@/lib/crypto";

/*
 * OAuth `state` for outbound connection flows (Shopify, TikTok Ads, TikTok
 * Login). The random state goes to the provider; an encrypted, short-lived,
 * httpOnly cookie binds it to the workspace and user that started the flow.
 *
 *   // start route
 *   const state = await beginOAuthState("tiktok_ads", { workspaceId, userId, data: { brandId } });
 *   redirect(providerAuthorizeUrl({ state }));
 *
 *   // callback route
 *   const flow = await consumeOAuthState("tiktok_ads", searchParams.get("state"));
 *   // flow.workspaceId must equal the current session workspace.
 */

export const OAUTH_PROVIDERS = ["shopify", "tiktok_ads", "tiktok_login"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

const TTL_SECONDS = 10 * 60;

const payloadSchema = z.object({
  provider: z.enum(OAUTH_PROVIDERS),
  state: z.string().min(32),
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
  expiresAt: z.number().int(),
  data: z.record(z.string(), z.unknown()),
});

export type OAuthFlow = z.infer<typeof payloadSchema>;

export class OAuthStateError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "OAuthStateError";
  }
}

type Sealer = Pick<Cipher, "encrypt" | "decrypt">;
const appSealer: Sealer = { encrypt, decrypt };

const cookieName = (provider: OAuthProvider) => `tc_oauth_${provider}`;
const aad = (provider: OAuthProvider) => `oauth_state:${provider}`;

/** Pure part of `beginOAuthState`, exported for tests. */
export function sealOAuthState(
  provider: OAuthProvider,
  input: { workspaceId: string; userId: string; data?: Record<string, unknown> },
  options: { sealer?: Sealer; now?: number } = {},
): { state: string; sealed: string } {
  const { sealer = appSealer, now = Date.now() } = options;
  const payload: OAuthFlow = {
    provider,
    state: randomBytes(32).toString("base64url"),
    workspaceId: input.workspaceId,
    userId: input.userId,
    expiresAt: now + TTL_SECONDS * 1000,
    data: input.data ?? {},
  };
  return {
    state: payload.state,
    sealed: sealer.encrypt(JSON.stringify(payload), { aad: aad(provider) }),
  };
}

/** Pure part of `consumeOAuthState`, exported for tests. */
export function openOAuthState(
  provider: OAuthProvider,
  sealed: string | undefined,
  returnedState: string | null | undefined,
  options: { sealer?: Sealer; now?: number } = {},
): OAuthFlow {
  const { sealer = appSealer, now = Date.now() } = options;
  if (!sealed) throw new OAuthStateError("OAuth flow not found or expired. Start again.");
  if (!returnedState) throw new OAuthStateError("Missing OAuth state.");

  let payload: OAuthFlow;
  try {
    payload = payloadSchema.parse(JSON.parse(sealer.decrypt(sealed, { aad: aad(provider) })));
  } catch {
    throw new OAuthStateError("Invalid OAuth flow.");
  }

  const expected = Buffer.from(payload.state);
  const actual = Buffer.from(returnedState);
  if (
    payload.provider !== provider ||
    expected.length !== actual.length ||
    !timingSafeEqual(expected, actual)
  ) {
    throw new OAuthStateError("OAuth state mismatch.");
  }
  if (payload.expiresAt <= now) throw new OAuthStateError("OAuth flow expired. Start again.");
  return payload;
}

/** Starts a flow: sets the binding cookie and returns the `state` to send. */
export async function beginOAuthState(
  provider: OAuthProvider,
  input: { workspaceId: string; userId: string; data?: Record<string, unknown> },
): Promise<string> {
  const { state, sealed } = sealOAuthState(provider, input);
  (await cookies()).set(cookieName(provider), sealed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TTL_SECONDS,
  });
  return state;
}

/** Verifies the returned `state` once (the cookie is always cleared). */
export async function consumeOAuthState(
  provider: OAuthProvider,
  returnedState: string | null | undefined,
): Promise<OAuthFlow> {
  const jar = await cookies();
  const sealed = jar.get(cookieName(provider))?.value;
  jar.delete(cookieName(provider));
  return openOAuthState(provider, sealed, returnedState);
}
