import { useState, useEffect } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { Panel, PanelHeader, PanelTitle, PanelContent } from '@/components/ui/panel'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { BarChart3 } from 'lucide-react'
import { api } from '@/lib/api'
import type { ChartDataPoint } from '@/hooks/useDashboardStream'

type Period = '7d' | '30d' | '90d'

interface ChartData {
  period: string
  daily: ChartDataPoint[]
}

export function HistoryChart() {
  const [period, setPeriod] = useState<Period>('7d')
  const [data, setData] = useState<ChartDataPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchChartData() {
      setLoading(true)
      try {
        const response = await api.get<ChartData>(`/dashboard/chart-data?period=${period}`)
        if (response.success && response.data) {
          setData(response.data.daily)
        }
      } catch (error) {
        console.error('Failed to fetch chart data:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchChartData()
  }, [period])

  // Format date for X-axis
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-card border border-border p-2 text-xs">
          <p className="font-medium mb-1">{formatDate(label)}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} style={{ color: entry.color }}>
              {entry.name}: {entry.value}
            </p>
          ))}
        </div>
      )
    }
    return null
  }

  return (
    <Panel className="flex flex-col h-full">
      <PanelHeader
        actions={
          <div className="flex gap-1">
            {(['7d', '30d', '90d'] as Period[]).map((p) => (
              <Button
                key={p}
                variant={period === p ? 'default' : 'ghost'}
                size="sm"
                className="h-5 px-2 text-[10px]"
                onClick={(e) => {
                  e.stopPropagation()
                  setPeriod(p)
                }}
              >
                {p}
              </Button>
            ))}
          </div>
        }
      >
        <PanelTitle className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          Backup History
        </PanelTitle>
      </PanelHeader>
      <PanelContent className="p-2 flex-1 min-h-0">
        {loading ? (
          <Skeleton className="h-full w-full" />
        ) : data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            No backup data for this period
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="colorSuccess" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--status-success))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--status-success))" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorFailed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--status-error))" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(var(--status-error))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                axisLine={{ stroke: 'hsl(var(--border))' }}
                tickLine={{ stroke: 'hsl(var(--border))' }}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                axisLine={{ stroke: 'hsl(var(--border))' }}
                tickLine={{ stroke: 'hsl(var(--border))' }}
                allowDecimals={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: '10px' }}
                iconSize={8}
              />
              <Area
                type="monotone"
                dataKey="success"
                name="Success"
                stroke="hsl(var(--status-success))"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorSuccess)"
                animationDuration={800}
                animationEasing="ease-out"
              />
              <Area
                type="monotone"
                dataKey="failed"
                name="Failed"
                stroke="hsl(var(--status-error))"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorFailed)"
                animationDuration={800}
                animationEasing="ease-out"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </PanelContent>
    </Panel>
  )
}
