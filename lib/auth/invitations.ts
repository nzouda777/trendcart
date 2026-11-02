import "server-only";

import { headers } from "next/headers";

import { parseRole, type Role } from "./permissions";
import { getAuth } from "./session";

export type InvitationView = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  inviterEmail: string;
  role: Role;
  email: string;
};

/**
 * The invitation addressed to the signed-in user, or null when it does not
 * exist, expired, was already used, or belongs to another email address.
 */
export async function getInvitationForCurrentUser(id: string): Promise<InvitationView | null> {
  try {
    const invitation = await getAuth().api.getInvitation({
      headers: await headers(),
      query: { id },
    });
    const role = parseRole(invitation?.role);
    if (!invitation || !role || invitation.status !== "pending") return null;
    return {
      id: invitation.id,
      workspaceId: invitation.organizationId,
      workspaceName: invitation.organizationName,
      inviterEmail: invitation.inviterEmail,
      role,
      email: invitation.email,
    };
  } catch {
    return null;
  }
}
