import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Folder, ChevronRight, Plus, Loader2, AlertCircle } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface FolderItem {
  id?: string
  name: string
  path: string
  type?: 'directory' | 'file'
  size?: number
  modified?: Date
}

interface FolderPickerProps {
  type: 'nas' | 'cloud'
  credentialId?: string
  destinationId?: string
  value: string
  onChange: (path: string, folderId?: string) => void
  disabled?: boolean
  placeholder?: string
  allowCreate?: boolean
}

interface BreadcrumbItem {
  name: string
  path: string
  folderId?: string
}

export function FolderPicker({
  type,
  credentialId,
  destinationId,
  value,
  onChange,
  disabled = false,
  placeholder = 'Select folder...',
  allowCreate = false,
}: FolderPickerProps) {
  const [open, setOpen] = useState(false)
  const [folders, setFolders] = useState<FolderItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([])
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>()
  const [showCreateInput, setShowCreateInput] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creating, setCreating] = useState(false)
  const [manualInput, setManualInput] = useState(false)

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setError(null)
      setBreadcrumbs([{ name: 'Root', path: '/' }])
      setCurrentFolderId(undefined)
      setShowCreateInput(false)
      setNewFolderName('')
      fetchFolders()
    }
  }, [open])

  async function fetchFolders(parentFolderId?: string) {
    setLoading(true)
    setError(null)

    try {
      if (type === 'nas') {
        const currentPath = breadcrumbs.length > 0
          ? breadcrumbs[breadcrumbs.length - 1].path
          : '/'
        const response = await api.get<{ items: FolderItem[] }>(`/nas/browse?path=${encodeURIComponent(currentPath)}`)
        if (response.success && response.data) {
          // Filter only directories
          const dirs = response.data.items
            .filter((item: FolderItem) => item.type === 'directory')
            .map((item: FolderItem) => ({
              name: item.name,
              path: item.path,
            }))
          setFolders(dirs)
        } else if (response.error) {
          throw new Error(response.error)
        }
      } else if (type === 'cloud' && credentialId && destinationId) {
        const url = parentFolderId
          ? `/destinations/browse/${credentialId}/${destinationId}/folders?parentFolderId=${parentFolderId}`
          : `/destinations/browse/${credentialId}/${destinationId}/folders`
        const response = await api.get<FolderItem[]>(url)
        if (response.success && response.data) {
          setFolders(response.data)
        }
      }
    } catch (err: unknown) {
      console.error('Failed to fetch folders:', err)
      setError(err instanceof Error ? err.message : String(err) || 'Failed to load folders')
    } finally {
      setLoading(false)
    }
  }

  async function handleFolderClick(folder: FolderItem) {
    const newBreadcrumb: BreadcrumbItem = {
      name: folder.name,
      path: type === 'nas' ? folder.path : `${breadcrumbs[breadcrumbs.length - 1]?.path || ''}/${folder.name}`,
      folderId: folder.id,
    }
    setBreadcrumbs([...breadcrumbs, newBreadcrumb])
    setCurrentFolderId(folder.id)

    if (type === 'nas') {
      // For NAS, we need to fetch with the new path
      setLoading(true)
      try {
        const response = await api.get<{ items: FolderItem[] }>(`/nas/browse?path=${encodeURIComponent(folder.path)}`)
        if (response.success && response.data) {
          const dirs = response.data.items
            .filter((item: FolderItem) => item.type === 'directory')
            .map((item: FolderItem) => ({
              name: item.name,
              path: item.path,
            }))
          setFolders(dirs)
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err) || 'Failed to load folders')
      } finally {
        setLoading(false)
      }
    } else {
      await fetchFolders(folder.id)
    }
  }

  function handleBreadcrumbClick(index: number) {
    const newBreadcrumbs = breadcrumbs.slice(0, index + 1)
    setBreadcrumbs(newBreadcrumbs)
    const targetBreadcrumb = newBreadcrumbs[newBreadcrumbs.length - 1]
    setCurrentFolderId(targetBreadcrumb?.folderId)

    if (type === 'nas') {
      // Fetch folders for the NAS path
      setLoading(true)
      api.get<{ items: FolderItem[] }>(`/nas/browse?path=${encodeURIComponent(targetBreadcrumb?.path || '/')}`)
        .then(response => {
          if (response.success && response.data) {
            const dirs = response.data.items
              .filter((item: FolderItem) => item.type === 'directory')
              .map((item: FolderItem) => ({
                name: item.name,
                path: item.path,
              }))
            setFolders(dirs)
          }
        })
        .catch(err => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setLoading(false))
    } else {
      fetchFolders(targetBreadcrumb?.folderId)
    }
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim() || !credentialId || !destinationId) return

    setCreating(true)
    try {
      const response = await api.post<FolderItem>(
        `/destinations/browse/${credentialId}/${destinationId}/folders`,
        {
          name: newFolderName.trim(),
          parentFolderId: currentFolderId,
        }
      )
      if (response.success && response.data) {
        setFolders([...folders, response.data])
        setNewFolderName('')
        setShowCreateInput(false)
      }
    } catch (err: unknown) {
      console.error('Failed to create folder:', err)
    } finally {
      setCreating(false)
    }
  }

  function handleSelect() {
    const currentBreadcrumb = breadcrumbs[breadcrumbs.length - 1]
    if (type === 'nas') {
      onChange(currentBreadcrumb?.path || '/')
    } else {
      onChange(currentBreadcrumb?.path || '/', currentFolderId)
    }
    setOpen(false)
  }

  // If cloud type but missing required props, show disabled state
  const isCloudMissingProps = type === 'cloud' && (!credentialId || !destinationId)

  return (
    <div className="flex gap-2">
      {manualInput ? (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1"
        />
      ) : (
        <Input
          value={value}
          readOnly
          placeholder={placeholder}
          disabled={disabled || isCloudMissingProps}
          className="flex-1 cursor-pointer"
          onClick={() => !disabled && !isCloudMissingProps && setOpen(true)}
        />
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => !disabled && !isCloudMissingProps && setOpen(true)}
        disabled={disabled || isCloudMissingProps}
      >
        Browse
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Select Folder</DialogTitle>
          </DialogHeader>

          {/* Breadcrumb Navigation */}
          <div className="flex items-center gap-1 text-sm overflow-x-auto pb-2 border-b">
            {breadcrumbs.map((crumb, index) => (
              <div key={index} className="flex items-center shrink-0">
                {index > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground mx-1" />}
                <button
                  type="button"
                  onClick={() => handleBreadcrumbClick(index)}
                  className={cn(
                    'hover:text-primary transition-colors px-1 py-0.5 rounded',
                    index === breadcrumbs.length - 1 ? 'font-medium text-primary' : 'text-muted-foreground'
                  )}
                >
                  {crumb.name}
                </button>
              </div>
            ))}
          </div>

          {/* Folder List */}
          <div className="min-h-[200px] max-h-[300px] overflow-y-auto">
            {loading ? (
              <div className="space-y-2 p-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-[200px] text-center p-4">
                <AlertCircle className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground mb-3">{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setManualInput(true)}
                >
                  Enter manually
                </Button>
              </div>
            ) : folders.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[200px] text-center p-4">
                <Folder className="h-8 w-8 text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">No subfolders</p>
              </div>
            ) : (
              <div className="divide-y">
                {folders.map((folder, index) => (
                  <button
                    key={folder.id || index}
                    type="button"
                    onClick={() => handleFolderClick(folder)}
                    className="flex items-center gap-2 w-full p-2 hover:bg-secondary/50 transition-colors text-left"
                  >
                    <Folder className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-sm truncate">{folder.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Create Folder (cloud only) */}
          {type === 'cloud' && allowCreate && !error && (
            <div className="border-t pt-3">
              {showCreateInput ? (
                <div className="flex gap-2">
                  <Input
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="Folder name"
                    className="flex-1"
                    onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleCreateFolder}
                    disabled={!newFolderName.trim() || creating}
                  >
                    {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowCreateInput(false)
                      setNewFolderName('')
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowCreateInput(true)}
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  New Folder
                </Button>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleSelect} disabled={loading}>
              Select Folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
