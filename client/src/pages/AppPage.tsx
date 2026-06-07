import { Loader2, X } from "lucide-react"
import { useRef, useState } from "react"
import { Link, Navigate } from "react-router-dom"

import { ErrandMap } from "@/components/app/ErrandMap"
import { PageShell } from "@/components/layout/Shell"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/hooks/use-auth"
import { api, tokenStorage, type Errand } from "@/lib/api"
import { getAuthErrorMessage } from "@/lib/errors"

export default function AppPage() {
  const { user, token, logout } = useAuth()
  const sessionId = useRef(crypto.randomUUID()).current

  const [origin, setOrigin] = useState("")
  const [stopName, setStopName] = useState("")
  const [stopAddress, setStopAddress] = useState("")
  const [errands, setErrands] = useState<Errand[]>([])
  const [adding, setAdding] = useState(false)
  const [optimizing, setOptimizing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!tokenStorage.get()) {
    return <Navigate to="/login" replace state={{ from: "/app" }} />
  }

  async function handleAddStop() {
    if (!token || !stopName.trim() || !stopAddress.trim()) {
      return
    }

    setAdding(true)
    setError(null)

    try {
      const created = await api.addErrand(token, {
        session_id: sessionId,
        name: stopName.trim(),
        address: stopAddress.trim(),
      })

      setErrands((current) => [
        ...current,
        {
          id: created.id,
          name: created.name,
          address: created.address,
          lat: created.lat,
          lng: created.lng,
          clusterId: null,
        },
      ])
      setStopName("")
      setStopAddress("")
    } catch (err) {
      setError(getAuthErrorMessage(err))
    } finally {
      setAdding(false)
    }
  }

  function handleRemoveStop(id: string) {
    setErrands((current) => current.filter((errand) => errand.id !== id))
  }

  async function handleOptimize() {
    if (!token || errands.length < 2) {
      return
    }

    setOptimizing(true)
    setError(null)

    try {
      const response = await api.optimizeRoute(token, sessionId)
      const reader = response.body?.getReader()

      if (reader) {
        while (true) {
          const { done } = await reader.read()
          if (done) {
            break
          }
        }
      }
    } catch (err) {
      setError(getAuthErrorMessage(err))
    } finally {
      setOptimizing(false)
    }
  }

  function handleStopKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && stopName.trim() && stopAddress.trim() && !adding) {
      event.preventDefault()
      void handleAddStop()
    }
  }

  return (
    <PageShell className="flex h-svh flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border/70 bg-background/80 backdrop-blur-sm">
        <div className="flex h-14 items-center justify-between px-4 sm:px-6">
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

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="flex w-full shrink-0 flex-col border-b border-border/70 bg-background/70 lg:w-[min(100%,420px)] lg:border-r lg:border-b-0">
          <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-5">
            <div className="mb-5">
              <h1 className="text-lg font-semibold tracking-tight">Start a run</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Add stops, then optimize your route on the map.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="origin" className="text-xs text-muted-foreground">
                Origin
              </Label>
              <Input
                id="origin"
                placeholder="Home address"
                value={origin}
                onChange={(event) => setOrigin(event.target.value)}
              />
            </div>

            <div className="mt-5 space-y-3">
              <div className="space-y-2">
                <Label htmlFor="stop-name">Stop name</Label>
                <Input
                  id="stop-name"
                  placeholder="e.g. Grocery store"
                  value={stopName}
                  onChange={(event) => setStopName(event.target.value)}
                  onKeyDown={handleStopKeyDown}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="stop-address">Address</Label>
                <Input
                  id="stop-address"
                  placeholder="123 Main St, Toronto"
                  value={stopAddress}
                  onChange={(event) => setStopAddress(event.target.value)}
                  onKeyDown={handleStopKeyDown}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={adding || !stopName.trim() || !stopAddress.trim()}
                onClick={() => void handleAddStop()}
              >
                {adding ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Adding…
                  </>
                ) : (
                  "Add stop"
                )}
              </Button>
            </div>

            {errands.length > 0 && (
              <ol className="mt-5 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {errands.map((errand, index) => (
                  <li key={errand.id}>
                    <Card className="border-border/70 bg-card/80 py-0">
                      <CardContent className="flex items-start gap-3 p-3">
                        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{errand.name}</p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {errand.address}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Remove ${errand.name}`}
                          onClick={() => handleRemoveStop(errand.id)}
                        >
                          <X />
                        </Button>
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ol>
            )}

            {errands.length === 0 && (
              <div className="mt-5 flex flex-1 items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
                Add at least two stops to optimize a route.
              </div>
            )}

            {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

            <div className="mt-4 shrink-0 pt-2">
              <Button
                type="button"
                className="h-10 w-full bg-amber-400 text-amber-950 hover:bg-amber-500 disabled:bg-amber-400/50 disabled:text-amber-950/60"
                disabled={errands.length < 2 || optimizing}
                onClick={() => void handleOptimize()}
              >
                {optimizing ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Optimizing route…
                  </>
                ) : (
                  "Optimize route"
                )}
              </Button>
            </div>
          </div>
        </aside>

        <div className="relative min-h-[280px] flex-1 lg:min-h-0">
          <ErrandMap errands={errands} />
        </div>
      </div>
    </PageShell>
  )
}
