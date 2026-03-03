import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@superserve/ui"
import type { PropDef } from "../registry/types"

export function PropsTable({ props }: { props: PropDef[] }) {
  if (props.length === 0) return null

  const hasSubComponents = props.some((p) => p.component)

  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground mb-3">Props</h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Prop</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Default</TableHead>
            <TableHead>Description</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.map((prop) => (
            <TableRow key={`${prop.component ?? ""}.${prop.name}`}>
              <TableCell>
                {hasSubComponents && prop.component && (
                  <span className="text-xs text-muted font-mono">
                    {prop.component}.
                  </span>
                )}
                <code className="font-mono text-xs text-foreground">{prop.name}</code>
                {prop.required && (
                  <span className="text-destructive ml-1">*</span>
                )}
              </TableCell>
              <TableCell>
                <Badge variant="muted" className="font-mono text-[11px]">
                  {prop.type}
                </Badge>
              </TableCell>
              <TableCell>
                {prop.default ? (
                  <code className="font-mono text-xs text-muted">{prop.default}</code>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </TableCell>
              <TableCell className="text-muted">{prop.description}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
