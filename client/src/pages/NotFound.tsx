import { Link } from "react-router-dom"

import { PageShell, SiteHeader } from "@/components/layout/Shell"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <PageShell className="flex flex-col">
      <SiteHeader />
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
        <p className="text-sm text-muted-foreground">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Page not found</h1>
        <Button asChild variant="outline" className="mt-8">
          <Link to="/">Back to Haul</Link>
        </Button>
      </main>
    </PageShell>
  )
}
