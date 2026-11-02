"use client";

import { organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { AUTH_PATHS, safeNextPath } from "./paths";
import { ac, roles } from "./permissions";

/**
 * Browser auth client. Same origin as the app, so no baseURL.
 *
 *   authClient.signIn.email({ email, password })
 *   authClient.organization.create({ name, slug })
 *   authClient.organization.setActive({ organizationId })
 *   authClient.organization.inviteMember({ email, role: "creative" })
 *   authClient.twoFactor.enable({ password }) / verifyTotp({ code })
 */
export const authClient = createAuthClient({
  plugins: [
    organizationClient({ ac, roles }),
    twoFactorClient({
      onTwoFactorRedirect() {
        const raw = new URLSearchParams(window.location.search).get("next");
        const next = raw ? safeNextPath(raw, "") : "";
        window.location.href = next
          ? `${AUTH_PATHS.twoFactor}?next=${encodeURIComponent(next)}`
          : AUTH_PATHS.twoFactor;
      },
    }),
  ],
});

export const { useSession, signOut } = authClient;
