"use client"

import {
  ArrowSquareOutIcon,
  PlusIcon,
  ShieldCheckIcon,
  UserMinusIcon,
  UsersIcon,
} from "@phosphor-icons/react"
import {
  Button,
  Field,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@superserve/ui"
import Link from "next/link"
import { useMemo, useState } from "react"
import type { ComponentType, FormEvent } from "react"

import { EmptyState } from "@/components/empty-state"
import { ErrorState } from "@/components/error-state"
import { PageHeader } from "@/components/page-header"
import { TableSkeleton } from "@/components/table-skeleton"
import {
  useAssignTeamRole,
  useRevokeTeamRole,
  useTeamManagement,
} from "@/hooks/use-team-management"
import type { TeamMember, TeamRoleAssignment } from "@/lib/api/team-management"

function roleLabel(role: string): string {
  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function statusTone(status: TeamMember["status"]): string {
  if (status === "active") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
  }
  if (status === "invited") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-300"
  }
  return "border-border bg-muted/30 text-muted"
}

function StatusBadge({ status }: { status: TeamMember["status"] }) {
  return (
    <span
      className={`inline-flex items-center border px-2 py-1 font-mono text-[11px] tracking-[0.12em] uppercase ${statusTone(status)}`}
    >
      {status}
    </span>
  )
}

function roleChipTone(role: string): string {
  if (role === "team_owner") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
  }
  if (role === "admin") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-200"
  }
  return "border-border bg-background text-foreground"
}

function RolePills({ roles }: { roles?: string[] }) {
  if (!roles || roles.length === 0) {
    return <span className="text-xs text-muted">No active roles</span>
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {roles.map((role) => (
        <span
          key={role}
          className={`inline-flex items-center border px-2 py-1 text-xs ${roleChipTone(role)}`}
        >
          {roleLabel(role)}
        </span>
      ))}
    </div>
  )
}

function SummaryCard({
  icon: IconComponent,
  value,
  label,
  description,
  iconTone,
}: {
  icon: ComponentType<{ className?: string; weight?: "light" | "regular" }>
  value: number
  label: string
  description: string
  iconTone: string
}) {
  return (
    <div className="border border-border/80 bg-background/75 p-5 shadow-[0_1px_0_rgba(255,255,255,0.02)] backdrop-blur-sm">
      <div className="flex items-center gap-4">
        <div
          className={`flex size-14 shrink-0 items-center justify-center border border-border/80 ${iconTone}`}
        >
          <IconComponent className="size-6" weight="light" />
        </div>
        <div className="min-w-0">
          <div className="font-mono text-4xl leading-none text-foreground">
            {value}
          </div>
          <div className="mt-1 text-sm font-medium text-foreground">
            {label}
          </div>
          <div className="mt-1 text-xs text-muted">{description}</div>
        </div>
      </div>
    </div>
  )
}

