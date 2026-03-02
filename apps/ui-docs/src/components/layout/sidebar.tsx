import { Link, useParams } from "react-router"
import { Separator } from "@superserve/ui"
import { categories, getByCategory } from "../../registry"

export function Sidebar() {
  const { slug } = useParams()

  return (
    <aside className="w-56 shrink-0 border-r border-dashed border-border overflow-y-auto p-4">
      <Link to="/" className="block mb-4">
        <p className="text-sm font-semibold text-foreground">Superserve UI</p>
      </Link>
      <Separator className="mb-4" />
      <nav className="space-y-4">
        {categories.map((cat) => (
          <div key={cat}>
            <p className="text-xs font-mono uppercase tracking-wider text-muted mb-1.5 px-3">
              {cat}
            </p>
            <div className="space-y-0.5">
              {getByCategory(cat).map((item) => (
                <Link
                  key={item.slug}
                  to={`/components/${item.slug}`}
                  className={`block w-full text-left px-3 py-1.5 text-sm transition-colors ${
                    slug === item.slug
                      ? "bg-surface-hover text-foreground font-medium"
                      : "text-muted hover:text-foreground hover:bg-surface-hover"
                  }`}
                >
                  {item.name}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  )
}
