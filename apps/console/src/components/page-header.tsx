interface PageHeaderProps {
  title: string
  children?: React.ReactNode
}

export function PageHeader({ title, children }: PageHeaderProps) {
  return (
    <div className="flex min-h-14 shrink-0 flex-col justify-center gap-1 border-b border-border bg-background/70 px-4 py-2 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <h1 className="text-lg font-medium tracking-tight text-foreground">
        {title}
      </h1>
      {children}
    </div>
  )
}