function InviteMemberCard() {
  return (
    <div className="border border-border/80 bg-background/75 p-6 backdrop-blur-sm">
      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div>
          <p className="text-lg font-medium text-foreground">Invite member</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Invite new members to join your team.
          </p>
          <div className="mt-4 border border-border bg-muted/20 px-4 py-3 text-sm text-muted">
            Email invitations coming soon.
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px_auto]">
          <Field label="Email address">
            <Input disabled placeholder="name@company.com" value="" />
          </Field>
          <Field label="Role">
            <select
              disabled
              className="h-9 w-full border border-border bg-background px-3 text-sm text-muted outline-none"
              value="member"
            >
              <option value="member">Member</option>
            </select>
          </Field>
          <div className="flex items-end">
            <Button type="button" size="sm" disabled>
              <PlusIcon className="size-3.5" weight="light" />
              Send invitation
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AssignRoleForm({
  members,
  roles,
  selectedUserId,
  onSelectedUserIdChange,
}: {
  members: TeamMember[]
  roles: string[]
  selectedUserId: string
  onSelectedUserIdChange: (userId: string) => void
}) {
  const assignRole = useAssignTeamRole()
  const activeMembers = members.filter((member) => member.status === "active")
  const [roleName, setRoleName] = useState("")

  const selectedRoleName = roles.includes(roleName)
    ? roleName
    : (roles[0] ?? "")

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!selectedUserId || !selectedRoleName) {
      return
    }
    assignRole.mutate({ user_id: selectedUserId, role_name: selectedRoleName })
  }

  if (activeMembers.length === 0 || roles.length === 0) {
    return (
      <p className="text-sm text-muted">
        Add an active member before assigning team roles.
      </p>
    )
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_220px_auto]"
    >
      <Field label="Select member">
        <select
          value={selectedUserId}
          onChange={(event) => onSelectedUserIdChange(event.target.value)}
          className="h-9 w-full border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-foreground"
        >
          {activeMembers.map((member) => (
            <option key={member.user_id} value={member.user_id}>
              {member.email}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Assign role">
        <select
          value={selectedRoleName}
          onChange={(event) => setRoleName(event.target.value)}
          className="h-9 w-full border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-foreground"
        >
          {roles.map((role) => (
            <option key={role} value={role}>
              {roleLabel(role)}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex items-end">
        <Button
          type="submit"
          size="sm"
          disabled={
            !selectedUserId || !selectedRoleName || assignRole.isPending
          }
        >
          <ShieldCheckIcon className="size-3.5" weight="light" />
          {assignRole.isPending ? "Assigning..." : "Update role"}
        </Button>
      </div>
    </form>
  )
}

function MemberActions({
  member,
  onManageRoles,
}: {
  member: TeamMember
  onManageRoles: (userId: string) => void
}) {
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => onManageRoles(member.user_id)}
    >
      <ShieldCheckIcon className="size-3.5" weight="light" />
      Manage roles
    </Button>
  )
}

function MemberTable({
  members,
  onManageRoles,
  showManageRoles,
  emptyLabel,
}: {
  members: TeamMember[]
  onManageRoles: (userId: string) => void
  showManageRoles: boolean
  emptyLabel: string
}) {
  if (members.length === 0) {
    return (
      <div className="border border-border bg-background/60 px-4 py-6 text-sm text-muted">
        {emptyLabel}
      </div>
    )
  }

  return (
    <div className="overflow-hidden border border-border bg-background/60">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Active roles</TableHead>
            <TableHead>Updated</TableHead>
            {showManageRoles && <TableHead className="w-40" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => (
            <TableRow key={member.user_id}>
              <TableCell>
                <div className="font-medium text-foreground">
                  {member.email}
                </div>
                <div className="font-mono text-xs text-muted">
                  {member.user_id}
                </div>
                {member.full_name && (
                  <div className="text-xs text-muted">{member.full_name}</div>
                )}
              </TableCell>
              <TableCell>
                <StatusBadge status={member.status} />
              </TableCell>
              <TableCell>
                <RolePills roles={member.roles} />
              </TableCell>
              <TableCell
                className="text-muted tabular-nums"
                suppressHydrationWarning
              >
                {new Date(member.updated_at).toLocaleDateString()}
              </TableCell>
              {showManageRoles && (
                <TableCell>
                  <MemberActions
                    member={member}
                    onManageRoles={onManageRoles}
                  />
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function ActiveAssignmentRows({
  assignments,
  canRevoke,
}: {
  assignments: TeamRoleAssignment[]
  canRevoke: boolean
}) {
  const revokeRole = useRevokeTeamRole()
  const activeAssignments = assignments.filter(
    (assignment) => !assignment.revoked_at,
  )

  if (activeAssignments.length === 0) {
    return (
      <div className="border border-border bg-background/60 px-4 py-6 text-sm text-muted">
        No active role assignments.
      </div>
    )
  }

  return (
    <div className="overflow-hidden border border-border bg-background/60">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Granted</TableHead>
            {canRevoke && <TableHead className="w-32" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {activeAssignments.map((assignment) => (
            <TableRow key={assignment.assignment_id}>
              <TableCell>
                <div className="font-medium text-foreground">
                  {assignment.email}
                </div>
                <div className="font-mono text-xs text-muted">
                  {assignment.user_id}
                </div>
              </TableCell>
              <TableCell>{roleLabel(assignment.role_name)}</TableCell>
              <TableCell
                className="text-muted tabular-nums"
                suppressHydrationWarning
              >
                {new Date(assignment.granted_at).toLocaleDateString()}
              </TableCell>
              {canRevoke && (
                <TableCell>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={revokeRole.isPending}
                    onClick={() => revokeRole.mutate(assignment.assignment_id)}
                  >
                    Revoke
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function MemberTabs({
  members,
  onManageRoles,
  showManageRoles,
  search,
}: {
  members: TeamMember[]
  onManageRoles: (userId: string) => void
  showManageRoles: boolean
  search: string
}) {
  const normalize = (value: string) => value.toLowerCase().trim()
  const query = normalize(search)

  const filteredMembers = useMemo(() => {
    const matchesQuery = (member: TeamMember) => {
      if (!query) return true
      const haystack = [member.email, member.full_name ?? "", member.user_id]
        .join(" ")
        .toLowerCase()
      return haystack.includes(query)
    }

    return {
      active: members.filter(
        (member) => member.status === "active" && matchesQuery(member),
      ),
      invited: members.filter(
        (member) => member.status === "invited" && matchesQuery(member),
      ),
      inactive: members.filter(
        (member) => member.status === "inactive" && matchesQuery(member),
      ),
    }
  }, [members, query])

  const tabs = [
    {
      value: "active",
      label: "Active members",
      count: filteredMembers.active.length,
    },
    {
      value: "invited",
      label: "Invitations",
      count: filteredMembers.invited.length,
    },
    {
      value: "inactive",
      label: "Inactive members",
      count: filteredMembers.inactive.length,
    },
  ] as const

  return (
    <Tabs defaultValue="active" className="w-full">
      <TabsList className="gap-2 border-b border-border">
        {tabs.map((tab) => (
          <TabsTab key={tab.value} value={tab.value} className="px-2 pt-2 pb-3">
            <span className="inline-flex items-center gap-2">
              {tab.label}
              <span className="border border-border bg-background px-2 py-0.5 text-[11px] text-muted">
                {tab.count}
              </span>
            </span>
          </TabsTab>
        ))}
      </TabsList>

      <TabsPanel value="active">
        <MemberTable
          members={filteredMembers.active}
          onManageRoles={onManageRoles}
          showManageRoles={showManageRoles}
          emptyLabel="No active members match this search."
        />
      </TabsPanel>
      <TabsPanel value="invited">
        <MemberTable
          members={filteredMembers.invited}
          onManageRoles={onManageRoles}
          showManageRoles={showManageRoles}
          emptyLabel="No invitations match this search."
        />
      </TabsPanel>
      <TabsPanel value="inactive">
        <MemberTable
          members={filteredMembers.inactive}
          onManageRoles={onManageRoles}
          showManageRoles={showManageRoles}
          emptyLabel="No inactive members match this search."
        />
      </TabsPanel>
    </Tabs>
  )
}

export function UserManagementClient() {
  const { data, isPending, error, refetch } = useTeamManagement()
  const [memberSearch, setMemberSearch] = useState("")
  const [selectedUserId, setSelectedUserId] = useState("")

  const counts = useMemo(() => {
    const members = data?.members ?? []
    return {
      active: members.filter((member) => member.status === "active").length,
      invited: members.filter((member) => member.status === "invited").length,
      inactive: members.filter((member) => member.status === "inactive").length,
    }
  }, [data?.members])

  if (isPending) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="User Management">
          <div className="h-9 w-28 border border-border bg-muted/30" />
        </PageHeader>
        <div className="flex-1 overflow-y-auto px-6 py-8">
          <TableSkeleton columns={5} />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="User Management" />
        <ErrorState message={error.message} onRetry={() => refetch()} />
      </div>
    )
  }

  if (!data || data.members.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="User Management" />
        <EmptyState
          icon={UsersIcon}
          title="No team members"
          description="Team members will appear here once they are added to this team."
        />
      </div>
    )
  }

  const capabilities = data.capabilities
  const assignableRoles = data.mutation_options?.assignable_roles ?? []
  const canMutateRoles =
    capabilities.can_assign_roles || capabilities.can_revoke_roles
  const activeMembers = data.members.filter(
    (member) => member.status === "active",
  )
  const selectedManageRoleUserId = activeMembers.some(
    (member) => member.user_id === selectedUserId,
  )
    ? selectedUserId
    : (activeMembers[0]?.user_id ?? "")

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(178,250,180,0.08),transparent_28%),radial-gradient(circle_at_top_right,rgba(178,250,180,0.05),transparent_22%)]">
      <PageHeader title="User Management">
        <Link
          href="/audit-logs"
          className="inline-flex h-9 items-center gap-2 border border-border px-3 text-sm text-foreground transition-colors hover:bg-brand/10"
        >
          <ArrowSquareOutIcon className="size-3.5" weight="light" />
          Audit log
        </Link>
      </PageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
          <div className="flex flex-col gap-2">
            <p className="text-2xl font-medium tracking-tight text-foreground">
              Manage team members, invitations, and role assignments.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <SummaryCard
              icon={UsersIcon}
              value={counts.active}
              label="Active members"
              description={`${counts.active} seat${counts.active === 1 ? "" : "s"} in use`}
              iconTone="bg-emerald-500/10 text-emerald-300"
            />
            <SummaryCard
              icon={ShieldCheckIcon}
              value={counts.invited}
              label="Invited"
              description={`${counts.invited} pending invite${counts.invited === 1 ? "" : "s"}`}
              iconTone="bg-amber-500/10 text-amber-300"
            />
            <SummaryCard
              icon={UserMinusIcon}
              value={counts.inactive}
              label="Inactive"
              description={`${counts.inactive} deactivated member${counts.inactive === 1 ? "" : "s"}`}
              iconTone="bg-muted/30 text-muted"
            />
          </div>

          {capabilities.can_invite_members && <InviteMemberCard />}

          <section className="border border-border/80 bg-background/75 p-6 backdrop-blur-sm">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-lg font-medium text-foreground">
                  Team members
                </p>
                <p className="mt-1 text-sm text-muted">
                  Search members and switch between active, invitation, and
                  inactive views.
                </p>
              </div>
              <div className="w-full lg:w-96">
                <Field label="Search by name or email">
                  <Input
                    value={memberSearch}
                    onChange={(event) => setMemberSearch(event.target.value)}
                    placeholder="Search by name or email..."
                  />
                </Field>
              </div>
            </div>

            <MemberTabs
              members={data.members}
              onManageRoles={setSelectedUserId}
              showManageRoles={capabilities.can_view_role_assignments}
              search={memberSearch}
            />

            {!capabilities.can_invite_members && (
              <p className="mt-4 text-sm text-muted">
                You have read-only access to team membership.
              </p>
            )}
          </section>

          {capabilities.can_view_role_assignments && (
            <section className="border border-border/80 bg-background/75 p-6 backdrop-blur-sm">
              <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
                <div className="space-y-3">
                  <p className="text-lg font-medium text-foreground">
                    Role assignments
                  </p>
                  <p className="text-sm leading-relaxed text-muted">
                    Manage roles and permissions for team members. Changes are
                    enforced by backend policy.
                  </p>
                  <div className="border border-border bg-muted/20 px-4 py-3 text-sm text-muted">
                    Changes take effect immediately.
                  </div>
                  {!canMutateRoles && (
                    <p className="text-sm text-muted">
                      You can view role assignments, but cannot change them.
                    </p>
                  )}
                </div>

                <div className="space-y-5">
                  {capabilities.can_assign_roles && (
                    <AssignRoleForm
                      members={data.members}
                      roles={assignableRoles}
                      selectedUserId={selectedManageRoleUserId}
                      onSelectedUserIdChange={setSelectedUserId}
                    />
                  )}
                  <ActiveAssignmentRows
                    assignments={data.assignments}
                    canRevoke={capabilities.can_revoke_roles}
                  />
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
