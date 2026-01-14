import { useState, useEffect } from 'react'
import { Panel, PanelHeader, PanelTitle, PanelContent } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Calendar, Clock, Cloud, Play } from 'lucide-react'
import { api } from '@/lib/api'
import type { UpcomingJob } from '@/hooks/useDashboardStream'

function formatCountdown(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`
  }
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60)
    return `${mins}m`
  }
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  }
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  return hours > 0 ? `${days}d ${hours}h` : `${days}d`
}

function parseCronSchedule(schedule: string): string {
  const parts = schedule.split(' ')
  if (parts.length !== 5) return schedule

  const [minute, hour, day, month, weekday] = parts

  // Daily at specific time
  if (day === '*' && month === '*' && weekday === '*') {
    if (minute === '0' && hour !== '*') {
      return `Daily at ${hour}:00`
    }
    if (hour === '*') {
      return 'Every hour'
    }
    return `Daily at ${hour}:${minute.padStart(2, '0')}`
  }

  // Weekly
  if (day === '*' && month === '*' && weekday !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const dayName = days[parseInt(weekday)] || weekday
    return `${dayName} at ${hour}:${minute.padStart(2, '0')}`
  }

  // Monthly
  if (day !== '*' && month === '*') {
    return `Day ${day} at ${hour}:${minute.padStart(2, '0')}`
  }

  return schedule
}

interface UpcomingJobData {
  jobs: UpcomingJob[]
}

export function UpcomingJobsPanel() {
  const [jobs, setJobs] = useState<UpcomingJob[]>([])
  const [loading, setLoading] = useState(true)
  const [countdowns, setCountdowns] = useState<Map<string, number>>(new Map())

  useEffect(() => {
    async function fetchUpcoming() {
      try {
        const response = await api.get<UpcomingJobData>('/dashboard/upcoming')
        if (response.success && response.data) {
          setJobs(response.data.jobs)
          // Initialize countdowns
          const newCountdowns = new Map<string, number>()
          for (const job of response.data.jobs) {
            newCountdowns.set(job.id, job.nextRunIn)
          }
          setCountdowns(newCountdowns)
        }
      } catch (error) {
        console.error('Failed to fetch upcoming jobs:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchUpcoming()
    // Refresh every minute
    const fetchInterval = setInterval(fetchUpcoming, 60000)
    return () => clearInterval(fetchInterval)
  }, [])

  // Update countdowns every second
  useEffect(() => {
    const interval = setInterval(() => {
      setCountdowns((prev) => {
        const next = new Map(prev)
        for (const [id, value] of next) {
          next.set(id, Math.max(0, value - 1))
        }
        return next
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  const handleRunNow = async (jobId: string) => {
    try {
      await api.post(`/jobs/${jobId}/run`)
    } catch (error) {
      console.error('Failed to trigger job:', error)
    }
  }

  return (
    <Panel className="flex flex-col h-full">
      <PanelHeader>
        <PanelTitle className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          Upcoming Backups
        </PanelTitle>
      </PanelHeader>
      <PanelContent className="p-0 flex-1 min-h-0">
        {loading ? (
          <div className="p-3 space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Calendar className="h-8 w-8 text-muted-foreground/50 mb-2" />
            <p className="text-xs text-muted-foreground">No scheduled backups</p>
          </div>
        ) : (
          <div className="divide-y divide-border h-full overflow-y-auto">
            {jobs.map((job) => {
              const countdown = countdowns.get(job.id) ?? job.nextRunIn

              return (
                <div key={job.id} className="flex items-center justify-between p-3 hover:bg-secondary/30 transition-colors group">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-medium text-sm truncate">{job.name}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>{parseCronSchedule(job.schedule)}</span>
                      <span className="text-border">|</span>
                      <Cloud className="h-3 w-3" />
                      <span className="truncate">{job.destination.name}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right">
                      <div className="text-sm font-mono text-primary">
                        {formatCountdown(countdown)}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => handleRunNow(job.id)}
                      title="Run now"
                    >
                      <Play className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </PanelContent>
    </Panel>
  )
}
