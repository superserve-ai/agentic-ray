import type { User } from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"

import {
  canReadPlatformActivity,
  canReadPlatformSandboxes,
  canReadPlatformTemplates,
  canReadPlatformTeams,
  canStartPlatformImpersonation,
  canViewOtherUsersAccount,
  platformImpersonationReadScopes,
} from "./permissions"
import { isStaff } from "./staff"

function user(
  email: string,
  provider = "google",
  providers = ["google"],
  permissions: string[] = [],
): User {
  return {
    id: "u1",
    email,
    app_metadata: { provider, providers, permissions },
  } as unknown as User
}

function userWithMetadata({
  email = "person@example.com",
  appPermissions = [],
  userPermissions = [],
  appAuthorizationPermissions = [],
  userAuthorizationPermissions = [],
}: {
  email?: string
  appPermissions?: string[]
  userPermissions?: string[]
  appAuthorizationPermissions?: string[]
  userAuthorizationPermissions?: string[]
}): User {
  return {
    id: "u2",
    email,
    app_metadata: {
      provider: "email",
      providers: ["email"],
      permissions: appPermissions,
      authorization: { permissions: appAuthorizationPermissions },
    },
    user_metadata: {
      permissions: userPermissions,
      authorization: { permissions: userAuthorizationPermissions },
    },
  } as unknown as User
}

describe("isStaff", () => {
  it("accepts a google-verified staff-domain email", () => {
    expect(isStaff(user("alejandro@superserve.ai"))).toBe(true)
  })

  it("rejects the staff domain when provider is not google", () => {
    expect(isStaff(user("attacker@superserve.ai", "email", ["email"]))).toBe(
      false,
    )
  })

  it("rejects a google login on a different domain", () => {
    expect(isStaff(user("someone@gmail.com"))).toBe(false)
  })

  it("rejects null / no email", () => {
    expect(isStaff(null)).toBe(false)
    expect(
      isStaff({ id: "x", app_metadata: { provider: "google" } } as User),
    ).toBe(false)
  })
})

describe("platform team read permission", () => {
  it("requires staff identity and platform:teams:read on the auth claim", () => {
    expect(
      canReadPlatformTeams(
        user("a@superserve.ai", "google", ["google"], ["platform:teams:read"]),
      ),
    ).toBe(true)
  })

  it("does not grant team access without the permission", () => {
    expect(
      canReadPlatformTeams(user("a@superserve.ai", "google", ["google"])),
    ).toBe(false)
  })

  it("does not grant team access to non-staff even with the permission", () => {
    expect(
      canReadPlatformTeams(
        user("a@gmail.com", "google", ["google"], ["platform:teams:read"]),
      ),
    ).toBe(false)
  })

  it("matches the other-user-account gate", () => {
    expect(
      canViewOtherUsersAccount(
        user("a@superserve.ai", "google", ["google"], ["platform:teams:read"]),
      ),
    ).toBe(true)
  })
})

