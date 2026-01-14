import { useState, useEffect } from 'react'
import { Panel, PanelHeader, PanelTitle, PanelContent } from '@/components/ui/panel'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  FileText,
  StopCircle,
  ChevronLeft,
  ChevronRight,
  History,
  FolderOutput,
  HardDrive,
  Calendar,
  Play,
  Cloud,
} from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatDistanceToNow } from 'date-fns'
import { api } from '@/lib/api'
import { LogViewerSheet } from '@/components/LogViewerSheet'

interface BackupHistory {
  id: string
  status: string
  triggerSource: 'MANUAL' | 'SCHEDULED'
  startedAt: string
  completedAt: string | null
  filesScanned: number
  filesUploaded: number
  filesFailed: number
  bytesUploaded: string
  remotePath: string | null
  errorMessage: string | null
  job: {
    id: string
    name: string
    sourcePath: string
    destination: {
      id: string
      name: string
      provider: string
    }
  }
}

interface PaginatedResponse {
  data: BackupHistory[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

const PAGE_SIZE = 10

export function HistoryPanel() {
  const [history, setHistory] = useState<BackupHistory[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [selectedHistory, setSelectedHistory] = useState<BackupHistory | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  async function fetchHistory(pageNum: number) {
    setLoading(true)
    try {
      const response = await api.get<PaginatedResponse>(
        `/history?page=${pageNum}&pageSize=${PAGE_SIZE}`
      )
      if (response.success && response.data) {
        setHistory(response.data.data)
        setTotalPages(response.data.pagination.totalPages)
      }
    } catch (error) {
      console.error('Failed to fetch history:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchHistory(page)
    // Refresh every 30 seconds
    const interval = setInterval(() => fetchHistory(page), 30000)
    return () => clearInterval(interval)
  }, [page])

  async function handleCancel(historyId: string, e: React.MouseEvent) {
    e.stopPropagation()
    setCancellingId(historyId)
    try {
      const response = await api.post(`/jobs/history/${historyId}/cancel`)
      if (response.success) {
        setHistory((prev) =>
          prev.map((h) => (h.id === historyId ? { ...h, status: 'CANCELLED' } : h))
        )
      }
    } catch (error) {
      console.error('Failed to cancel job:', error)
    } finally {
      setCancellingId(null)
    }
  }

  function isCancellable(status: string) {
    return ['PENDING', 'RUNNING', 'UPLOADING', 'ROTATING'].includes(status)
  }

  function getStatusIcon(status: string) {
    switch (status) {
      case 'SUCCESS':
        return <CheckCircle2 className="h-3 w-3 text-status-success" />
      case 'FAILED':
        return <XCircle className="h-3 w-3 text-status-error" />
      case 'RUNNING':
      case 'UPLOADING':
      case 'ROTATING':
        return <Loader2 className="h-3 w-3 text-status-info animate-spin" />
      case 'PENDING':
        return <Clock className="h-3 w-3 text-muted-foreground" />
      case 'PARTIAL_SUCCESS':
        return <AlertCircle className="h-3 w-3 text-status-warning" />
      case 'CANCELLED':
        return <StopCircle className="h-3 w-3 text-muted-foreground" />
      default:
        return <Clock className="h-3 w-3 text-muted-foreground" />
    }
  }

  function formatDuration(startedAt: string, completedAt: string | null) {
    if (!completedAt) return '-'
    const duration = Math.floor(
      (new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000
    )
    if (duration < 60) return `${duration}s`
    if (duration < 3600) return `${Math.floor(duration / 60)}m ${duration % 60}s`
    return `${Math.floor(duration / 3600)}h ${Math.floor((duration % 3600) / 60)}m`
  }

  function formatBytes(bytes: string | number): string {
    const num = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes
    if (num === 0 || isNaN(num)) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(num) / Math.log(k))
    return Math.round((num / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
  }

  function getDestinationIcon(provider: string) {
    switch (provider) {
      case 'google':
        return <Cloud className="h-3 w-3" />
      case 's3':
        return <HardDrive className="h-3 w-3" />
      default:
        return <Cloud className="h-3 w-3" />
    }
  }

  function getTriggerIcon(source: 'MANUAL' | 'SCHEDULED') {
    return source === 'SCHEDULED' ? (
      <Calendar className="h-3 w-3" />
    ) : (
      <Play className="h-3 w-3" />
    )
  }

  return (
    <>
      <Panel className="flex flex-col h-full">
        <PanelHeader
          actions={
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
              >
                <ChevronLeft className="h-3 w-3" />
              </Button>
              <span className="text-[10px] text-muted-foreground min-w-[3rem] text-center">
                {page}/{totalPages || 1}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
              >
                <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
          }
        >
          <PanelTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            History
          </PanelTitle>
        </PanelHeader>
        <PanelContent className="p-0 flex-1 min-h-0">
          {loading ? (
            <div className="p-3 space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : history.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-4">
              <Clock className="h-8 w-8 text-muted-foreground/50 mb-2" />
              <p className="text-xs text-muted-foreground">No backup history</p>
            </div>
          ) : (
            <TooltipProvider delayDuration={300}>
              <div className="divide-y divide-border h-full overflow-y-auto">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="p-2 hover:bg-secondary/30 transition-colors"
                  >
                    {/* Top row: Status, Job name, Actions */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        {getStatusIcon(item.status)}
                        <span className="text-xs font-medium truncate">{item.job.name}</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-muted-foreground">
                              {getTriggerIcon(item.triggerSource)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top">
                            <p>{item.triggerSource === 'SCHEDULED' ? 'Scheduled run' : 'Manual run'}</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {isCancellable(item.status) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 w-5 p-0 text-status-error hover:bg-status-error/10"
                            onClick={(e) => handleCancel(item.id, e)}
                            disabled={cancellingId === item.id}
                            title="Cancel"
                          >
                            {cancellingId === item.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <StopCircle className="h-3 w-3" />
                            )}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0"
                          onClick={() => setSelectedHistory(item)}
                          title="View logs"
                        >
                          <FileText className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>

                    {/* Second row: Time, Duration, Stats */}
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-1 ml-5">
                      <span>{formatDistanceToNow(new Date(item.startedAt), { addSuffix: true })}</span>
                      <span className="text-border">·</span>
                      <span className="font-mono">{formatDuration(item.startedAt, item.completedAt)}</span>
                      {item.filesUploaded > 0 && (
                        <>
                          <span className="text-border">·</span>
                          <span>{item.filesUploaded} files</span>
                        </>
                      )}
                      {parseInt(item.bytesUploaded) > 0 && (
                        <>
                          <span className="text-border">·</span>
                          <span>{formatBytes(item.bytesUploaded)}</span>
                        </>
                      )}
                      {item.filesFailed > 0 && (
                        <>
                          <span className="text-border">·</span>
                          <span className="text-status-error">{item.filesFailed} failed</span>
                        </>
                      )}
                    </div>

                    {/* Third row: Destination and Remote Path */}
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-1 ml-5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="flex items-center gap-1 truncate max-w-[120px]">
                            {getDestinationIcon(item.job.destination.provider)}
                            <span className="truncate">{item.job.destination.name}</span>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          <p>Destination: {item.job.destination.name}</p>
                        </TooltipContent>
                      </Tooltip>
                      {item.remotePath && (
                        <>
                          <span className="text-border">→</span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="flex items-center gap-1 truncate max-w-[150px]">
                                <FolderOutput className="h-3 w-3 shrink-0" />
                                <span className="truncate font-mono">{item.remotePath}</span>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <p>Remote folder: {item.remotePath}</p>
                            </TooltipContent>
                          </Tooltip>
                        </>
                      )}
                    </div>

                    {/* Error message for failed jobs */}
                    {item.errorMessage && (item.status === 'FAILED' || item.status === 'PARTIAL_SUCCESS') && (
                      <div className="mt-1 ml-5 text-[10px] text-status-error truncate" title={item.errorMessage}>
                        {item.errorMessage}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </TooltipProvider>
          )}
        </PanelContent>
      </Panel>

      <LogViewerSheet
        open={!!selectedHistory}
        onOpenChange={(open) => !open && setSelectedHistory(null)}
        historyId={selectedHistory?.id || ''}
        jobName={selectedHistory?.job.name}
      />
    </>
  )
}
