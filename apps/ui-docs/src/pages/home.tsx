import { categories, getByCategory } from "../registry"
import { ComponentGrid } from "../components/component-grid"

export function Home() {
  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground">Superserve UI</h1>
        <p className="text-muted mt-1">
          Component library built with React, Radix UI, and Tailwind CSS.
        </p>
      </div>
      <div className="space-y-8">
        {categories.map((cat) => (
          <ComponentGrid
            key={cat}
            title={cat}
            components={getByCategory(cat)}
          />
        ))}
      </div>
    </div>
  )
}
