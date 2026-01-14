import { useEffect, useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Shield, Users, Database, LogOut, User } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth/AuthContext'

interface SettingsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsSheet({ open, onOpenChange }: SettingsSheetProps) {
  const { user, isAdmin, logout } = useAuth()
  const [allowSignups, setAllowSignups] = useState(false)
  const [loading, setLoading] = useState(false)
  const [isFetching, setIsFetching] = useState(true)

  const getInitials = (email: string) => {
    return email
      .split('@')[0]
      .split('.')
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  useEffect(() => {
    if (open) {
      loadSettings()
    }
  }, [open])

  async function loadSettings() {
    setIsFetching(true)
    try {
      const res = await api.get<{ key: string; value: boolean }>('/settings/auth.allowSignups')
      if (res.success && res.data) {
        setAllowSignups(res.data.value)
      }
    } catch {
      // Settings may not be accessible for non-admin users
    }
    setIsFetching(false)
  }

  async function toggleSignups() {
    setLoading(true)
    const newValue = !allowSignups

    const res = await api.put('/settings/auth.allowSignups', {
      value: newValue,
    })

    if (res.success) {
      setAllowSignups(newValue)
    }

    setLoading(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* User Info */}
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10 rounded-sm">
                <AvatarImage src={user?.avatarUrl || undefined} className="rounded-sm" />
                <AvatarFallback className="bg-primary/10 text-primary text-sm rounded-sm">
                  {user?.email ? getInitials(user.email) : <User className="h-4 w-4" />}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="text-sm font-medium">{user?.name || user?.email?.split('@')[0]}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={logout}
              className="text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </Button>
          </div>

          <Separator />

          {isFetching ? (
            <div className="space-y-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : (
            <>
              {isAdmin && (
                <>
                  {/* Authentication Settings */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Shield className="h-4 w-4 text-primary" />
                      Authentication
                    </div>
                    <div className="flex items-center justify-between rounded-lg border p-3">
                      <div className="flex-1 space-y-0.5">
                        <Label htmlFor="allow-signups" className="text-sm font-medium">
                          Allow New Signups
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Enable or disable new user registration
                        </p>
                      </div>
                      <Switch
                        id="allow-signups"
                        checked={allowSignups}
                        onCheckedChange={toggleSignups}
                        disabled={loading}
                      />
                    </div>
                  </div>

                  <Separator />

                  {/* User Management */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <Users className="h-4 w-4" />
                      User Management
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Coming soon</p>
                    </div>
                  </div>

                  <Separator />

                  {/* Backup Configuration */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <Database className="h-4 w-4" />
                      Backup Configuration
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Coming soon</p>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
