import { useState, useEffect } from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { api } from '@/lib/api'
import { Loader2 } from 'lucide-react'
import { FolderTree } from '@/components/FolderTree'
import { EnableJobDialog } from '@/components/EnableJobDialog'

interface Destination {
  id: string
  name: string
  provider: string
  remoteId: string
}

interface Credential {
  id: string
  name: string
  provider: string
}

interface JobFormData {
  name: string
  sourcePath: string
  destinationId: string
  credentialId: string
  schedule: string
  retentionType: 'VERSION_COUNT' | 'DAYS' | 'HYBRID'
  retentionCount?: number
  retentionDays?: number
  namePattern: string
  enabled: boolean
}

interface CreatedJob {
  id: string
  name: string
}

interface EditJob {
  id: string
  name: string
  sourcePath: string
  destinationId: string
  credentialId: string
  schedule: string
  retentionType: 'VERSION_COUNT' | 'DAYS' | 'HYBRID'
  retentionCount?: number
  retentionDays?: number
  namePattern?: string
  enabled: boolean
}

interface JobFormSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  editJob?: EditJob | null
}

const SCHEDULE_PRESETS = [
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Daily at 2 AM', value: '0 2 * * *' },
  { label: 'Daily at midnight', value: '0 0 * * *' },
  { label: 'Weekly (Sunday 2 AM)', value: '0 2 * * 0' },
  { label: 'Monthly (1st at 2 AM)', value: '0 2 1 * *' },
  { label: 'Custom', value: 'custom' },
]

