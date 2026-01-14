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
import { api } from '@/lib/api'
import { Loader2, HardDrive, ChevronLeft, Check } from 'lucide-react'

interface Credential {
  id: string
  name: string
  provider: string
}

interface AvailableDestination {
  id: string
  name: string
  provider: string
  metadata?: unknown
}

interface DestinationFormSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function DestinationFormSheet({ open, onOpenChange, onSuccess }: DestinationFormSheetProps) {
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [selectedCredentialId, setSelectedCredentialId] = useState('')
  const [availableDestinations, setAvailableDestinations] = useState<AvailableDestination[]>([])
  const [selectedDestination, setSelectedDestination] = useState<AvailableDestination | null>(null)
  const [customName, setCustomName] = useState('')
  const [newDriveName, setNewDriveName] = useState('')

  const [isLoadingCredentials, setIsLoadingCredentials] = useState(true)
  const [isLoadingDestinations, setIsLoadingDestinations] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCreatingDrive, setIsCreatingDrive] = useState(false)

  const [step, setStep] = useState<'select-credential' | 'select-destination' | 'confirm'>(
    'select-credential'
  )

  useEffect(() => {
    if (open) {
      fetchCredentials()
      setSelectedCredentialId('')
      setAvailableDestinations([])
      setSelectedDestination(null)
      setCustomName('')
      setNewDriveName('')
      setStep('select-credential')
    }
  }, [open])

  async function fetchCredentials() {
    setIsLoadingCredentials(true)
    try {
      const response = await api.get<Credential[]>('/credentials')
      if (response.success && response.data) {
        setCredentials(response.data)
      }
    } catch (error) {
      console.error('Failed to fetch credentials:', error)
    } finally {
      setIsLoadingCredentials(false)
    }
  }

  async function handleCredentialSelect(credentialId: string) {
    setSelectedCredentialId(credentialId)
    setIsLoadingDestinations(true)
    setAvailableDestinations([])

    try {
      const response = await api.get<AvailableDestination[]>(`/destinations/browse/${credentialId}`)
      if (response.success && response.data) {
        setAvailableDestinations(response.data)
        setStep('select-destination')
      }
    } catch (error) {
      console.error('Failed to fetch available destinations:', error)
    } finally {
      setIsLoadingDestinations(false)
    }
  }

  function handleDestinationSelect(destination: AvailableDestination) {
    setSelectedDestination(destination)
    setCustomName(destination.name)
    setStep('confirm')
  }

  async function handleCreateDrive(e: React.FormEvent) {
    e.preventDefault()
    if (!newDriveName.trim() || !selectedCredentialId) return

    setIsCreatingDrive(true)
    try {
      const response = await api.post<AvailableDestination>(
        `/destinations/create-drive/${selectedCredentialId}`,
        {
          name: newDriveName.trim(),
        }
      )

      if (response.success && response.data) {
        setAvailableDestinations([response.data, ...availableDestinations])
        setNewDriveName('')
        handleDestinationSelect(response.data)
      }
    } catch (error) {
      console.error('Failed to create Shared Drive:', error)
    } finally {
      setIsCreatingDrive(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedDestination || !selectedCredentialId) return

    setIsSubmitting(true)
    try {
      const selectedCredential = credentials.find((c) => c.id === selectedCredentialId)
      if (!selectedCredential) return

      const response = await api.post('/destinations', {
        credentialId: selectedCredentialId,
        provider: selectedCredential.provider,
        remoteId: selectedDestination.id,
        name: customName || selectedDestination.name,
      })

      if (response.success) {
        onSuccess()
        onOpenChange(false)
      }
    } catch (error) {
      console.error('Failed to save destination:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  function getProviderIcon(provider: string) {
    const iconMap: Record<string, { src: string; alt: string }> = {
      google_drive: { src: '/icons/google_drive.svg', alt: 'Google Drive' },
      google_drive_shared: { src: '/icons/google_drive.svg', alt: 'Google Drive' },
      google_drive_my_drive: { src: '/icons/google_drive.svg', alt: 'Google Drive' },
      google_cloud_storage: { src: '/icons/google_cloud_storage.svg', alt: 'Google Cloud Storage' },
      s3: { src: '/icons/amazon_s3.svg', alt: 'Amazon S3' },
      cloudflare_r2: { src: '/icons/cloudflare_r2.svg', alt: 'Cloudflare R2' },
      digitalocean_spaces: { src: '/icons/digitalocean_spaces.svg', alt: 'DigitalOcean Spaces' },
    }

    const icon = iconMap[provider]
    if (icon) {
      return <img src={icon.src} alt={icon.alt} className="w-5 h-5" />
    }
    return <HardDrive className="h-5 w-5 text-muted-foreground" />
  }

  function getProviderDisplayName(provider: string): string {
    const names: Record<string, string> = {
      google_drive: 'Google Drive (Shared)',
      google_drive_shared: 'Google Drive (Shared)',
      google_drive_my_drive: 'Google Drive (My Drive)',
      google_cloud_storage: 'Google Cloud Storage',
      s3: 'Amazon S3',
      cloudflare_r2: 'Cloudflare R2',
      digitalocean_spaces: 'DigitalOcean Spaces',
    }
    return names[provider] || provider
  }

  function getDestinationTypeLabel(provider: string): string {
    const labels: Record<string, string> = {
      google_drive: 'Shared Drive',
      google_drive_shared: 'Shared Drive',
      google_drive_my_drive: 'My Drive',
      google_cloud_storage: 'Bucket',
      s3: 'Bucket',
      cloudflare_r2: 'Bucket',
      digitalocean_spaces: 'Space',
    }
    return labels[provider] || 'Destination'
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="lg" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add Storage Destination</SheetTitle>
          <SheetDescription>
            Browse and select a storage destination from your connected accounts
          </SheetDescription>
        </SheetHeader>

        <div className="py-6">
          {step === 'select-credential' && (
            <div className="space-y-4">
              <Label>Select Credential</Label>
              {isLoadingCredentials ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : credentials.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground border border-border p-6">
                  <p>No credentials found. Add a credential first.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {credentials.map((cred) => (
                    <button
                      key={cred.id}
                      className="w-full flex items-center gap-3 p-3 border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary transition-colors text-left"
                      onClick={() => handleCredentialSelect(cred.id)}
                    >
                      {getProviderIcon(cred.provider)}
                      <div>
                        <div className="font-medium text-sm">{cred.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {getProviderDisplayName(cred.provider)}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 'select-destination' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setStep('select-credential')}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Label>Select Destination</Label>
              </div>

              {isLoadingDestinations ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  <p className="ml-2 text-muted-foreground">Loading destinations...</p>
                </div>
              ) : (
                <>
                  {/* Create New Shared Drive Form */}
                  <div className="border border-border p-3 bg-secondary/30">
                    <form onSubmit={handleCreateDrive} className="space-y-3">
                      <div>
                        <Label htmlFor="newDriveName" className="text-xs">
                          Create New Shared Drive
                        </Label>
                      </div>
                      <div className="flex gap-2">
                        <Input
                          id="newDriveName"
                          value={newDriveName}
                          onChange={(e) => setNewDriveName(e.target.value)}
                          placeholder="Enter shared drive name..."
                          disabled={isCreatingDrive}
                          className="flex-1"
                        />
                        <Button
                          type="submit"
                          disabled={!newDriveName.trim() || isCreatingDrive}
                          size="sm"
                        >
                          {isCreatingDrive ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            'Create'
                          )}
                        </Button>
                      </div>
                    </form>
                  </div>

                  {/* Existing Shared Drives */}
                  {availableDestinations.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground border border-border p-6">
                      <p className="text-sm">No shared drives found.</p>
                      <p className="text-xs mt-1">Create one above.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">Or Select Existing</Label>
                      {availableDestinations.map((dest) => (
                        <button
                          key={dest.id}
                          className="w-full flex items-center gap-3 p-3 border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary transition-colors text-left"
                          onClick={() => handleDestinationSelect(dest)}
                        >
                          {getProviderIcon(dest.provider)}
                          <div className="flex-1">
                            <div className="font-medium text-sm">{dest.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {getDestinationTypeLabel(dest.provider)}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {step === 'confirm' && selectedDestination && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setStep('select-destination')}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Label>Confirm Destination</Label>
              </div>

              <div className="flex items-center gap-3 p-3 border border-primary bg-primary/10">
                {getProviderIcon(selectedDestination.provider)}
                <div className="flex-1">
                  <div className="font-medium text-sm">{selectedDestination.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {getDestinationTypeLabel(selectedDestination.provider)}
                  </div>
                </div>
                <Check className="h-4 w-4 text-primary" />
              </div>

              <div>
                <Label htmlFor="name">Display Name (Optional)</Label>
                <Input
                  id="name"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder={selectedDestination.name}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Custom name for this destination
                </p>
              </div>

              <SheetFooter className="pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep('select-destination')}
                >
                  Back
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    'Add Destination'
                  )}
                </Button>
              </SheetFooter>
            </form>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
