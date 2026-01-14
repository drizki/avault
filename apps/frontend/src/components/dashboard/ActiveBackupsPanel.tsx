import { Panel, PanelHeader, PanelTitle, PanelContent } from '@/components/ui/panel'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Loader2, FileUp, Clock, Zap } from 'lucide-react'
import type { ActiveJob } from '@/hooks/useDashboardStream'
import { formatDistanceToNow } from 'date-fns'

interface ActiveBackupsPanelProps {
  jobs: Map<string, ActiveJob>
  isConnected: boolean
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
}

function formatSpeed(bytesPerSec: number | null): string {
  if (!bytesPerSec) return '--'
  return formatBytes(bytesPerSec) + '/s'
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'RUNNING':
      return 'bg-job-running'
    case 'UPLOADING':
      return 'bg-job-uploading'
    case 'ROTATING':
      return 'bg-job-rotating'
    case 'PENDING':
      return 'bg-job-pending'
    default:
      return 'bg-job-pending'
  }
}

function getStatusDescription(status: string): string {
  switch (status) {
    case 'RUNNING':
      return 'Scanning files...'
    case 'UPLOADING':
      return 'Uploading to cloud...'
    case 'ROTATING':
      return 'Applying retention policy...'
    case 'PENDING':
      return 'Waiting in queue...'
    default:
      return status
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'RUNNING':
      return 'Scanning'
    case 'UPLOADING':
      return 'Uploading'
    case 'ROTATING':
      return 'Cleanup'
    case 'PENDING':
      return 'Pending'
    default:
      return status
  }
}

export function ActiveBackupsPanel({ jobs, isConnected }: ActiveBackupsPanelProps) {
  const activeJobs = Array.from(jobs.values())
  const isLoading = !isConnected

  return (
    <Panel className="flex flex-col h-full">
      <PanelHeader
        actions={
          isConnected ? (
            <Badge variant="outline" className="bg-status-success/20 text-status-success h-5 text-[10px]">
              Live
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-status-error/20 text-status-error h-5 text-[10px]">
              Connecting...
            </Badge>
          )
        }
      >
        <PanelTitle className="flex items-center gap-2">
          <Loader2 className={`h-4 w-4 ${activeJobs.length > 0 ? 'animate-spin text-primary' : 'text-muted-foreground'}`} />
          Active Backups
          {activeJobs.length > 0 && (
            <Badge className="bg-primary/20 text-primary h-5 text-[10px] ml-1">
              {activeJobs.length}
            </Badge>
          )}
        </PanelTitle>
      </PanelHeader>
      <PanelContent className="p-0 flex-1 min-h-0">
        <div className="h-full overflow-y-auto">
          {isLoading ? (
            <div className="p-3 space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : activeJobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-4">
              <Clock className="h-8 w-8 text-muted-foreground/50 mb-2" />
              <p className="text-xs text-muted-foreground">No active backups</p>
              <p className="text-[10px] text-muted-foreground/70 mt-1">
                Backups will appear here when running
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {activeJobs.map((job) => {
                const progress = job.progress.filesScanned > 0
                  ? Math.round((job.progress.filesUploaded / job.progress.filesScanned) * 100)
                  : 0

                return (
                  <div key={job.historyId} className="p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-sm truncate">{job.jobName}</span>
                        <Badge className={`${getStatusColor(job.status)} text-white h-5 text-[10px]`}>
                          {getStatusLabel(job.status)}
                        </Badge>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatDistanceToNow(new Date(job.startedAt), { addSuffix: false })}
                      </span>
                    </div>

                    {/* Status description */}
                    <div className="text-xs text-muted-foreground">
                      {getStatusDescription(job.status)}
                    </div>

                    {/* Progress bar */}
                    <div className="relative h-2 bg-secondary overflow-hidden">
                      <div
                        className="absolute inset-y-0 left-0 bg-primary transition-all duration-300"
                        style={{ width: `${progress}%` }}
                      />
                      {job.status === 'UPLOADING' && (
                        <div
                          className="absolute inset-y-0 left-0 bg-primary/50 animate-pulse"
                          style={{ width: `${progress}%` }}
                        />
                      )}
                    </div>

                    {/* Stats row */}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <FileUp className="h-3 w-3" />
                        <span className="font-mono">
                          {job.progress.filesUploaded}/{job.progress.filesScanned}
                        </span>
                        <span>files</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="font-mono">{formatBytes(job.progress.bytesUploaded)}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Zap className="h-3 w-3 text-primary" />
                        <span className="font-mono">{formatSpeed(job.progress.uploadSpeed)}</span>
                      </div>
                    </div>

                    {/* Current file */}
                    {job.progress.currentFile && (
                      <div className="text-[10px] text-muted-foreground truncate font-mono bg-secondary/50 px-2 py-1">
                        {job.progress.currentFile}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </PanelContent>
    </Panel>
  )
}