export function JobFormSheet({ open, onOpenChange, onSuccess, editJob }: JobFormSheetProps) {
  const [destinations, setDestinations] = useState<Destination[]>([])
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [isLoadingData, setIsLoadingData] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [schedulePreset, setSchedulePreset] = useState('0 2 * * *')

  // For enable job dialog after creation
  const [createdJob, setCreatedJob] = useState<CreatedJob | null>(null)
  const [showEnableDialog, setShowEnableDialog] = useState(false)
  const [isEnabling, setIsEnabling] = useState(false)

  const [formData, setFormData] = useState<JobFormData>({
    name: '',
    sourcePath: '',
    destinationId: '',
    credentialId: '',
    schedule: '0 2 * * *',
    retentionType: 'VERSION_COUNT',
    retentionCount: 7,
    namePattern: 'backup-{date}-{hash}',
    enabled: true, // Will be overridden to false for new jobs
  })

  useEffect(() => {
    if (open) {
      fetchData()
      if (editJob) {
        setFormData({
          name: editJob.name,
          sourcePath: editJob.sourcePath,
          destinationId: editJob.destinationId,
          credentialId: editJob.credentialId,
          schedule: editJob.schedule,
          retentionType: editJob.retentionType,
          retentionCount: editJob.retentionCount,
          retentionDays: editJob.retentionDays,
          namePattern: editJob.namePattern || 'backup-{date}-{hash}',
          enabled: editJob.enabled,
        })
        setSchedulePreset(
          SCHEDULE_PRESETS.find((p) => p.value === editJob.schedule)?.value || 'custom'
        )
      } else {
        setFormData({
          name: '',
          sourcePath: '',
          destinationId: '',
          credentialId: '',
          schedule: '0 2 * * *',
          retentionType: 'VERSION_COUNT',
          retentionCount: 7,
          namePattern: 'backup-{date}-{hash}',
          enabled: true,
        })
        setSchedulePreset('0 2 * * *')
      }
    }
  }, [open, editJob])

  async function fetchData() {
    setIsLoadingData(true)
    try {
      const [destResponse, credResponse] = await Promise.all([
        api.get<Destination[]>('/destinations'),
        api.get<Credential[]>('/credentials'),
      ])

      if (destResponse.success && destResponse.data) {
        setDestinations(destResponse.data)
      }
      if (credResponse.success && credResponse.data) {
        setCredentials(credResponse.data)
      }
    } catch (error) {
      console.error('Failed to fetch data:', error)
    } finally {
      setIsLoadingData(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      const payload = {
        ...formData,
        // For new jobs, create as disabled - will ask user to enable after
        enabled: editJob ? formData.enabled : false,
        retentionCount:
          formData.retentionType === 'VERSION_COUNT' || formData.retentionType === 'HYBRID'
            ? formData.retentionCount
            : undefined,
        retentionDays:
          formData.retentionType === 'DAYS' || formData.retentionType === 'HYBRID'
            ? formData.retentionDays
            : undefined,
      }

      let response
      if (editJob) {
        response = await api.patch(`/jobs/${editJob.id}`, payload)
        if (response.success) {
          onSuccess()
          onOpenChange(false)
        }
      } else {
        response = await api.post<CreatedJob>('/jobs', payload)
        if (response.success && response.data) {
          // Show enable dialog for new jobs
          setCreatedJob(response.data)
          setShowEnableDialog(true)
        }
      }
    } catch (error) {
      console.error('Failed to save job:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleEnableJob() {
    if (!createdJob) return
    setIsEnabling(true)
    try {
      await api.patch(`/jobs/${createdJob.id}`, { enabled: true })
      onSuccess()
      onOpenChange(false)
      setShowEnableDialog(false)
      setCreatedJob(null)
    } catch (error) {
      console.error('Failed to enable job:', error)
    } finally {
      setIsEnabling(false)
    }
  }

  function handleSkipEnable() {
    onSuccess()
    onOpenChange(false)
    setShowEnableDialog(false)
    setCreatedJob(null)
  }

  // Filter destinations by selected credential
  const filteredDestinations = formData.credentialId
    ? destinations.filter((d) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dest = d as any
        return (
          dest.credentialId === formData.credentialId ||
          dest.credential?.id === formData.credentialId
        )
      })
    : []

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent size="lg" className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editJob ? 'Edit Backup Job' : 'Create Backup Job'}</SheetTitle>
            <SheetDescription>
              Configure your backup job settings. The job will run automatically based on the
              schedule.
            </SheetDescription>
          </SheetHeader>

          {isLoadingData ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6 py-6">
              {/* Job Name */}
              <div>
                <Label htmlFor="name">Job Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="My Daily Backup"
                  required
                />
              </div>

              {/* Source Path - NAS Folder Tree */}
              <div>
                <Label htmlFor="sourcePath">Source Folder *</Label>
                <FolderTree
                  type="nas"
                  value={formData.sourcePath}
                  onChange={(path) => setFormData({ ...formData, sourcePath: path })}
                  placeholder="Select folder to backup..."
                />
                <p className="text-xs text-muted-foreground mt-1">Folder on your NAS to backup</p>
              </div>

              {/* Storage Credential - Must select first */}
              <div>
                <Label htmlFor="credential">Storage Credential *</Label>
                <Select
                  value={formData.credentialId}
                  onValueChange={(value) =>
                    setFormData({
                      ...formData,
                      credentialId: value,
                      destinationId: '', // Reset destination when credential changes
                    })
                  }
                  required
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select credential" />
                  </SelectTrigger>
                  <SelectContent>
                    {credentials.map((cred) => (
                      <SelectItem key={cred.id} value={cred.id}>
                        {cred.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Select credential first to see available destinations
                </p>
              </div>

              {/* Destination - Only enabled after credential selection */}
              <div>
                <Label htmlFor="destination">Destination *</Label>
                <Select
                  value={formData.destinationId}
                  onValueChange={(value) => setFormData({ ...formData, destinationId: value })}
                  required
                  disabled={!formData.credentialId}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        formData.credentialId ? 'Select destination' : 'Select credential first'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredDestinations.length > 0 ? (
                      filteredDestinations.map((dest) => (
                        <SelectItem key={dest.id} value={dest.id}>
                          {dest.name}
                        </SelectItem>
                      ))
                    ) : formData.credentialId ? (
                      <div className="px-2 py-1 text-sm text-muted-foreground">
                        No destinations for this credential
                      </div>
                    ) : null}
                  </SelectContent>
                </Select>
              </div>

              {/* Schedule */}
              <div>
                <Label htmlFor="schedule-preset">Schedule *</Label>
                <Select
                  value={schedulePreset}
                  onValueChange={(value) => {
                    setSchedulePreset(value)
                    if (value !== 'custom') {
                      setFormData({ ...formData, schedule: value })
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCHEDULE_PRESETS.map((preset) => (
                      <SelectItem key={preset.value} value={preset.value}>
                        {preset.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {schedulePreset === 'custom' && (
                  <Input
                    className="mt-2"
                    value={formData.schedule}
                    onChange={(e) => setFormData({ ...formData, schedule: e.target.value })}
                    placeholder="0 2 * * *"
                  />
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  Cron format: minute hour day month weekday
                </p>
              </div>

              {/* Retention */}
              <div className="space-y-4">
                <div>
                  <Label htmlFor="retentionType">Retention Policy *</Label>
                  <Select
                    value={formData.retentionType}
                    onValueChange={(value: string) =>
                      setFormData({
                        ...formData,
                        retentionType: value as 'VERSION_COUNT' | 'DAYS' | 'HYBRID',
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="VERSION_COUNT">Keep last N versions</SelectItem>
                      <SelectItem value="DAYS">Keep backups for N days</SelectItem>
                      <SelectItem value="HYBRID">Both version count and days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {(formData.retentionType === 'VERSION_COUNT' ||
                    formData.retentionType === 'HYBRID') && (
                    <div>
                      <Label htmlFor="retentionCount">Version Count</Label>
                      <Input
                        id="retentionCount"
                        type="number"
                        min="1"
                        value={formData.retentionCount || ''}
                        onChange={(e) =>
                          setFormData({ ...formData, retentionCount: parseInt(e.target.value) })
                        }
                        required
                      />
                    </div>
                  )}

                  {(formData.retentionType === 'DAYS' || formData.retentionType === 'HYBRID') && (
                    <div>
                      <Label htmlFor="retentionDays">Days to Keep</Label>
                      <Input
                        id="retentionDays"
                        type="number"
                        min="1"
                        value={formData.retentionDays || ''}
                        onChange={(e) =>
                          setFormData({ ...formData, retentionDays: parseInt(e.target.value) })
                        }
                        required
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Backup Name Pattern */}
              <div>
                <Label htmlFor="namePattern">Backup Name Pattern</Label>
                <Input
                  id="namePattern"
                  value={formData.namePattern}
                  onChange={(e) => setFormData({ ...formData, namePattern: e.target.value })}
                  placeholder="backup-{date}-{hash}"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Available: {'{date}'}, {'{datetime}'}, {'{hash}'}, {'{year}'}, {'{month}'},{' '}
                  {'{day}'}
                </p>
              </div>

              <SheetFooter className="pt-4">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : editJob ? (
                    'Update Job'
                  ) : (
                    'Create Job'
                  )}
                </Button>
              </SheetFooter>
            </form>
          )}
        </SheetContent>
      </Sheet>

      {/* Enable Job Dialog - shown after creating a new job */}
      <EnableJobDialog
        open={showEnableDialog}
        onOpenChange={setShowEnableDialog}
        jobName={createdJob?.name || ''}
        onEnable={handleEnableJob}
        onSkip={handleSkipEnable}
        isEnabling={isEnabling}
      />
    </>
  )
}
