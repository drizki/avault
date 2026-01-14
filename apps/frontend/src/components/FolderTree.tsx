import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Plus,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface FolderNode {
  id?: string
  name: string
  path: string
  children: FolderNode[]
  isLoading: boolean
  isLoaded: boolean
  isExpanded: boolean
  error?: string
}

interface FolderTreeProps {
  type: 'nas' | 'cloud'
  credentialId?: string
  destinationId?: string
  value: string
  onChange: (path: string, folderId?: string) => void
  disabled?: boolean
  placeholder?: string
  allowCreate?: boolean
}

interface NasBrowseResponse {
  path: string
  items: Array<{
    name: string
    path: string
    type: 'directory' | 'file'
    size?: number
    modified?: string
  }>
}

interface NasInfoResponse {
  mountPath: string
}

// TreeNode component - defined outside to prevent re-creation on each render
function TreeNode({
  node,
  depth,
  selectedPath,
  type,
  allowCreate,
  onToggle,
  onSelect,
  onCreateClick,
  creatingIn,
  newFolderName,
  setNewFolderName,
  onCreateFolder,
  isCreating,
  setCreatingIn,
}: {
  node: FolderNode
  depth: number
  selectedPath: string
  type: 'nas' | 'cloud'
  allowCreate: boolean
  onToggle: (node: FolderNode) => void
  onSelect: (node: FolderNode) => void
  onCreateClick: (path: string) => void
  creatingIn: string | null
  newFolderName: string
  setNewFolderName: (name: string) => void
  onCreateFolder: (parentNode: FolderNode) => void
  isCreating: boolean
  setCreatingIn: (path: string | null) => void
}) {
  const isSelected = selectedPath === node.path
  const hasChildren = node.children.length > 0

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 py-1 px-2 rounded-md cursor-pointer hover:bg-secondary/50 transition-colors',
          isSelected && 'bg-primary/10 text-primary'
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <button
          type="button"
          className="p-0.5 hover:bg-secondary rounded"
          onClick={(e) => {
            e.stopPropagation()
            onToggle(node)
          }}
        >
          {node.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : node.isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        <div
          className="flex items-center gap-2 flex-1 py-0.5"
          onClick={() => onSelect(node)}
        >
          {node.isExpanded ? (
            <FolderOpen className="h-4 w-4 text-primary shrink-0" />
          ) : (
            <Folder className="h-4 w-4 text-primary shrink-0" />
          )}
          <span className="text-sm truncate">{node.name}</span>
        </div>

        {type === 'cloud' && allowCreate && isSelected && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={(e) => {
              e.stopPropagation()
              onCreateClick(node.path)
            }}
          >
            <Plus className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* Children - always render container, conditionally render items */}
      {node.isExpanded && (
        <div>
          {hasChildren &&
            node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                type={type}
                allowCreate={allowCreate}
                onToggle={onToggle}
                onSelect={onSelect}
                onCreateClick={onCreateClick}
                creatingIn={creatingIn}
                newFolderName={newFolderName}
                setNewFolderName={setNewFolderName}
                onCreateFolder={onCreateFolder}
                isCreating={isCreating}
                setCreatingIn={setCreatingIn}
              />
            ))}

          {node.isLoaded && !hasChildren && (
            <div
              className="text-xs py-1"
              style={{ paddingLeft: `${(depth + 1) * 16 + 32}px` }}
            >
              {node.error ? (
                <span className="text-destructive">{node.error}</span>
              ) : (
                <span className="text-muted-foreground">No subfolders</span>
              )}
            </div>
          )}

          {/* Create folder input */}
          {creatingIn === node.path && (
            <div
              className="flex items-center gap-2 py-1"
              style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
            >
              <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="New folder name"
                className="h-7 text-sm flex-1"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onCreateFolder(node)
                  if (e.key === 'Escape') {
                    setCreatingIn(null)
                    setNewFolderName('')
                  }
                }}
              />
              <Button
                type="button"
                size="sm"
                className="h-7"
                onClick={() => onCreateFolder(node)}
                disabled={!newFolderName.trim() || isCreating}
              >
                {isCreating ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Add'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function FolderTree({
  type,
  credentialId,
  destinationId,
  value,
  onChange,
  disabled = false,
  placeholder = 'Select folder...',
  allowCreate = false,
}: FolderTreeProps) {
  const [open, setOpen] = useState(false)
  const [rootNodes, setRootNodes] = useState<FolderNode[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string>('')
  const [selectedFolderId, setSelectedFolderId] = useState<string | undefined>()
  const [manualInput, setManualInput] = useState(false)
  const [mountPath, setMountPath] = useState<string>('')

  // For creating new folders
  const [creatingIn, setCreatingIn] = useState<string | null>(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  // Fetch mount path on component mount (for display)
  useEffect(() => {
    if (type === 'nas' && !mountPath) {
      api.get<NasInfoResponse>('/nas/info').then((res) => {
        if (res.success && res.data) {
          setMountPath(res.data.mountPath)
        }
      })
    }
  }, [type, mountPath])

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setError(null)
      setSelectedPath(value || '/')
      setSelectedFolderId(undefined)
      fetchInitialData()
    }
  }, [open])

  // Build display path (full path for NAS)
  const displayPath = type === 'nas' && mountPath && value
    ? value === '/'
      ? mountPath
      : `${mountPath}${value}`
    : value

  async function fetchInitialData() {
    setLoading(true)
    setError(null)

    try {
      if (type === 'nas') {
        // Fetch NAS info to get mount path
        const infoResponse = await api.get<NasInfoResponse>('/nas/info')
        if (infoResponse.success && infoResponse.data) {
          setMountPath(infoResponse.data.mountPath)
        }

        // Fetch root folders
        const response = await api.get<NasBrowseResponse>('/nas/browse?path=/')

        if (response.success && response.data) {
          const items = response.data.items || []
          const dirs = items
            .filter((item) => item.type === 'directory')
            .map((item) => ({
              name: item.name,
              path: item.path,
              children: [],
              isLoaded: false,
              isLoading: false,
              isExpanded: false,
            }))
          setRootNodes(dirs)
        } else if (response.error) {
          throw new Error(response.error)
        }
      } else if (type === 'cloud' && credentialId && destinationId) {
        const response = await api.get<any[]>(
          `/destinations/browse/${credentialId}/${destinationId}/folders`
        )
        if (response.success && response.data) {
          const dirs = response.data.map((item) => ({
            id: item.id,
            name: item.name,
            path: `/${item.name}`,
            children: [],
            isLoaded: false,
            isLoading: false,
            isExpanded: false,
          }))
          setRootNodes(dirs)
        }
      }
    } catch (err: any) {
      console.error('Failed to fetch folders:', err)
      setError(err.message || 'Failed to load folders')
    } finally {
      setLoading(false)
    }
  }

  const fetchChildren = useCallback(async (node: FolderNode): Promise<{ children: FolderNode[], error?: string }> => {
    try {
      if (type === 'nas') {
        const response = await api.get<NasBrowseResponse>(
          `/nas/browse?path=${encodeURIComponent(node.path)}`
        )

        if (response.success && response.data) {
          const items = response.data.items || []
          return {
            children: items
              .filter((item) => item.type === 'directory')
              .map((item) => ({
                name: item.name,
                path: item.path,
                children: [],
                isLoaded: false,
                isLoading: false,
                isExpanded: false,
              }))
          }
        } else if (response.error) {
          return { children: [], error: response.error }
        }
      } else if (type === 'cloud' && credentialId && destinationId) {
        const response = await api.get<any[]>(
          `/destinations/browse/${credentialId}/${destinationId}/folders?parentFolderId=${node.id}`
        )
        if (response.success && response.data) {
          return {
            children: response.data.map((item) => ({
              id: item.id,
              name: item.name,
              path: `${node.path}/${item.name}`,
              children: [],
              isLoaded: false,
              isLoading: false,
              isExpanded: false,
            }))
          }
        } else if (response.error) {
          return { children: [], error: response.error }
        }
      }
    } catch (err: any) {
      console.error('Failed to fetch children:', err)
      return { children: [], error: err.message }
    }
    return { children: [] }
  }, [type, credentialId, destinationId])

  // Deep update a node in the tree by path
  const updateNodeByPath = useCallback((
    nodes: FolderNode[],
    targetPath: string,
    updater: (node: FolderNode) => FolderNode
  ): FolderNode[] => {
    return nodes.map((node) => {
      if (node.path === targetPath) {
        return updater(node)
      }
      // Always recurse into children if they exist
      if (node.children.length > 0) {
        const updatedChildren = updateNodeByPath(node.children, targetPath, updater)
        // Only create new object if children actually changed
        if (updatedChildren !== node.children) {
          return { ...node, children: updatedChildren }
        }
      }
      return node
    })
  }, [])

  const handleToggle = useCallback(async (node: FolderNode) => {
    if (node.isExpanded) {
      // Collapse
      setRootNodes((prev) =>
        updateNodeByPath(prev, node.path, (n) => ({ ...n, isExpanded: false }))
      )
    } else {
      // Expand - load children if needed
      if (!node.isLoaded) {
        // Set loading state
        setRootNodes((prev) =>
          updateNodeByPath(prev, node.path, (n) => ({ ...n, isLoading: true, error: undefined }))
        )

        const result = await fetchChildren(node)

        // Update with children or error
        setRootNodes((prev) =>
          updateNodeByPath(prev, node.path, (n) => ({
            ...n,
            children: result.children,
            error: result.error,
            isLoaded: true,
            isLoading: false,
            isExpanded: true,
          }))
        )
      } else {
        setRootNodes((prev) =>
          updateNodeByPath(prev, node.path, (n) => ({ ...n, isExpanded: true }))
        )
      }
    }
  }, [fetchChildren, updateNodeByPath])

  const handleSelect = useCallback((node: FolderNode) => {
    setSelectedPath(node.path)
    setSelectedFolderId(node.id)
  }, [])

  const handleSelectRoot = useCallback(() => {
    setSelectedPath('/')
    setSelectedFolderId(undefined)
  }, [])

  const handleCreateFolder = useCallback(async (parentNode: FolderNode | null) => {
    if (!newFolderName.trim()) return

    if (type === 'nas') {
      return
    }

    if (!credentialId || !destinationId) return

    setIsCreating(true)
    try {
      const response = await api.post<any>(
        `/destinations/browse/${credentialId}/${destinationId}/folders`,
        {
          name: newFolderName.trim(),
          parentFolderId: parentNode?.id,
        }
      )

      if (response.success && response.data) {
        const newNode: FolderNode = {
          id: response.data.id,
          name: response.data.name,
          path: parentNode ? `${parentNode.path}/${response.data.name}` : `/${response.data.name}`,
          children: [],
          isLoaded: true,
          isLoading: false,
          isExpanded: false,
        }

        if (parentNode) {
          setRootNodes((prev) =>
            updateNodeByPath(prev, parentNode.path, (n) => ({
              ...n,
              children: [...n.children, newNode],
              isExpanded: true,
            }))
          )
        } else {
          setRootNodes((prev) => [...prev, newNode])
        }

        setNewFolderName('')
        setCreatingIn(null)
      }
    } catch (err) {
      console.error('Failed to create folder:', err)
    } finally {
      setIsCreating(false)
    }
  }, [newFolderName, type, credentialId, destinationId, updateNodeByPath])

  const handleConfirm = useCallback(() => {
    onChange(selectedPath, selectedFolderId)
    setOpen(false)
  }, [onChange, selectedPath, selectedFolderId])

  const handleCreateClick = useCallback((path: string) => {
    setCreatingIn(path)
  }, [])

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
          value={displayPath || ''}
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

          {/* Selected path display */}
          <div className="flex items-center gap-2 text-sm bg-secondary/30 rounded-md px-3 py-2 min-w-0">
            <span className="text-muted-foreground shrink-0">Selected:</span>
            <div className="overflow-x-auto overflow-y-hidden">
              <code className="text-xs bg-secondary px-2 py-0.5 rounded font-mono whitespace-nowrap">
                {type === 'nas' && mountPath
                  ? selectedPath === '/'
                    ? mountPath
                    : `${mountPath}${selectedPath}`
                  : selectedPath || '/'}
              </code>
            </div>
          </div>

          {/* Tree View */}
          <ScrollArea className="h-[300px] border rounded-md">
            {loading ? (
              <div className="space-y-2 p-3">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-3/4 ml-4" />
                <Skeleton className="h-6 w-3/4 ml-4" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-3/4 ml-4" />
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-4">
                <AlertCircle className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground mb-3">{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setManualInput(true)
                    setOpen(false)
                  }}
                >
                  Enter manually
                </Button>
              </div>
            ) : (
              <div className="p-2">
                {/* Base folder option - shows mount path */}
                <div
                  className={cn(
                    'flex items-center gap-2 py-1 px-2 rounded-md cursor-pointer hover:bg-secondary/50 transition-colors',
                    selectedPath === '/' && 'bg-primary/10 text-primary'
                  )}
                  onClick={handleSelectRoot}
                >
                  <FolderOpen className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium truncate">{mountPath || '/'}</span>
                  {type === 'cloud' && allowCreate && selectedPath === '/' && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 ml-auto"
                      onClick={(e) => {
                        e.stopPropagation()
                        setCreatingIn('/')
                      }}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  )}
                </div>

                {/* Create folder at root */}
                {creatingIn === '/' && (
                  <div className="flex items-center gap-2 py-1 pl-8">
                    <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
                    <Input
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      placeholder="New folder name"
                      className="h-7 text-sm flex-1"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateFolder(null)
                        if (e.key === 'Escape') {
                          setCreatingIn(null)
                          setNewFolderName('')
                        }
                      }}
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="h-7"
                      onClick={() => handleCreateFolder(null)}
                      disabled={!newFolderName.trim() || isCreating}
                    >
                      {isCreating ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Add'}
                    </Button>
                  </div>
                )}

                {/* Tree nodes */}
                {rootNodes.length === 0 && !loading ? (
                  <div className="text-sm text-muted-foreground text-center py-4">
                    No folders found
                  </div>
                ) : (
                  rootNodes.map((node) => (
                    <TreeNode
                      key={node.path}
                      node={node}
                      depth={0}
                      selectedPath={selectedPath}
                      type={type}
                      allowCreate={allowCreate}
                      onToggle={handleToggle}
                      onSelect={handleSelect}
                      onCreateClick={handleCreateClick}
                      creatingIn={creatingIn}
                      newFolderName={newFolderName}
                      setNewFolderName={setNewFolderName}
                      onCreateFolder={handleCreateFolder}
                      isCreating={isCreating}
                      setCreatingIn={setCreatingIn}
                    />
                  ))
                )}
              </div>
            )}
          </ScrollArea>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleConfirm} disabled={loading}>
              Select Folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
