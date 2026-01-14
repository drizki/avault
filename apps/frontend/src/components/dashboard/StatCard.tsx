import { LucideIcon } from 'lucide-react'
import { Panel, PanelHeader, PanelTitle, PanelContent } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface StatCardProps {
  icon: LucideIcon
  label: string
  value: string | number
  subValue?: string
  trend?: {
    direction: 'up' | 'down' | 'flat'
    value: string
    positive?: boolean
  }
  status?: 'normal' | 'warning' | 'error' | 'success'
  loading?: boolean
}

export function StatCard({
  icon: Icon,
  label,
  value,
  subValue,
  trend,
  status = 'normal',
  loading = false,
}: StatCardProps) {
  const statusColors = {
    normal: 'text-primary',
    warning: 'text-status-warning',
    error: 'text-status-error',
    success: 'text-status-success',
  }

  const trendColors = {
    up: trend?.positive ? 'text-status-success' : 'text-status-error',
    down: trend?.positive ? 'text-status-success' : 'text-status-error',
    flat: 'text-muted-foreground',
  }

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {label}
        </PanelTitle>
      </PanelHeader>
      <PanelContent className="pt-1 pb-2">
        {loading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                'text-2xl font-bold font-mono transition-all duration-200',
                statusColors[status]
              )}
            >
              {value}
            </span>
            {subValue && <span className="text-xs text-muted-foreground">{subValue}</span>}
            {trend && (
              <span className={cn('text-xs font-medium', trendColors[trend.direction])}>
                {trend.direction === 'up' && '\u2191'}
                {trend.direction === 'down' && '\u2193'}
                {trend.value}
              </span>
            )}
          </div>
        )}
      </PanelContent>
    </Panel>
  )
}
