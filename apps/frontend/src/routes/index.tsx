import { createFileRoute } from '@tanstack/react-router'
import { ProtectedRoute } from '@/lib/auth/ProtectedRoute'
import { Panel, PanelHeader, PanelTitle, PanelContent } from '@/components/ui/panel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Activity,
  Clock,
  TrendingUp,
  HardDrive,
  RefreshCw,
  Copy,
  Trash2,
  Loader2,
} from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { api } from '@/lib/api'
import { useToast } from '@/hooks/use-toast'
import {
  StatCard,
  ActiveBackupsPanel,
  HistoryChart,
  SystemHealthPanel,
  BackupJobsPanel,
  AlertsBanner,
  HistoryPanel,
  DestinationsPanel,
} from '@/components/dashboard'
import { useDashboardStream, type DashboardStats } from '@/hooks/useDashboardStream'

export const Route = createFileRoute('/')({
  component: () => (
    <ProtectedRoute>
      <Dashboard />
    </ProtectedRoute>
  ),
})

interface LogEvent {
  timestamp: string
  level: 'info' | 'error' | 'warn' | 'debug'
  message: string
  metadata?: Record<string, any>
}

function Dashboard() {
  // SSE stream for real-time updates
  const { isConnected, activeJobs, queueStats, workerStatus } = useDashboardStream()
  const { toast } = useToast()

  // Dashboard stats
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [isLoadingStats, setIsLoadingStats] = useState(true)

  // Live logs
  const [logs, setLogs] = useState<LogEvent[]>([])
  const [isLogsConnected, setIsLogsConnected] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const logsEndRef = useRef<HTMLDivElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    fetchDashboardStats()
    connectToLogs()

    // Refresh stats every 30 seconds
    const interval = setInterval(fetchDashboardStats, 30000)

    return () => {
      clearInterval(interval)
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [])

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs])

  async function fetchDashboardStats() {
    try {
      const response = await api.get<DashboardStats>('/dashboard/stats')
      if (response.success && response.data) {
        setStats(response.data)
      }
    } catch (error) {
      console.error('Failed to fetch dashboard stats:', error)
    } finally {
      setIsLoadingStats(false)
    }
  }

  async function connectToLogs() {
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'
      const tokenResponse = await fetch(`${apiUrl}/api/auth/token`, {
        credentials: 'include',
      })

      if (!tokenResponse.ok) return

      const tokenData = await tokenResponse.json()
      if (!tokenData.success || !tokenData.data?.token) return

      const token = tokenData.data.token
      const url = `${apiUrl}/api/logs?token=${encodeURIComponent(token)}`

      const eventSource = new EventSource(url)
      eventSourceRef.current = eventSource

      eventSource.onopen = () => {
        setIsLogsConnected(true)
      }

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type) return
          if (data.timestamp && data.level && data.message) {
            setLogs((prev) => [...prev.slice(-99), data as LogEvent])
          }
        } catch (err) {
          console.error('Error parsing log event:', err)
        }
      }

      eventSource.onerror = () => {
        setIsLogsConnected(false)
      }
    } catch (error) {
      console.error('Failed to connect to logs:', error)
    }
  }

  function formatBytes(bytes: number | string): string {
    const num = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes
    if (num === 0 || isNaN(num)) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(num) / Math.log(k))
    return Math.round((num / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
  }

  function getLevelColor(level: string) {
    switch (level) {
      case 'error':
        return 'text-status-error'
      case 'warn':
        return 'text-status-warning'
      case 'info':
        return 'text-status-info'
      case 'debug':
        return 'text-muted-foreground'
      default:
        return 'text-foreground'
    }
  }

  function formatLogTimestamp(timestamp: string) {
    const date = new Date(timestamp)
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    const seconds = String(date.getSeconds()).padStart(2, '0')
    return `${hours}:${minutes}:${seconds}`
  }

  function copyLogs() {
    const logText = logs
      .filter(log => log.timestamp && log.level && log.message)
      .map(log => `${formatLogTimestamp(log.timestamp)} [${log.level.toUpperCase()}] ${log.message}`)
      .join('\n')
    navigator.clipboard.writeText(logText)
    toast({
      description: 'Logs copied to clipboard',
    })
  }

  async function deleteLogs() {
    setIsDeleting(true)
    try {
      const response = await api.delete('/logs')
      if (response.success) {
        setLogs([])
        toast({
          description: 'Logs deleted successfully',
        })
      } else {
        toast({
          variant: 'destructive',
          description: 'Failed to delete logs',
        })
      }
    } catch (error) {
      console.error('Failed to delete logs:', error)
      toast({
        variant: 'destructive',
        description: 'Failed to delete logs',
      })
    } finally {
      setIsDeleting(false)
      setShowDeleteDialog(false)
    }
  }

  // Use live queue stats if available, otherwise use fetched stats
  const currentQueue = queueStats || stats?.queue

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Alerts Banner - only shows if there are alerts */}
      <div className="shrink-0 animate-slide-down-fade">
        <AlertsBanner />
      </div>

      {/* Main Dashboard - Two Column Layout */}
      <div className="flex-1 grid gap-2 lg:grid-cols-[2fr_1fr] overflow-hidden">
        {/* Left Column - Main Content (2/3) */}
        <div className="flex flex-col gap-2 min-h-0 overflow-hidden">
          {/* Stats Row */}
          <div className="grid gap-2 grid-cols-2 lg:grid-cols-4 shrink-0">
            <div className="animate-slide-up-fade animation-delay-50">
              <StatCard
                icon={Activity}
                label="Running Backups"
                value={activeJobs.size}
                status={activeJobs.size > 0 ? 'success' : 'normal'}
                loading={false}
              />
            </div>
            <div className="animate-slide-up-fade animation-delay-100">
              <StatCard
                icon={Clock}
                label="Queue Depth"
                value={currentQueue?.waiting ?? 0}
                subValue={currentQueue?.active ? `${currentQueue.active} active` : undefined}
                loading={isLoadingStats && !queueStats}
              />
            </div>
            <div className="animate-slide-up-fade animation-delay-150">
              <StatCard
                icon={TrendingUp}
                label="Success Rate (7d)"
                value={`${stats?.history.successRate ?? 0}%`}
                status={
                  (stats?.history.successRate ?? 100) >= 95
                    ? 'success'
                    : (stats?.history.successRate ?? 100) >= 80
                    ? 'warning'
                    : 'error'
                }
                loading={isLoadingStats}
              />
            </div>
            <div className="animate-slide-up-fade animation-delay-200">
              <StatCard
                icon={HardDrive}
                label="Data Today"
                value={formatBytes(stats?.history.bytesToday ?? '0')}
                loading={isLoadingStats}
              />
            </div>
          </div>

          {/* Health & Chart Row */}
          <div className="grid gap-2 lg:grid-cols-3 min-h-0 flex-1">
            <div className="min-h-0 overflow-hidden animate-slide-up-fade animation-delay-250">
              <SystemHealthPanel workerStatus={workerStatus} />
            </div>
            <div className="min-h-0 overflow-hidden lg:col-span-2 animate-slide-up-fade animation-delay-250">
              <HistoryChart />
            </div>
          </div>

          {/* Destinations, Jobs & History Row */}
          <div className="grid gap-2 lg:grid-cols-3 min-h-0 flex-1">
            <div className="min-h-0 overflow-hidden animate-slide-up-fade animation-delay-300">
              <DestinationsPanel />
            </div>
            <div className="min-h-0 overflow-hidden animate-slide-up-fade animation-delay-300">
              <BackupJobsPanel />
            </div>
            <div className="min-h-0 overflow-hidden animate-slide-up-fade animation-delay-300">
              <HistoryPanel />
            </div>
          </div>
        </div>

        {/* Right Column - System Logs & Active Backups (1/3) */}
        <div className="min-h-0 overflow-hidden flex flex-col gap-2">
          {/* System Logs */}
          <div className="flex-1 min-h-0 overflow-hidden animate-slide-up-fade animation-delay-350">
            <Panel className="flex flex-col h-full">
              <PanelHeader
                actions={
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={copyLogs}
                      title="Copy logs"
                      disabled={logs.length === 0}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => setShowDeleteDialog(true)}
                      title="Delete logs"
                      disabled={logs.length === 0 || isDeleting}
                    >
                      {isDeleting ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                    </Button>
                    {isLogsConnected ? (
                      <Badge variant="outline" className="bg-status-success/20 text-status-success h-5 text-[10px]">
                        Live
                      </Badge>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2"
                        onClick={() => connectToLogs()}
                      >
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                }
              >
                <PanelTitle>System Logs</PanelTitle>
              </PanelHeader>
              <PanelContent className="p-0 flex-1 min-h-0">
                <div className="bg-background h-full overflow-y-auto font-mono text-[11px] p-2">
                  {logs.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
                      Waiting for logs...
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {logs.filter(log => log.timestamp && log.level && log.message).map((log, index) => (
                        <div key={index} className="flex gap-2 leading-tight">
                          <span className="text-muted-foreground shrink-0">
                            {formatLogTimestamp(log.timestamp)}
                          </span>
                          <span className={`uppercase font-bold shrink-0 w-10 ${getLevelColor(log.level)}`}>
                            {log.level}
                          </span>
                          <span className="text-foreground break-all">
                            {log.message}
                          </span>
                        </div>
                      ))}
                      <div ref={logsEndRef} />
                    </div>
                  )}
                </div>
              </PanelContent>
            </Panel>
          </div>

          {/* Active Backups */}
          <div className="flex-1 min-h-0 overflow-hidden animate-slide-up-fade animation-delay-350">
            <ActiveBackupsPanel jobs={activeJobs} isConnected={isConnected} />
          </div>
        </div>
      </div>

      {/* Delete Logs Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete All Logs?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all logs from the database. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteLogs}
              disabled={isDeleting}
              className="bg-primary hover:bg-primary/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete Logs'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
