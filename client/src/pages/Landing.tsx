import { Clock, Layers, Route } from "lucide-react"
import { Link } from "react-router-dom"

import { PageShell, SiteHeader } from "@/components/layout/Shell"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useAuth } from "@/hooks/use-auth"

const features = [
  {
    icon: Layers,
    label: "Spatial clustering",
    description: "Groups stops by geography, not just distance.",
  },
  {
    icon: Clock,
    label: "Store hours aware",
    description: "Skips closed stops, reorders around open windows.",
  },
  {
    icon: Route,
    label: "Live route streaming",
    description: "Optimization result streams to the map in real time.",
  },
] as const

export default function Landing() {
  const { user } = useAuth()

  return (
    <PageShell className="flex flex-col">
      <SiteHeader />
      <main className="flex flex-1 flex-col">
        <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-6 py-20 text-center md:py-28">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
            Personal errand routing
          </p>
          <h1 className="mt-4 text-5xl font-semibold tracking-tight text-foreground sm:text-6xl md:text-7xl">
            Haul
          </h1>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-muted-foreground sm:text-lg">
            Paste errands, geocode stops, cluster by geography, and route around store hours.
          </p>
          <Button asChild size="lg" className="mt-10 h-11 rounded-full px-7">
            <Link to={user ? "/app" : "/signup"}>
              {user ? "Start a run" : "Get started"}
            </Link>
          </Button>
        </section>

        <section className="border-t border-border/70 px-6 py-16">
          <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-3">
            {features.map(({ icon: Icon, label, description }) => (
              <Card key={label} className="border-border/70 bg-background/70">
                <CardContent className="p-6">
                  <Icon className="size-5 text-primary" strokeWidth={1.5} />
                  <h2 className="mt-4 text-sm font-medium">{label}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border/70 px-6 py-8">
        <p className="text-center text-sm text-muted-foreground">
          Haul · {new Date().getFullYear()}
        </p>
      </footer>
    </PageShell>
  )
}