describe("platform resource read permissions", () => {
  it("requires the canonical sandbox permission only", () => {
    expect(
      canReadPlatformSandboxes(
        user(
          "person@example.com",
          "email",
          ["email"],
          ["platform:sandbox:read"],
        ),
      ),
    ).toBe(true)
  })

  it("requires the canonical template permission only", () => {
    expect(
      canReadPlatformTemplates(
        user(
          "person@example.com",
          "email",
          ["email"],
          ["platform:template:read"],
        ),
      ),
    ).toBe(true)
  })

  it("requires the canonical activity permission only", () => {
    expect(
      canReadPlatformActivity(
        user(
          "person@example.com",
          "email",
          ["email"],
          ["platform:activity:read"],
        ),
      ),
    ).toBe(true)
  })

  it("does not treat plural aliases as valid", () => {
    expect(
      canReadPlatformSandboxes(
        user(
          "person@example.com",
          "email",
          ["email"],
          ["platform:sandboxes:read"],
        ),
      ),
    ).toBe(false)
    expect(
      canReadPlatformTemplates(
        user(
          "person@example.com",
          "email",
          ["email"],
          ["platform:templates:read"],
        ),
      ),
    ).toBe(false)
    expect(
      canReadPlatformActivity(
        user(
          "person@example.com",
          "email",
          ["email"],
          ["platform:activities:read"],
        ),
      ),
    ).toBe(false)
  })

  it("does not let team read imply resource access", () => {
    expect(
      canReadPlatformSandboxes(
        user("person@example.com", "email", ["email"], ["platform:teams:read"]),
      ),
    ).toBe(false)
    expect(
      canReadPlatformTemplates(
        user("person@example.com", "email", ["email"], ["platform:teams:read"]),
      ),
    ).toBe(false)
    expect(
      canReadPlatformActivity(
        user("person@example.com", "email", ["email"], ["platform:teams:read"]),
      ),
    ).toBe(false)
  })

  it("does not trust permissions from user_metadata", () => {
    expect(
      canReadPlatformSandboxes(
        userWithMetadata({
          userPermissions: ["platform:sandbox:read"],
        }),
      ),
    ).toBe(false)
    expect(
      canReadPlatformTemplates(
        userWithMetadata({
          userAuthorizationPermissions: ["platform:template:read"],
        }),
      ),
    ).toBe(false)
    expect(
      canReadPlatformActivity(
        userWithMetadata({
          userPermissions: ["platform:activity:read"],
        }),
      ),
    ).toBe(false)
  })

  it("reads permissions from server-owned nested authorization claims", () => {
    expect(
      canReadPlatformSandboxes(
        userWithMetadata({
          appAuthorizationPermissions: ["platform:sandbox:read"],
        }),
      ),
    ).toBe(true)
    expect(
      canReadPlatformTemplates(
        userWithMetadata({
          appAuthorizationPermissions: ["platform:template:read"],
        }),
      ),
    ).toBe(true)
    expect(
      canReadPlatformActivity(
        userWithMetadata({
          appAuthorizationPermissions: ["platform:activity:read"],
        }),
      ),
    ).toBe(true)
  })
})

describe("platform impersonation access", () => {
  it("returns only canonical resource scopes", () => {
    expect(
      platformImpersonationReadScopes(
        user(
          "person@example.com",
          "google",
          ["google"],
          [
            "platform:sandbox:read",
            "platform:template:read",
            "platform:activity:read",
          ],
        ),
      ),
    ).toEqual([
      "platform:sandbox:read",
      "platform:template:read",
      "platform:activity:read",
    ])
  })

  it("returns only the matching scope when a single permission is present", () => {
    expect(
      platformImpersonationReadScopes(
        user(
          "person@example.com",
          "google",
          ["google"],
          ["platform:sandbox:read"],
        ),
      ),
    ).toEqual(["platform:sandbox:read"])
    expect(
      platformImpersonationReadScopes(
        user(
          "person@example.com",
          "google",
          ["google"],
          ["platform:template:read"],
        ),
      ),
    ).toEqual(["platform:template:read"])
    expect(
      platformImpersonationReadScopes(
        user(
          "person@example.com",
          "google",
          ["google"],
          ["platform:activity:read"],
        ),
      ),
    ).toEqual(["platform:activity:read"])
  })

  it("does not include teams read", () => {
    expect(
      platformImpersonationReadScopes(
        user(
          "person@example.com",
          "google",
          ["google"],
          ["platform:teams:read"],
        ),
      ),
    ).toEqual([])
  })

  it("allows impersonation only for staff with at least one supported scope", () => {
    expect(
      canStartPlatformImpersonation(
        user(
          "a@superserve.ai",
          "google",
          ["google"],
          ["platform:sandbox:read"],
        ),
      ),
    ).toBe(true)
    expect(
      canStartPlatformImpersonation(
        user(
          "a@superserve.ai",
          "google",
          ["google"],
          ["platform:activity:read"],
        ),
      ),
    ).toBe(true)
    expect(
      canStartPlatformImpersonation(
        user(
          "a@superserve.ai",
          "google",
          ["google"],
          ["platform:template:read"],
        ),
      ),
    ).toBe(true)
    expect(
      canStartPlatformImpersonation(
        user("a@superserve.ai", "google", ["google"], ["platform:teams:read"]),
      ),
    ).toBe(false)
  })
})
