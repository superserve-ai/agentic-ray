import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export const tableMeta: ComponentMeta = {
  slug: "table",
  name: "Table",
  description: "A structured data table with header, body, and rows.",
  category: "Data Display",
  source: "components/table.tsx",
  props: [],
  examples: [
    {
      title: "Default",
      preview: (
        <div className="max-w-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>Alice</TableCell>
                <TableCell><Badge variant="success">Active</Badge></TableCell>
                <TableCell>Admin</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Bob</TableCell>
                <TableCell><Badge variant="warning">Pending</Badge></TableCell>
                <TableCell>Editor</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Charlie</TableCell>
                <TableCell><Badge variant="muted">Inactive</Badge></TableCell>
                <TableCell>Viewer</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      ),
      code: `<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Name</TableHead>
      <TableHead>Status</TableHead>
      <TableHead>Role</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell>Alice</TableCell>
      <TableCell><Badge variant="success">Active</Badge></TableCell>
      <TableCell>Admin</TableCell>
    </TableRow>
    <TableRow>
      <TableCell>Bob</TableCell>
      <TableCell><Badge variant="warning">Pending</Badge></TableCell>
      <TableCell>Editor</TableCell>
    </TableRow>
    <TableRow>
      <TableCell>Charlie</TableCell>
      <TableCell><Badge variant="muted">Inactive</Badge></TableCell>
      <TableCell>Viewer</TableCell>
    </TableRow>
  </TableBody>
</Table>`,
    },
  ],
}
