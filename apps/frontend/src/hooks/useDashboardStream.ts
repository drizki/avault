import { useState, useEffect, useRef, useCallback } from 'react'

// Types for dashboard data
export interface DashboardStats {
  jobs: {
    total: number
    enabled: number
  }
  history: {
    last24h: {
      success: number
      failed: number
      running: number
    }
    successRate: number
    bytesToday: string
  }
  queue: {
    waiting: number
    active: number
    completed: number
    failed: number
    delayed: number
    total: number
  }
}

export interface ActiveJob {
  historyId: string
  jobId: string
  jobName: string
  status: string
  startedAt: string
  progress: {
    filesScanned: number
    filesUploaded: number
    filesFailed: number
    bytesUploaded: number
    currentFile: string | null
    uploadSpeed: number | null
  }
}

export interface SystemHealth {
  overall: 'healthy' | 'degraded' | 'critical'
  services: {
    database: { status: string; latencyMs: number }
    redis: { status: string; latencyMs: number; memoryUsed: string }
    worker: { status: string; lastHeartbeat: string | null; activeJobs: number }
    storage: Array<{
      credentialId: string
      name: string
      provider: string
      status: 'connected' | 'expired' | 'expiring'
      expiresAt: string | null
    }>
  }
  timestamp: string
}

export interface UpcomingJob {
  id: string
  name: string
  schedule: string
  nextRunAt: string
  nextRunIn: number
  destination: {
    name: string
    provider: string
  }
}

export interface Alert {
  id: string
  type: string
  severity: 'warning' | 'error' | 'critical'
  title: string
  message: string
  timestamp: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>
}

export interface ChartDataPoint {
  date: string
  success: number
  failed: number
  partial: number
  bytesUploaded: string
}

// Dashboard SSE event types
type DashboardEvent =
  | { type: 'connected' }
  | { type: 'stats:update'; payload: DashboardStats }
  | {
      type: 'job:started'
      payload: { historyId: string; jobId: string; jobName: string; startedAt: string }
    }
  | {
      type: 'job:progress'
      payload: ActiveJob['progress'] & { historyId: string; jobId: string; jobName: string }
    }
  | { type: 'job:completed'; payload: { historyId: string; jobId: string; status: string } }
  | { type: 'queue:update'; payload: DashboardStats['queue'] }
  | { type: 'health:update'; payload: { worker: string; timestamp: string } }
  | { type: 'alert:new'; payload: Alert }

export interface UseDashboardStreamReturn {
  isConnected: boolean
  activeJobs: Map<string, ActiveJob>
  queueStats: DashboardStats['queue'] | null
  workerStatus: string
  reconnect: () => void
}

export function useDashboardStream(): UseDashboardStreamReturn {
  const [isConnected, setIsConnected] = useState(false)
  const [activeJobs, setActiveJobs] = useState<Map<string, ActiveJob>>(new Map())
  const [queueStats, setQueueStats] = useState<DashboardStats['queue'] | null>(null)
  const [workerStatus, setWorkerStatus] = useState<string>('unknown')
  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const connect = useCallback(async () => {
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000'

      // Get auth token
      const tokenResponse = await fetch(`${apiUrl}/api/auth/token`, {
        credentials: 'include',
      })

      if (!tokenResponse.ok) {
        console.error('[Dashboard SSE] Failed to get auth token')
        return
      }

      const tokenData = await tokenResponse.json()
      if (!tokenData.success || !tokenData.data?.token) {
        console.error('[Dashboard SSE] Invalid token response')
        return
      }

      const token = tokenData.data.token
      const url = `${apiUrl}/api/dashboard/stream?token=${encodeURIComponent(token)}`

      // Close existing connection if any
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }

      const eventSource = new EventSource(url)
      eventSourceRef.current = eventSource

      eventSource.onopen = () => {
        // eslint-disable-next-line no-console
        console.info('[Dashboard SSE] Connected')
        setIsConnected(true)
      }

      eventSource.onmessage = (event) => {
        try {
          const data: DashboardEvent = JSON.parse(event.data)

          switch (data.type) {
            case 'connected':
              // eslint-disable-next-line no-console
              console.info('[Dashboard SSE] Server confirmed connection')
              break

            case 'job:started':
              setActiveJobs((prev) => {
                const next = new Map(prev)
                next.set(data.payload.historyId, {
                  historyId: data.payload.historyId,
                  jobId: data.payload.jobId,
                  jobName: data.payload.jobName,
                  status: 'RUNNING',
                  startedAt: data.payload.startedAt,
                  progress: {
                    filesScanned: 0,
                    filesUploaded: 0,
                    filesFailed: 0,
                    bytesUploaded: 0,
                    currentFile: null,
                    uploadSpeed: null,
                  },
                })
                return next
              })
              break

            case 'job:progress':
              setActiveJobs((prev) => {
                const next = new Map(prev)
                const existing = next.get(data.payload.historyId)
                if (existing) {
                  next.set(data.payload.historyId, {
                    ...existing,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    status: (data.payload as any).status || existing.status,
                    progress: {
                      filesScanned: data.payload.filesScanned ?? existing.progress.filesScanned,
                      filesUploaded: data.payload.filesUploaded ?? existing.progress.filesUploaded,
                      filesFailed: data.payload.filesFailed ?? existing.progress.filesFailed,
                      bytesUploaded: data.payload.bytesUploaded ?? existing.progress.bytesUploaded,
                      currentFile: data.payload.currentFile ?? existing.progress.currentFile,
                      uploadSpeed: data.payload.uploadSpeed ?? existing.progress.uploadSpeed,
                    },
                  })
                } else {
                  // Job started before we connected, create entry
                  next.set(data.payload.historyId, {
                    historyId: data.payload.historyId,
                    jobId: data.payload.jobId,
                    jobName: data.payload.jobName,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    status: (data.payload as any).status || 'RUNNING',
                    startedAt: new Date().toISOString(),
                    progress: {
                      filesScanned: data.payload.filesScanned ?? 0,
                      filesUploaded: data.payload.filesUploaded ?? 0,
                      filesFailed: data.payload.filesFailed ?? 0,
                      bytesUploaded: data.payload.bytesUploaded ?? 0,
                      currentFile: data.payload.currentFile ?? null,
                      uploadSpeed: data.payload.uploadSpeed ?? null,
                    },
                  })
                }
                return next
              })
              break

            case 'job:completed':
              setActiveJobs((prev) => {
                const next = new Map(prev)
                next.delete(data.payload.historyId)
                return next
              })
              break

            case 'queue:update':
              setQueueStats(data.payload)
              break

            case 'health:update':
              setWorkerStatus(data.payload.worker)
              break

            default:
              // Unknown event type, ignore
              break
          }
        } catch (err) {
          console.error('[Dashboard SSE] Error parsing event:', err)
        }
      }

      eventSource.onerror = () => {
        console.error('[Dashboard SSE] Connection error')
        setIsConnected(false)
        eventSource.close()

        // Attempt to reconnect after 5 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          // eslint-disable-next-line no-console
          console.info('[Dashboard SSE] Attempting to reconnect...')
          connect()
        }, 5000)
      }
    } catch (error) {
      console.error('[Dashboard SSE] Failed to connect:', error)
      setIsConnected(false)
    }
  }, [])

  const reconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }
    connect()
  }, [connect])

  useEffect(() => {
    connect()

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [connect])

  return {
    isConnected,
    activeJobs,
    queueStats,
    workerStatus,
    reconnect,
  }
}
