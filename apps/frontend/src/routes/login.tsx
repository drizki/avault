import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAuth } from '@/lib/auth/AuthContext'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Logo } from '@/components/Logo'
import { Panel, PanelHeader, PanelTitle, PanelContent } from '@/components/ui/panel'
import { Button } from '@/components/ui/button'
import { AlertCircle, Shield } from 'lucide-react'

export const Route = createFileRoute('/login')({
  component: Login,
})

interface SystemStatus {
  initialized: boolean
  allowSignups: boolean
}

function Login() {
  const { login, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const [systemStatus, setSystemStatus] = useState<SystemStatus>({
    initialized: false,
    allowSignups: true,
  })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  // Fetch system status
  useEffect(() => {
    api.get<SystemStatus>('/auth/status').then((res) => {
      if (res.success && res.data) {
        setSystemStatus(res.data)
      }
    })
  }, [])

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate({ to: '/' })
    }
  }, [isAuthenticated, navigate])

  async function handleGoogleLogin() {
    try {
      setIsLoading(true)
      setError('')
      await login()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err) || 'Failed to sign in')
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
      {/* Subtle radial gradient background accent */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,119,0,0.04),transparent_70%)]" />

      {/* Subtle grid pattern overlay */}
      <div
        className="absolute inset-0 opacity-[0.015]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
                           linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)`,
          backgroundSize: '48px 48px',
        }}
      />

      {/* Main content */}
      <div className="w-full max-w-sm space-y-6 p-6 relative z-10">
        {/* Logo */}
        <div className="flex flex-col items-center animate-slide-up-fade">
          <Logo size="lg" />
        </div>

        {/* Error message */}
        {error && (
          <Panel className="border-destructive/50 bg-destructive/5 animate-slide-up-fade animation-delay-50">
            <PanelContent className="flex items-center gap-3 p-3">
              <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
              <span className="text-[13px] text-destructive">{error}</span>
            </PanelContent>
          </Panel>
        )}

        {/* Login panel */}
        <Panel className="animate-slide-up-fade animation-delay-100">
          <PanelHeader>
            <PanelTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              Authentication
            </PanelTitle>
          </PanelHeader>
          <PanelContent className="p-4 space-y-4">
            <Button
              onClick={handleGoogleLogin}
              disabled={isLoading}
              variant="outline"
              className="w-full h-10 border-border bg-secondary/20 hover:bg-primary/10 hover:border-primary/40 hover:text-primary transition-all duration-200 group"
            >
              <svg
                className="w-5 h-5 mr-3 transition-transform duration-200 group-hover:scale-105"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              <span className="font-medium text-[13px]">
                {isLoading ? 'Signing in...' : 'Continue with Google'}
              </span>
            </Button>

            {/* Security indicator */}
            <div className="flex items-center justify-center gap-2 pt-1">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
                OAuth 2.0 Secured
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>
          </PanelContent>
        </Panel>

        {/* Signups disabled notice */}
        {!systemStatus.allowSignups && systemStatus.initialized && (
          <p className="text-[11px] text-muted-foreground text-center animate-slide-up-fade animation-delay-150">
            New signups are currently disabled by the administrator
          </p>
        )}
      </div>
    </div>
  )
}
