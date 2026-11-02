import { describe, expect, it } from "vitest";

import {
  ROLE_GRANTS,
  ROLES,
  can,
  gatePermission,
  parseRole,
  roleAtLeast,
  roles,
  statements,
  type Resource,
} from "./permissions";

describe("role hierarchy", () => {
  it("orders owner > media_buyer > creative > viewer", () => {
    expect(roleAtLeast("owner", "media_buyer")).toBe(true);
    expect(roleAtLeast("media_buyer", "creative")).toBe(true);
    expect(roleAtLeast("creative", "viewer")).toBe(true);
    expect(roleAtLeast("viewer", "creative")).toBe(false);
    expect(roleAtLeast("creative", "media_buyer")).toBe(false);
  });

  it("gives every role all permissions of the roles below it", () => {
    const ordered = ["viewer", "creative", "media_buyer", "owner"] as const;
    for (let i = 1; i < ordered.length; i++) {
      const lower = ROLE_GRANTS[ordered[i - 1]];
      const higher = ROLE_GRANTS[ordered[i]];
      for (const [resource, actions] of Object.entries(lower)) {
        for (const action of actions as readonly string[]) {
          expect(
            (higher[resource as keyof typeof higher] as readonly string[] | undefined)?.includes(
              action,
            ),
            `${ordered[i]} should have ${resource}:${action}`,
          ).toBe(true);
        }
      }
    }
  });
});

describe("owner", () => {
  it("has every permission in `statements`, including Better Auth's own", () => {
    for (const [resource, actions] of Object.entries(statements)) {
      for (const action of actions as readonly string[]) {
        const granted = ROLE_GRANTS.owner[resource as keyof typeof ROLE_GRANTS.owner] as
          readonly string[] | undefined;
        expect(granted?.includes(action), `owner ${resource}:${action}`).toBe(true);
        expect(
          roles.owner.authorize({ [resource]: [action] } as Parameters<
            typeof roles.owner.authorize
          >[0]).success,
          `authorize ${resource}:${action}`,
        ).toBe(true);
      }
    }
  });

  it("passes can() for every app permission", () => {
    for (const [resource, actions] of Object.entries(statements)) {
      if (!(resource in ROLE_GRANTS.owner)) continue;
      for (const action of actions as readonly string[]) {
        expect(can("owner", `${resource}:${action}` as Parameters<typeof can>[1])).toBe(true);
      }
    }
  });
});

describe("permission matrix", () => {
  it("keeps launch, budget and member management away from creatives and viewers", () => {
    expect(can("creative", "campaign:launch")).toBe(false);
    expect(can("creative", "campaign:budget")).toBe(false);
    expect(can("creative", gatePermission("launch"))).toBe(false);
    expect(can("media_buyer", "campaign:launch")).toBe(true);
    expect(can("media_buyer", gatePermission("launch"))).toBe(true);
    expect(can("viewer", "product:create")).toBe(false);
    expect(can("viewer", "campaign:read")).toBe(true);
    expect(can("media_buyer", "connection:delete")).toBe(false);
    expect(can("owner", "connection:delete")).toBe(true);
    expect(can("owner", "workspace:delete")).toBe(true);
  });

  it("only uses declared statements", () => {
    for (const role of ROLES) {
      for (const [resource, actions] of Object.entries(ROLE_GRANTS[role])) {
        const declared = statements[resource as Resource] as readonly string[] | undefined;
        expect(declared, resource).toBeDefined();
        for (const action of actions as readonly string[]) expect(declared).toContain(action);
      }
    }
  });

  it("matches Better Auth's access control for invitations", () => {
    expect(roles.owner.authorize({ invitation: ["create"] }).success).toBe(true);
    expect(roles.media_buyer.authorize({ invitation: ["create"] }).success).toBe(false);
    expect(roles.media_buyer.authorize({ campaign: ["launch"] }).success).toBe(true);
    expect(roles.creative.authorize({ campaign: ["launch"] }).success).toBe(false);
  });
});

describe("parseRole", () => {
  it("parses Better Auth role strings defensively", () => {
    expect(parseRole("creative")).toBe("creative");
    expect(parseRole("viewer,media_buyer")).toBe("media_buyer");
    expect(parseRole("admin")).toBeNull();
    expect(parseRole("")).toBeNull();
    expect(parseRole(null)).toBeNull();
  });
});
