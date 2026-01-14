import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, X, XCircle, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react'
import { api } from '@/lib/api'
import type { Alert } from '@/hooks/useDashboardStream'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'

interface AlertsData {
  alerts: Alert[]
  unreadCount: number
}

const DISMISSED_ALERTS_KEY = 'avault_dismissed_alerts'

function loadDismissedAlerts(): Set<string> {
  try {
    const stored = localStorage.getItem(DISMISSED_ALERTS_KEY)
    if (stored) {
      return new Set(JSON.parse(stored))
    }
  } catch (error) {
    console.error('Failed to load dismissed alerts:', error)
  }
  return new Set()
}

function saveDismissedAlerts(ids: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_ALERTS_KEY, JSON.stringify([...ids]))
  } catch (error) {
    console.error('Failed to save dismissed alerts:', error)
  }
}

export function AlertsBanner() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => loadDismissedAlerts())

  useEffect(() => {
    async function fetchAlerts() {
      try {
        const response = await api.get<AlertsData>('/dashboard/alerts')
        if (response.success && response.data) {
          setAlerts(response.data.alerts)
        }
      } catch (error) {
        console.error('Failed to fetch alerts:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchAlerts()
    // Refresh every 60 seconds
    const interval = setInterval(fetchAlerts, 60000)
    return () => clearInterval(interval)
  }, [])

  const visibleAlerts = alerts.filter((alert) => !dismissedIds.has(alert.id))

  const handleDismiss = (alertId: string) => {
    setDismissedIds((prev) => {
      const newIds = new Set([...prev, alertId])
      saveDismissedAlerts(newIds)
      return newIds
    })
  }

  const handleDismissAll = () => {
    setDismissedIds((prev) => {
      const newIds = new Set([...prev, ...visibleAlerts.map((a) => a.id)])
      saveDismissedAlerts(newIds)
      return newIds
    })
  }

  // Don't render if no alerts or all dismissed
  if (loading || visibleAlerts.length === 0) {
    return null
  }

  const getSeverityIcon = (severity: Alert['severity']) => {
    switch (severity) {
      case 'critical':
        return <XCircle className="h-4 w-4 text-status-error" />
      case 'error':
        return <AlertTriangle className="h-4 w-4 text-status-error" />
      case 'warning':
        return <AlertCircle className="h-4 w-4 text-status-warning" />
      default:
        return <AlertCircle className="h-4 w-4 text-muted-foreground" />
    }
  }

  const getSeverityBg = (severity: Alert['severity']) => {
    switch (severity) {
      case 'critical':
        return 'bg-status-error/10 border-status-error/30'
      case 'error':
        return 'bg-status-error/10 border-status-error/30'
      case 'warning':
        return 'bg-status-warning/10 border-status-warning/30'
      default:
        return 'bg-muted border-border'
    }
  }

  const criticalCount = visibleAlerts.filter((a) => a.severity === 'critical').length
  const errorCount = visibleAlerts.filter((a) => a.severity === 'error').length
  const warningCount = visibleAlerts.filter((a) => a.severity === 'warning').length

  return (
    <div className="border border-border bg-card">
      {/* Header bar - always visible */}
      <div
        className={cn(
          'flex items-center justify-between px-3 py-2 cursor-pointer',
          criticalCount > 0
            ? 'bg-status-error/10'
            : errorCount > 0
              ? 'bg-status-error/5'
              : 'bg-status-warning/5'
        )}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <AlertTriangle
            className={cn(
              'h-4 w-4',
              criticalCount > 0
                ? 'text-status-error'
                : errorCount > 0
                  ? 'text-status-error'
                  : 'text-status-warning'
            )}
          />
          <span className="text-sm font-medium">
            {visibleAlerts.length} Alert{visibleAlerts.length !== 1 ? 's' : ''}
          </span>
          <div className="flex gap-1">
            {criticalCount > 0 && (
              <Badge className="bg-status-error text-white h-5 text-[10px]">
                {criticalCount} critical
              </Badge>
            )}
            {errorCount > 0 && (
              <Badge className="bg-status-error/80 text-white h-5 text-[10px]">
                {errorCount} error
              </Badge>
            )}
            {warningCount > 0 && (
              <Badge className="bg-status-warning text-black h-5 text-[10px]">
                {warningCount} warning
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={(e) => {
              e.stopPropagation()
              handleDismissAll()
            }}
          >
            Dismiss All
          </Button>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Expanded alerts list */}
      {expanded && (
        <div className="divide-y divide-border max-h-[200px] overflow-y-auto">
          {visibleAlerts.map((alert) => (
            <div
              key={alert.id}
              className={cn(
                'flex items-start justify-between p-3 border-l-2',
                getSeverityBg(alert.severity)
              )}
            >
              <div className="flex items-start gap-3 min-w-0">
                {getSeverityIcon(alert.severity)}
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-medium text-sm">{alert.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(alert.timestamp), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{alert.message}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 shrink-0"
                onClick={() => handleDismiss(alert.id)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
