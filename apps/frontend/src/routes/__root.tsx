import { createRootRoute, Outlet, useLocation, useRouter } from '@tanstack/react-router'
import { useRef, useEffect } from 'react'
import LoadingBar, { LoadingBarRef } from 'react-top-loading-bar'
import { AuthProvider, useAuth } from '@/lib/auth/AuthContext'
import { DashboardLayout } from '@/components/DashboardLayout'
import { Toaster } from '@/components/ui/toaster'

export const Route = createRootRoute({
  component: () => (
    <AuthProvider>
      <RootLayout />
    </AuthProvider>
  ),
})

function RootLayout() {
  const { isAuthenticated } = useAuth()
  const location = useLocation()
  const router = useRouter()
  const loadingBarRef = useRef<LoadingBarRef>(null)

  // Listen to router events for loading bar
  useEffect(() => {
    const unsubscribe = router.subscribe('onBeforeLoad', () => {
      loadingBarRef.current?.continuousStart()
    })

    return () => unsubscribe()
  }, [router])

  useEffect(() => {
    loadingBarRef.current?.complete()
  }, [location.pathname])

  // Pages that should not use the dashboard layout
  const isAuthPage =
    location.pathname === '/login' ||
    location.pathname.startsWith('/auth/callback')

  // If authenticated and not on auth page, use dashboard layout
  if (isAuthenticated && !isAuthPage) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <LoadingBar color="#FF7700" height={3} ref={loadingBarRef} />
        <DashboardLayout>
          <Outlet />
        </DashboardLayout>
        <Toaster />
      </div>
    )
  }

  // For auth pages or when not authenticated, render without sidebar
  return (
    <div className="min-h-screen bg-background text-foreground">
      <LoadingBar color="#FF7700" height={3} ref={loadingBarRef} />
      <Outlet />
      <Toaster />
    </div>
  )
}
