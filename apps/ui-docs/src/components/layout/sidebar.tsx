import { useState } from "react"
import { Link, useParams } from "react-router"
import { Button } from "@superserve/ui"
import { Menu, X } from "lucide-react"
import { categories, getByCategory } from "../../registry"

function Logo() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
    >
      <rect width="18" height="18" fill="currentColor" />
      <text
        x="4"
        y="14"
        fill="var(--color-background)"
        fontSize="13"
        fontWeight="700"
        fontFamily="var(--sans-font), system-ui, sans-serif"
      >
        S
      </text>
    </svg>
  )
}

export function Sidebar() {
  const { slug } = useParams()
  const [open, setOpen] = useState(false)

  const nav = (
    <>
      <Link
        to="/"
        className="flex items-center gap-2.5 mb-6"
        onClick={() => setOpen(false)}
      >
        <Logo />
        <span className="text-sm font-semibold text-foreground">
          Superserve UI
        </span>
      </Link>
      <nav className="space-y-6">
        {categories.map((cat) => (
          <div key={cat}>
            <p className="text-xs font-mono uppercase tracking-widest text-muted mb-2">
              {cat}
            </p>
            <div className="border-l border-border/50 ml-px space-y-px">
              {getByCategory(cat).map((item) => {
                const isActive = slug === item.slug
                return (
                  <Link
                    key={item.slug}
                    to={`/components/${item.slug}`}
                    onClick={() => setOpen(false)}
                    className={`block py-1 pl-3 text-sm transition-colors -ml-px border-l ${
                      isActive
                        ? "border-foreground text-foreground font-medium"
                        : "border-transparent text-muted hover:text-foreground hover:border-border"
                    }`}
                  >
                    {item.name}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>
    </>
  )

  return (
    <>
      {/* Mobile toggle */}
      <div className="md:hidden fixed top-3 left-3 z-50">
        <Button variant="outline" size="icon-sm" onClick={() => setOpen(!open)}>
          {open ? <X className="size-4" /> : <Menu className="size-4" />}
        </Button>
      </div>

      {/* Mobile overlay */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/30"
          onClick={() => setOpen(false)}
          onKeyDown={() => {}}
          role="presentation"
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`md:hidden fixed inset-y-0 left-0 z-40 w-56 bg-background border-r border-border overflow-y-auto p-5 pt-14 transition-transform ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {nav}
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden md:block w-56 shrink-0 border-r border-border overflow-y-auto p-5">
        {nav}
      </aside>
    </>
  )
}
