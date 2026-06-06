import { Link } from "react-router-dom"

import { useAuth } from "@/hooks/use-auth"
import { cn } from "@/lib/utils"

export function PageShell({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("min-h-svh bg-shell text-foreground", className)}>
      {children}
    </div>
  )
}

export function SiteHeader() {
  const { user } = useAuth()

  return (
    <header className="border-b border-border/70 bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
        <Link to="/" className="text-sm font-semibold tracking-tight">
          Haul
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          {user ? (
            <>
              <Link to="/dashboard" className="text-muted-foreground hover:text-foreground">
                Dashboard
              </Link>
              <Link to="/app" className="text-muted-foreground hover:text-foreground">
                App
              </Link>
            </>
          ) : (
            <>
              <Link to="/login" className="text-muted-foreground hover:text-foreground">
                Sign in
              </Link>
              <Link
                to="/signup"
                className="rounded-full bg-primary px-3.5 py-1.5 text-primary-foreground hover:opacity-90"
              >
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <PageShell className="flex flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
        {children}
      </main>
    </PageShell>
  )
}

export function AppShell({
  children,
  title,
  description,
}: {
  children: React.ReactNode
  title?: string
  description?: string
}) {
  const { user, logout } = useAuth()

  return (
    <PageShell className="flex flex-col">
      <header className="border-b border-border/70 bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <Link to="/dashboard" className="text-sm font-semibold tracking-tight">
            Haul
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <span className="hidden text-muted-foreground sm:inline">{user?.name}</span>
            <button
              type="button"
              onClick={logout}
              className="text-muted-foreground hover:text-foreground"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-6 py-10">
        {(title || description) && (
          <div className="mb-8">
            {title && <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>}
            {description && (
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>
            )}
          </div>
        )}
        {children}
      </main>
    </PageShell>
  )
}
