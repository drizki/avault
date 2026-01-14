import { useState, useEffect } from 'react'
import { Panel, PanelHeader, PanelTitle, PanelContent } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog'
import { CredentialFormSheet } from '@/components/CredentialFormSheet'
import {
  Activity,
  Database,
  Server,
  HardDrive,
  Key,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Plus,
  MoreVertical,
  Trash2,
} from 'lucide-react'
import { api } from '@/lib/api'
import type { SystemHealth } from '@/hooks/useDashboardStream'
import { cn } from '@/lib/utils'

type StorageProvider =
  | 'google_drive_shared'
  | 'google_drive_my_drive'
  | 'google_cloud_storage'
  | 's3'
  | 'cloudflare_r2'
  | 'digitalocean_spaces'

interface SystemHealthPanelProps {
  workerStatus: string
}

interface Credential {
  id: string
  name: string
  provider: string
  status: string
}

export function SystemHealthPanel({ workerStatus: liveWorkerStatus }: SystemHealthPanelProps) {
  const [health, setHealth] = useState<SystemHealth | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleteCredential, setDeleteCredential] = useState<Credential | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isCredentialFormOpen, setIsCredentialFormOpen] = useState(false)
  const [selectedCredentialProvider, setSelectedCredentialProvider] = useState<
    StorageProvider | undefined
  >()

  async function fetchHealth() {
    try {
      const response = await api.get<SystemHealth>('/dashboard/health')
      if (response.success && response.data) {
        setHealth(response.data)
      }
    } catch (error) {
      console.error('Failed to fetch health:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchHealth()
    const interval = setInterval(fetchHealth, 30000)
    return () => clearInterval(interval)
  }, [])

  function handleAddCredential(provider?: StorageProvider) {
    setSelectedCredentialProvider(provider)
    setIsCredentialFormOpen(true)
  }

  async function handleDeleteCredential() {
    if (!deleteCredential) return
    setIsDeleting(true)
    try {
      const response = await api.delete(`/credentials/${deleteCredential.id}`)
      if (response.success) {
        fetchHealth()
        setDeleteCredential(null)
      }
    } catch (error) {
      console.error('Failed to delete credential:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  // Use live worker status if available
  const workerStatus =
    liveWorkerStatus !== 'unknown' ? liveWorkerStatus : health?.services.worker.status

  const getStatusIcon = (status: string | undefined) => {
    switch (status) {
      case 'up':
      case 'connected':
        return <CheckCircle2 className="h-3 w-3 text-status-success" />
      case 'down':
      case 'expired':
        return <XCircle className="h-3 w-3 text-status-error" />
      case 'expiring':
      case 'degraded':
        return <AlertCircle className="h-3 w-3 text-status-warning" />
      default:
        return <AlertCircle className="h-3 w-3 text-muted-foreground" />
    }
  }

  const getStatusColor = (status: string | undefined) => {
    switch (status) {
      case 'up':
      case 'connected':
        return 'text-status-success'
      case 'down':
      case 'expired':
        return 'text-status-error'
      case 'expiring':
      case 'degraded':
        return 'text-status-warning'
      default:
        return 'text-muted-foreground'
    }
  }

  const getOverallBadge = (overall: string | undefined) => {
    switch (overall) {
      case 'healthy':
        return (
          <Badge className="bg-status-success/20 text-status-success h-5 text-[10px]">
            Healthy
          </Badge>
        )
      case 'degraded':
        return (
          <Badge className="bg-status-warning/20 text-status-warning h-5 text-[10px]">
            Degraded
          </Badge>
        )
      case 'critical':
        return (
          <Badge className="bg-status-error/20 text-status-error h-5 text-[10px]">Critical</Badge>
        )
      default:
        return (
          <Badge variant="secondary" className="h-5 text-[10px]">
            Unknown
          </Badge>
        )
    }
  }

  function getProviderIcon(provider: string) {
    const iconMap: Record<string, { src: string; alt: string }> = {
      google_drive: { src: '/icons/google_drive.svg', alt: 'Google Drive' },
      google_drive_shared: { src: '/icons/google_drive.svg', alt: 'Google Drive' },
      google_drive_my_drive: { src: '/icons/google_drive.svg', alt: 'Google Drive' },
      google_cloud_storage: { src: '/icons/google_cloud_storage.svg', alt: 'Google Cloud Storage' },
      s3: { src: '/icons/amazon_s3.svg', alt: 'Amazon S3' },
      cloudflare_r2: { src: '/icons/cloudflare_r2.svg', alt: 'Cloudflare R2' },
      digitalocean_spaces: { src: '/icons/digitalocean_spaces.svg', alt: 'DigitalOcean Spaces' },
    }

    const icon = iconMap[provider]
    if (icon) {
      return <img src={icon.src} alt={icon.alt} className="w-4 h-4 shrink-0" />
    }
    return <Key className="h-4 w-4 text-muted-foreground shrink-0" />
  }

  return (
    <>
      <Panel className="flex flex-col h-full">
        <PanelHeader actions={health ? getOverallBadge(health.overall) : null}>
          <PanelTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            System Health
          </PanelTitle>
        </PanelHeader>
        <PanelContent className="p-0 flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <div className="p-3 space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {/* Database */}
              <div className="flex items-center justify-between p-3">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Database</span>
                </div>
                <div className="flex items-center gap-2">
                  {getStatusIcon(health?.services.database.status)}
                  <span
                    className={cn(
                      'text-xs font-mono',
                      getStatusColor(health?.services.database.status)
                    )}
                  >
                    {health?.services.database.latencyMs}ms
                  </span>
                </div>
              </div>

              {/* Redis */}
              <div className="flex items-center justify-between p-3">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Redis</span>
                </div>
                <div className="flex items-center gap-2">
                  {getStatusIcon(health?.services.redis.status)}
                  <span
                    className={cn(
                      'text-xs font-mono',
                      getStatusColor(health?.services.redis.status)
                    )}
                  >
                    {health?.services.redis.latencyMs}ms
                  </span>
                  {health?.services.redis.memoryUsed && (
                    <span className="text-xs text-muted-foreground">
                      ({health.services.redis.memoryUsed})
                    </span>
                  )}
                </div>
              </div>

              {/* Worker */}
              <div className="flex items-center justify-between p-3">
                <div className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Worker</span>
                </div>
                <div className="flex items-center gap-2">
                  {getStatusIcon(workerStatus)}
                  <span className={cn('text-xs capitalize', getStatusColor(workerStatus))}>
                    {workerStatus || 'unknown'}
                  </span>
                  {health?.services.worker.activeJobs !== undefined &&
                    health.services.worker.activeJobs > 0 && (
                      <Badge variant="secondary" className="h-4 text-[9px]">
                        {health.services.worker.activeJobs} active
                      </Badge>
                    )}
                </div>
              </div>

              {/* Credentials Section */}
              <div className="px-3 py-2 bg-secondary/30 flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Credentials
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]">
                      <Plus className="h-3 w-3 mr-1" />
                      Add
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => handleAddCredential('google_drive_shared')}
                      className="cursor-pointer text-xs"
                    >
                      <img
                        src="/icons/google_drive.svg"
                        alt="Google Drive"
                        className="w-4 h-4 mr-2"
                      />
                      Google Drive (Shared)
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleAddCredential('google_drive_my_drive')}
                      className="cursor-pointer text-xs"
                    >
                      <img
                        src="/icons/google_drive.svg"
                        alt="Google Drive"
                        className="w-4 h-4 mr-2"
                      />
                      Google Drive (My Drive)
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleAddCredential('google_cloud_storage')}
                      className="cursor-pointer text-xs"
                    >
                      <img
                        src="/icons/google_cloud_storage.svg"
                        alt="Google Cloud Storage"
                        className="w-4 h-4 mr-2"
                      />
                      Google Cloud Storage
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleAddCredential('s3')}
                      className="cursor-pointer text-xs"
                    >
                      <img src="/icons/amazon_s3.svg" alt="Amazon S3" className="w-4 h-4 mr-2" />
                      Amazon S3
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleAddCredential('cloudflare_r2')}
                      className="cursor-pointer text-xs"
                    >
                      <img
                        src="/icons/cloudflare_r2.svg"
                        alt="Cloudflare R2"
                        className="w-4 h-4 mr-2"
                      />
                      Cloudflare R2
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleAddCredential('digitalocean_spaces')}
                      className="cursor-pointer text-xs"
                    >
                      <img
                        src="/icons/digitalocean_spaces.svg"
                        alt="DigitalOcean Spaces"
                        className="w-4 h-4 mr-2"
                      />
                      DigitalOcean Spaces
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {health?.services.storage && health.services.storage.length > 0 ? (
                health.services.storage.map((storage) => (
                  <div key={storage.credentialId} className="flex items-center justify-between p-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {getProviderIcon(storage.provider)}
                      <span className="text-sm truncate">{storage.name}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {getStatusIcon(storage.status)}
                      <span className={cn('text-xs capitalize', getStatusColor(storage.status))}>
                        {storage.status}
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                            <MoreVertical className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() =>
                              setDeleteCredential({
                                id: storage.credentialId,
                                name: storage.name,
                                provider: storage.provider,
                                status: storage.status,
                              })
                            }
                            className="cursor-pointer text-xs"
                          >
                            <Trash2 className="mr-2 h-3 w-3" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex items-center justify-center p-4 text-xs text-muted-foreground">
                  No credentials added
                </div>
              )}
            </div>
          )}
        </PanelContent>
      </Panel>

      <DeleteConfirmDialog
        open={!!deleteCredential}
        onOpenChange={(open) => !open && setDeleteCredential(null)}
        onConfirm={handleDeleteCredential}
        isDeleting={isDeleting}
        title="Delete Credential?"
        description="This will permanently delete this credential. Any backup jobs using this credential will no longer work."
        itemName={deleteCredential?.name}
      />

      <CredentialFormSheet
        open={isCredentialFormOpen}
        onOpenChange={setIsCredentialFormOpen}
        onSuccess={fetchHealth}
        initialProvider={selectedCredentialProvider}
      />
    </>
  )
}
