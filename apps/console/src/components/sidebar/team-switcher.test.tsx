import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

const mutate = vi.fn()
let teamsData: unknown

vi.mock("@/hooks/use-teams", () => ({
  useTeams: () => ({ data: teamsData }),
  useSwitchTeam: () => ({ mutate, isPending: false }),
}))

vi.mock("@superserve/ui", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, useToast: () => ({ addToast: vi.fn() }) }
})

import { TeamSwitcher } from "./team-switcher"

const twoRegions = {
  activeTeamId: "team-a",
  activeRegion: "use",
  teams: [
    { id: "team-a", name: "alpha", region: "use" },
    { id: "team-w", name: "westside", region: "usw" },
  ],
}

describe("TeamSwitcher", () => {
  it("renders the active team's name, not the raw option value", () => {
    teamsData = twoRegions
    render(<TeamSwitcher />)
    expect(screen.getByText("alpha · US East")).toBeInTheDocument()
    expect(screen.queryByText(/use:team-a/)).not.toBeInTheDocument()
  })

  it("opens the dropdown and lists every team on click", async () => {
    teamsData = twoRegions
    const user = userEvent.setup()
    render(<TeamSwitcher />)

    await user.click(screen.getByRole("combobox", { name: "Active team" }))

    expect(
      await screen.findByRole("option", { name: "westside · US West" }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("option", { name: "alpha · US East" }),
    ).toBeInTheDocument()
  })

  it("switches to the picked team", async () => {
    teamsData = twoRegions
    const user = userEvent.setup()
    render(<TeamSwitcher />)

    await user.click(screen.getByRole("combobox", { name: "Active team" }))
    await user.click(
      await screen.findByRole("option", { name: "westside · US West" }),
    )

    expect(mutate).toHaveBeenCalledWith(
      { teamId: "team-w", region: "usw" },
      expect.anything(),
    )
  })

  it("omits region labels when all teams share one region", () => {
    teamsData = {
      ...twoRegions,
      teams: [
        { id: "team-a", name: "alpha", region: "use" },
        { id: "team-b", name: "beta", region: "use" },
      ],
    }
    render(<TeamSwitcher />)
    expect(screen.getByText("alpha")).toBeInTheDocument()
  })

  it("renders nothing for single-team users", () => {
    teamsData = {
      ...twoRegions,
      teams: [{ id: "team-a", name: "alpha", region: "use" }],
    }
    const { container } = render(<TeamSwitcher />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe("TeamSwitcher ordering", () => {
  it("lists the active team first, the rest alphabetical", async () => {
    teamsData = {
      activeTeamId: "team-m",
      activeRegion: "use",
      teams: [
        { id: "team-z", name: "zeta", region: "use" },
        { id: "team-m", name: "mango", region: "use" },
        { id: "team-a", name: "apple", region: "use" },
      ],
    }
    const user = userEvent.setup()
    render(<TeamSwitcher />)
    await user.click(screen.getByRole("combobox", { name: "Active team" }))
    const labels = (await screen.findAllByRole("option")).map(
      (o) => o.textContent,
    )
    expect(labels).toEqual(["mango", "apple", "zeta"])
  })
})
