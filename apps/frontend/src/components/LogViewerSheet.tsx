import { useEffect, useRef, useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Terminal, Loader2 } from 'lucide-react'

interface LogEvent {
  timestamp: string
  level: 'info' | 'error' | 'warn' | 'debug'
  message: string
  jobId?: string
  historyId?: string
  metadata?: Record<string, any>
  _historical?: boolean
}

interface LogViewerSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  historyId: string
  jobName?: string
}

export function LogViewerSheet({ open, onOpenChange, historyId, jobName }: LogViewerSheetProps) {
  const [logs, setLogs] = useState<LogEvent[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [isLoadingHistorical, setIsLoadingHistorical] = useState(true)
  const [historicalCount, setHistoricalCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [historicalLimit, setHistoricalLimit] = useState('100')
  const logsEndRef = useRef<HTMLDivElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!open) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
      return
    }

    setLogs([])
    setIsLoadingHistorical(true)
    setHistoricalCount(0)
    setIsConnected(false)

    async function connectToLogs() {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'

        const tokenResponse = await fetch(`${apiUrl}/api/auth/token`, {
          credentials: 'include',
        })

        if (!tokenResponse.ok) {
          setError('Authentication required')
          setIsLoadingHistorical(false)
          return
        }

        const tokenData = await tokenResponse.json()
        if (!tokenData.success || !tokenData.data?.token) {
          setError('Failed to get authentication token')
          setIsLoadingHistorical(false)
          return
        }

        const token = tokenData.data.token
        const url = `${apiUrl}/api/logs/${historyId}?token=${encodeURIComponent(token)}&limit=${historicalLimit}`

        const eventSource = new EventSource(url)
        eventSourceRef.current = eventSource

        eventSource.onopen = () => {
          setError(null)
        }

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)

            if (data.type) {
              if (data.type === 'historical_complete') {
                setIsLoadingHistorical(false)
                setHistoricalCount(data.count || 0)
              } else if (data.type === 'connected') {
                setIsConnected(true)
              }
              return
            }

            const date = data.timestamp ? new Date(data.timestamp) : null
            const isValidLog =
              data.timestamp &&
              data.level &&
              data.message &&
              typeof data.timestamp === 'string' &&
              typeof data.level === 'string' &&
              typeof data.message === 'string' &&
              date !== null &&
              !isNaN(date.getTime())

            if (isValidLog) {
              setLogs((prev) => [...prev, data as LogEvent])
            }
          } catch (err) {
            console.error('[LogViewer] Error parsing event:', err)
          }
        }

        eventSource.onerror = () => {
          setIsConnected(false)
          setIsLoadingHistorical(false)
          setError('Connection lost. Retrying...')
          eventSource.close()
        }
      } catch (error) {
        console.error('Failed to connect to logs:', error)
        setError('Failed to connect to logs')
        setIsLoadingHistorical(false)
      }
    }

    connectToLogs()

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [open, historyId, historicalLimit])

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs])

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

  function formatTimestamp(timestamp: string) {
    try {
      const date = new Date(timestamp)
      if (isNaN(date.getTime())) {
        return 'INVALID'
      }
      const hours = String(date.getHours()).padStart(2, '0')
      const minutes = String(date.getMinutes()).padStart(2, '0')
      const seconds = String(date.getSeconds()).padStart(2, '0')
      const ms = String(date.getMilliseconds()).padStart(3, '0')
      return `${hours}:${minutes}:${seconds}.${ms}`
    } catch {
      return 'ERROR'
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="xl" className="flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            Execution Logs
          </SheetTitle>
          <SheetDescription className="flex items-center gap-2">
            {jobName && <span className="font-medium">{jobName}</span>}
            {isLoadingHistorical ? (
              <Badge variant="outline" className="bg-status-info/10 text-status-info border-status-info/20">
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                Loading...
              </Badge>
            ) : isConnected ? (
              <Badge variant="outline" className="bg-status-success/10 text-status-success border-status-success/20">
                Connected
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-status-error/10 text-status-error border-status-error/20">
                Disconnected
              </Badge>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center gap-2 py-2">
          <span className="text-xs text-muted-foreground">Show:</span>
          <Select value={historicalLimit} onValueChange={setHistoricalLimit}>
            <SelectTrigger className="w-28 h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="50">Last 50</SelectItem>
              <SelectItem value="100">Last 100</SelectItem>
              <SelectItem value="200">Last 200</SelectItem>
              <SelectItem value="500">Last 500</SelectItem>
            </SelectContent>
          </Select>
          {historicalCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {historicalCount} logs loaded
            </span>
          )}
        </div>

        {error && (
          <div className="p-2 bg-status-error/10 text-status-error border border-status-error/20 text-xs">
            {error}
          </div>
        )}

        <div className="flex-1 bg-black p-3 overflow-y-auto font-mono text-xs border border-border min-h-0">
          {logs.length === 0 && !isLoadingHistorical ? (
            <div className="text-muted-foreground text-center py-8">
              Waiting for logs...
            </div>
          ) : (
            <div className="space-y-0.5">
              {logs
                .filter((log) => log.timestamp && log.level && log.message)
                .map((log, index) => (
                  <div
                    key={index}
                    className={`flex gap-2 ${log._historical ? 'opacity-80' : ''}`}
                  >
                    <span className="text-muted-foreground shrink-0">
                      {formatTimestamp(log.timestamp)}
                    </span>
                    <span
                      className={`uppercase font-bold shrink-0 w-12 ${getLevelColor(log.level)}`}
                    >
                      [{log.level}]
                    </span>
                    <span className="text-foreground break-all">{log.message}</span>
                  </div>
                ))}
              <div ref={logsEndRef} />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
