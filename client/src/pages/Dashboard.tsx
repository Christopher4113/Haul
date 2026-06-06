import { Link } from "react-router-dom"
import { ArrowRight, MapPinned, Route } from "lucide-react"

import { AppShell } from "@/components/layout/Shell"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/hooks/use-auth"

export default function Dashboard() {
  const { user } = useAuth()

  return (
    <AppShell
      title={`Hey, ${user?.name?.split(" ")[0] ?? "there"}`}
      description="Your errand runs live here. Start a new batch or jump back into the app."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Route className="size-4 text-primary" />
              Start a run
            </CardTitle>
            <CardDescription>
              Paste errands, geocode stops, and stream an optimized route to the map.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/app">
                Open app
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPinned className="size-4 text-primary" />
              Account
            </CardTitle>
            <CardDescription>Signed in as {user?.email}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Runs, saved stops, and route history will show up here as the app grows.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
