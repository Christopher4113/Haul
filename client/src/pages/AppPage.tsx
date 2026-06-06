import { AppShell } from "@/components/layout/Shell"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export default function AppPage() {
  return (
    <AppShell
      title="Start a run"
      description="Paste errands, geocode stops, and stream an optimized route to the map."
    >
      <Card>
        <CardHeader>
          <CardTitle>Run workspace</CardTitle>
          <CardDescription>
            The errand batching flow will live here — paste stops, watch clustering, and follow the live route map.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-dashed border-border/80 bg-muted/30 px-6 py-16 text-center text-sm text-muted-foreground">
            Map and optimizer UI coming next.
          </div>
        </CardContent>
      </Card>
    </AppShell>
  )
}
