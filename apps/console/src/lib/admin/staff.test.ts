import type { User } from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"

import {
  canReadPlatformSandboxes,
  canViewOtherUsersAccount,
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
      canViewOtherUsersAccount(
        user("a@superserve.ai", "google", ["google"], ["platform:teams:read"]),
      ),
    ).toBe(true)
  })

  it("does not grant platform access without the permission", () => {
    expect(
      canViewOtherUsersAccount(
        user("a@superserve.ai", "google", ["google"], []),
      ),
    ).toBe(false)
  })

  it("does not grant platform access to non-staff even with the permission", () => {
    expect(
      canViewOtherUsersAccount(
        user("a@gmail.com", "google", ["google"], ["platform:teams:read"]),
      ),
    ).toBe(false)
  })
})

describe("platform sandbox read permission", () => {
  it("grants sandbox admin access from the auth claim", () => {
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

  it("does not grant sandbox admin access without the permission", () => {
    expect(
      canReadPlatformSandboxes(user("person@example.com", "email", ["email"])),
    ).toBe(false)
  })

  it("accepts the plural sandbox permission variant", () => {
    expect(
      canReadPlatformSandboxes(
        user(
          "person@example.com",
          "email",
          ["email"],
          ["platform:sandboxes:read"],
        ),
      ),
    ).toBe(true)
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
      canReadPlatformSandboxes(
        userWithMetadata({
          userAuthorizationPermissions: ["platform:sandbox:read"],
        }),
      ),
    ).toBe(false)
  })

  it("reads permissions from server-owned nested authorization claims", () => {
    expect(
      canReadPlatformSandboxes(
        userWithMetadata({
          appAuthorizationPermissions: ["platform:sandboxes:read"],
        }),
      ),
    ).toBe(true)
  })
})
