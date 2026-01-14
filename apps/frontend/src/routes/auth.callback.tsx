import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useAuth } from '@/lib/auth/AuthContext'
import { useEffect, useState } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'

export const Route = createFileRoute('/auth/callback')({
  component: AuthCallback,
})

function AuthCallback() {
  const { refetch } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState<'loading' | 'error'>('loading')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    async function handleCallback() {
      try {
        // Check for error in URL params
        const params = new URLSearchParams(window.location.search)
        const error = params.get('error')

        if (error) {
          setStatus('error')
          setErrorMessage(getErrorMessage(error))

          // Redirect to login after error
          setTimeout(() => {
            navigate({ to: '/login' })
          }, 3000)
          return
        }

        // The backend already set the httpOnly cookie
        // Just refetch user data and redirect immediately
        await refetch()
        navigate({ to: '/' })
      } catch (error: any) {
        setStatus('error')
        setErrorMessage(error.message || 'Authentication failed')

        // Redirect to login after error
        setTimeout(() => {
          navigate({ to: '/login' })
        }, 3000)
      }
    }

    handleCallback()
  }, [refetch, navigate])

  function getErrorMessage(error: string): string {
    switch (error) {
      case 'missing_params':
        return 'Missing required parameters'
      case 'invalid_state':
        return 'Invalid authentication state. Please try again.'
      case 'signups_disabled':
        return 'New signups are currently disabled'
      case 'auth_failed':
        return 'Authentication failed. Please try again.'
      default:
        return 'An error occurred during authentication'
    }
  }

  // Only show UI for loading and error states
  // Success redirects immediately without showing anything
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        {status === 'loading' && (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto" />
        )}

        {status === 'error' && (
          <div className="space-y-3">
            <div className="flex items-center justify-center w-10 h-10 mx-auto bg-destructive/10 border border-destructive/20">
              <AlertCircle className="w-5 h-5 text-destructive" />
            </div>
            <p className="text-[13px] text-foreground font-medium">
              Authentication Failed
            </p>
            <p className="text-[12px] text-muted-foreground">{errorMessage}</p>
            <p className="text-[11px] text-muted-foreground/60">
              Redirecting to login...
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
