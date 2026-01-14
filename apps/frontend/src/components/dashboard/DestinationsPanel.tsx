import { useState, useEffect } from 'react'
import { Panel, PanelHeader, PanelTitle, PanelContent } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DestinationFormSheet } from '@/components/DestinationFormSheet'
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog'
import { HardDrive, Plus, MoreVertical, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'

interface Destination {
  id: string
  name: string
  provider: string
  remoteId: string
  folderPath?: string
  createdAt: string
  credential: {
    id: string
    name: string
    provider: string
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
  return <HardDrive className="w-4 h-4 text-muted-foreground shrink-0" />
}

export function DestinationsPanel() {
  const [destinations, setDestinations] = useState<Destination[]>([])
  const [loading, setLoading] = useState(true)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [deleteDestination, setDeleteDestination] = useState<Destination | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  async function fetchDestinations() {
    try {
      const response = await api.get<Destination[]>('/destinations')
      if (response.success && response.data) {
        setDestinations(response.data)
      }
    } catch (error) {
      console.error('Failed to fetch destinations:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDestinations()
  }, [])

  const handleDelete = async () => {
    if (!deleteDestination) return
    setIsDeleting(true)
    try {
      const response = await api.delete(`/destinations/${deleteDestination.id}`)
      if (response.success) {
        setDestinations(destinations.filter((d) => d.id !== deleteDestination.id))
        setDeleteDestination(null)
      }
    } catch (error) {
      console.error('Failed to delete destination:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleOpenDelete = (dest: Destination, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeleteDestination(dest)
  }

  return (
    <>
      <Panel className="flex flex-col h-full">
        <PanelHeader
          actions={
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() => setIsFormOpen(true)}
            >
              <Plus className="h-3 w-3 mr-1" />
              New
            </Button>
          }
        >
          <PanelTitle className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-muted-foreground" />
            Destinations
          </PanelTitle>
        </PanelHeader>
        <PanelContent className="p-0 flex-1 min-h-0">
          {loading ? (
            <div className="p-3 space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : destinations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-4">
              <HardDrive className="h-8 w-8 text-muted-foreground/50 mb-2" />
              <p className="text-xs text-muted-foreground mb-2">No destinations</p>
              <Button variant="outline" size="sm" onClick={() => setIsFormOpen(true)}>
                <Plus className="h-3 w-3 mr-1" />
                Add Destination
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-border h-full overflow-y-auto">
              {destinations.map((dest) => (
                <div key={dest.id} className="flex items-center justify-between p-3 hover:bg-secondary/30 transition-colors">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {getProviderIcon(dest.provider)}
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">{dest.name}</div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Badge variant="secondary" className="text-[9px] h-4 font-mono">
                          {dest.credential.name}
                        </Badge>
                        {dest.folderPath && (
                          <>
                            <span className="text-border">|</span>
                            <code className="truncate text-[10px]">{dest.folderPath}</code>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                          <MoreVertical className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={(e) => handleOpenDelete(dest, e as unknown as React.MouseEvent)}
                          className="cursor-pointer text-xs"
                        >
                          <Trash2 className="mr-2 h-3 w-3" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          )}
        </PanelContent>
      </Panel>

      <DestinationFormSheet
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        onSuccess={fetchDestinations}
      />

      <DeleteConfirmDialog
        open={!!deleteDestination}
        onOpenChange={(open) => !open && setDeleteDestination(null)}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
        title="Delete Destination?"
        description="This will permanently delete this destination. Any backup jobs using this destination will no longer work."
        itemName={deleteDestination?.name}
      />
    </>
  )
}
