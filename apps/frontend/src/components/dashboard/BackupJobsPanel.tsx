import { useState, useEffect } from 'react'
import { Panel, PanelHeader, PanelTitle, PanelContent } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { JobFormSheet } from '@/components/JobFormSheet'
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog'
import { FolderSync, Play, Clock, Cloud, Plus, MoreVertical, Edit, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'

interface Job {
  id: string
  name: string
  description?: string
  sourcePath: string
  schedule: string
  enabled: boolean
  destinationId: string
  credentialId: string
  retentionType: string
  retentionCount?: number
  retentionDays?: number
  namePattern?: string
  destination: {
    id: string
    name: string
    provider: string
  }
  credential: {
    id: string
    name: string
    provider: string
  }
}

function parseCronSchedule(schedule: string): string {
  const parts = schedule.split(' ')
  if (parts.length !== 5) return schedule

  const [minute, hour, day, month, weekday] = parts

  if (day === '*' && month === '*' && weekday === '*') {
    if (minute === '0' && hour !== '*') {
      return `Daily ${hour}:00`
    }
    if (hour === '*') {
      return 'Hourly'
    }
    return `Daily ${hour}:${minute.padStart(2, '0')}`
  }

  if (day === '*' && month === '*' && weekday !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const dayName = days[parseInt(weekday)] || weekday
    return `${dayName} ${hour}:${minute.padStart(2, '0')}`
  }

  if (day !== '*' && month === '*') {
    return `Monthly ${day}`
  }

  return schedule
}

export function BackupJobsPanel() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editJob, setEditJob] = useState<Job | null>(null)
  const [deleteJob, setDeleteJob] = useState<Job | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  async function fetchJobs() {
    try {
      const response = await api.get<Job[]>('/jobs')
      if (response.success && response.data) {
        setJobs(response.data)
      }
    } catch (error) {
      console.error('Failed to fetch jobs:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchJobs()
    const interval = setInterval(fetchJobs, 60000)
    return () => clearInterval(interval)
  }, [])

  const handleRunNow = async (jobId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await api.post(`/jobs/${jobId}/run`)
    } catch (error) {
      console.error('Failed to trigger job:', error)
    }
  }

  const handleToggleEnabled = async (job: Job, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await api.patch(`/jobs/${job.id}`, { enabled: !job.enabled })
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, enabled: !j.enabled } : j)))
    } catch (error) {
      console.error('Failed to toggle job:', error)
    }
  }

  const handleDelete = async () => {
    if (!deleteJob) return
    setIsDeleting(true)
    try {
      const response = await api.delete(`/jobs/${deleteJob.id}`)
      if (response.success) {
        setJobs(jobs.filter((j) => j.id !== deleteJob.id))
        setDeleteJob(null)
      }
    } catch (error) {
      console.error('Failed to delete job:', error)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleOpenCreate = () => {
    setEditJob(null)
    setIsFormOpen(true)
  }

  const handleOpenEdit = (job: Job, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditJob(job)
    setIsFormOpen(true)
  }

  const handleOpenDelete = (job: Job, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeleteJob(job)
  }

  return (
    <>
      <Panel className="flex flex-col h-full">
        <PanelHeader
          actions={
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={handleOpenCreate}
            >
              <Plus className="h-3 w-3 mr-1" />
              New
            </Button>
          }
        >
          <PanelTitle className="flex items-center gap-2">
            <FolderSync className="h-4 w-4 text-muted-foreground" />
            Backup Jobs
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
            <div className="flex flex-col items-center justify-center h-full text-center p-4">
              <FolderSync className="h-8 w-8 text-muted-foreground/50 mb-2" />
              <p className="text-xs text-muted-foreground mb-2">No backup jobs</p>
              <Button variant="outline" size="sm" onClick={handleOpenCreate}>
                <Plus className="h-3 w-3 mr-1" />
                Create Job
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-border h-full overflow-y-auto">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  className="flex items-center justify-between p-3 hover:bg-secondary/30 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-medium text-sm truncate">{job.name}</span>
                      {!job.enabled && (
                        <Badge variant="secondary" className="text-[9px] h-4">
                          Disabled
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>{parseCronSchedule(job.schedule)}</span>
                      <span className="text-border">|</span>
                      <Cloud className="h-3 w-3" />
                      <span className="truncate">{job.destination.name}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Switch
                      checked={job.enabled}
                      onCheckedChange={() => {}}
                      onClick={(e) => handleToggleEnabled(job, e)}
                      className="scale-75"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={(e) => handleRunNow(job.id, e)}
                      title="Run now"
                      disabled={!job.enabled}
                    >
                      <Play className="h-3 w-3" />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                          <MoreVertical className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={(e) => handleOpenEdit(job, e as unknown as React.MouseEvent)}
                          className="cursor-pointer text-xs"
                        >
                          <Edit className="mr-2 h-3 w-3" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => handleOpenDelete(job, e as unknown as React.MouseEvent)}
                          className="cursor-pointer text-xs"
                        >
                          <Trash2 className="mr-2 h-3 w-3" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          )}
        </PanelContent>
      </Panel>

      <JobFormSheet
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        onSuccess={fetchJobs}
        editJob={
          editJob
            ? {
                ...editJob,
                retentionType: editJob.retentionType as 'VERSION_COUNT' | 'DAYS' | 'HYBRID',
              }
            : null
        }
      />

      <DeleteConfirmDialog
        open={!!deleteJob}
        onOpenChange={(open) => !open && setDeleteJob(null)}
        onConfirm={handleDelete}
        isDeleting={isDeleting}
        title="Delete Backup Job?"
        description="This will permanently delete this backup job and all its history."
        itemName={deleteJob?.name}
      />
    </>
  )
}
