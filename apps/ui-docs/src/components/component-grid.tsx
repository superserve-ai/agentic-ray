import { Link } from "react-router"
import { Card, CardHeader, CardTitle, CardDescription } from "@superserve/ui"
import type { ComponentMeta } from "../registry/types"

export function ComponentGrid({
  title,
  components,
}: {
  title: string
  components: ComponentMeta[]
}) {
  return (
    <div>
      <h2 className="text-xs font-mono uppercase tracking-wider text-muted mb-3">
        {title}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {components.map((comp) => (
          <Link key={comp.slug} to={`/components/${comp.slug}`} className="outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
            <Card className="h-full transition-colors hover:border-primary-light cursor-pointer">
              <CardHeader className="pb-5">
                <CardTitle className="text-sm">{comp.name}</CardTitle>
                <CardDescription className="text-xs">
                  {comp.description}
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
