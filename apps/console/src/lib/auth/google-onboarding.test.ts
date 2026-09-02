import { describe, expect, it } from "vitest"

import { classifyGoogleMembershipState } from "./google-onboarding"

describe("Google membership classification", () => {
  it("classifies complete empty reads as first-time", async () => {
    await expect(
      classifyGoogleMembershipState("u1", {
        memberships: [],
        degradedRegions: [],
      }),
    ).resolves.toEqual({ kind: "first_time" })
  })
  it("recognizes known memberships despite degradation", async () => {
    await expect(
      classifyGoogleMembershipState("u1", {
        memberships: [{ teamId: "team-2", region: "usw" }],
        degradedRegions: ["use"],
      }),
    ).resolves.toEqual({
      kind: "existing",
      membership: { teamId: "team-2", region: "usw" },
    })
  })
  it("treats degraded empty reads as indeterminate", async () => {
    await expect(
      classifyGoogleMembershipState("u1", {
        memberships: [],
        degradedRegions: ["usw"],
      }),
    ).resolves.toEqual({ kind: "indeterminate", degradedRegions: ["usw"] })
  })
})
