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
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { api } from '@/lib/api'
import { Loader2, ChevronLeft, Key } from 'lucide-react'

type StorageProvider =
  | 'google_drive_shared'
  | 'google_drive_my_drive'
  | 'google_cloud_storage'
  | 's3'
  | 'cloudflare_r2'
  | 'digitalocean_spaces'

interface ProviderConfig {
  id: StorageProvider
  name: string
  description: string
  authType: 'oauth' | 'api_key' | 'service_account'
  icon: string
  fields?: FieldConfig[]
}

interface FieldConfig {
  key: string
  label: string
  type: 'text' | 'password' | 'select' | 'textarea'
  placeholder?: string
  required: boolean
  options?: { value: string; label: string }[]
}

const PROVIDER_CONFIGS: ProviderConfig[] = [
  {
    id: 'google_drive_shared',
    name: 'Google Drive (Shared)',
    description: 'Access Shared Drives via Google OAuth',
    authType: 'oauth',
    icon: '/icons/google_drive.svg',
  },
  {
    id: 'google_drive_my_drive',
    name: 'Google Drive (My Drive)',
    description: 'Access your personal Google Drive via OAuth',
    authType: 'oauth',
    icon: '/icons/google_drive.svg',
  },
  {
    id: 'google_cloud_storage',
    name: 'Google Cloud Storage',
    description: 'Use a service account JSON key',
    authType: 'service_account',
    icon: '/icons/google_cloud_storage.svg',
    fields: [
      {
        key: 'name',
        label: 'Credential Name',
        type: 'text',
        placeholder: 'My GCS Account',
        required: true,
      },
      {
        key: 'serviceAccountJson',
        label: 'Service Account JSON',
        type: 'textarea',
        placeholder: 'Paste your service account JSON key here...',
        required: true,
      },
    ],
  },
  {
    id: 's3',
    name: 'Amazon S3',
    description: 'Use IAM access keys',
    authType: 'api_key',
    icon: '/icons/amazon_s3.svg',
    fields: [
      {
        key: 'name',
        label: 'Credential Name',
        type: 'text',
        placeholder: 'My S3 Account',
        required: true,
      },
      {
        key: 'accessKeyId',
        label: 'Access Key ID',
        type: 'text',
        placeholder: 'AKIAIOSFODNN7EXAMPLE',
        required: true,
      },
      {
        key: 'secretAccessKey',
        label: 'Secret Access Key',
        type: 'password',
        placeholder: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        required: true,
      },
      {
        key: 'region',
        label: 'Region',
        type: 'select',
        required: true,
        options: [
          { value: 'us-east-1', label: 'US East (N. Virginia)' },
          { value: 'us-east-2', label: 'US East (Ohio)' },
          { value: 'us-west-1', label: 'US West (N. California)' },
          { value: 'us-west-2', label: 'US West (Oregon)' },
          { value: 'eu-west-1', label: 'EU (Ireland)' },
          { value: 'eu-west-2', label: 'EU (London)' },
          { value: 'eu-west-3', label: 'EU (Paris)' },
          { value: 'eu-central-1', label: 'EU (Frankfurt)' },
          { value: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)' },
          { value: 'ap-northeast-2', label: 'Asia Pacific (Seoul)' },
          { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
          { value: 'ap-southeast-2', label: 'Asia Pacific (Sydney)' },
          { value: 'ap-south-1', label: 'Asia Pacific (Mumbai)' },
          { value: 'sa-east-1', label: 'South America (Sao Paulo)' },
        ],
      },
    ],
  },
  {
    id: 'cloudflare_r2',
    name: 'Cloudflare R2',
    description: 'Use R2 API tokens',
    authType: 'api_key',
    icon: '/icons/cloudflare_r2.svg',
    fields: [
      {
        key: 'name',
        label: 'Credential Name',
        type: 'text',
        placeholder: 'My R2 Account',
        required: true,
      },
      {
        key: 'accountId',
        label: 'Account ID',
        type: 'text',
        placeholder: 'Your Cloudflare Account ID',
        required: true,
      },
      {
        key: 'accessKeyId',
        label: 'Access Key ID',
        type: 'text',
        placeholder: 'R2 Access Key ID',
        required: true,
      },
      {
        key: 'secretAccessKey',
        label: 'Secret Access Key',
        type: 'password',
        placeholder: 'R2 Secret Access Key',
        required: true,
      },
    ],
  },
  {
    id: 'digitalocean_spaces',
    name: 'DigitalOcean Spaces',
    description: 'Use Spaces access keys',
    authType: 'api_key',
    icon: '/icons/digitalocean_spaces.svg',
    fields: [
      {
        key: 'name',
        label: 'Credential Name',
        type: 'text',
        placeholder: 'My Spaces Account',
        required: true,
      },
      {
        key: 'accessKeyId',
        label: 'Access Key',
        type: 'text',
        placeholder: 'Spaces Access Key',
        required: true,
      },
      {
        key: 'secretAccessKey',
        label: 'Secret Key',
        type: 'password',
        placeholder: 'Spaces Secret Key',
        required: true,
      },
      {
        key: 'region',
        label: 'Region',
        type: 'select',
        required: true,
        options: [
          { value: 'nyc3', label: 'New York (NYC3)' },
          { value: 'sfo3', label: 'San Francisco (SFO3)' },
          { value: 'ams3', label: 'Amsterdam (AMS3)' },
          { value: 'sgp1', label: 'Singapore (SGP1)' },
          { value: 'fra1', label: 'Frankfurt (FRA1)' },
          { value: 'syd1', label: 'Sydney (SYD1)' },
        ],
      },
    ],
  },
]

interface CredentialFormSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  initialProvider?: StorageProvider
}

export function CredentialFormSheet({
  open,
  onOpenChange,
  onSuccess,
  initialProvider,
}: CredentialFormSheetProps) {
  const [selectedProvider, setSelectedProvider] = useState<ProviderConfig | null>(null)
  const [formData, setFormData] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<'select-provider' | 'form'>('select-provider')

  useEffect(() => {
    if (open) {
      setFormData({})
      setError(null)
      if (initialProvider) {
        const config = PROVIDER_CONFIGS.find((p) => p.id === initialProvider)
        if (config) {
          setSelectedProvider(config)
          setStep(config.authType === 'oauth' ? 'select-provider' : 'form')
        }
      } else {
        setSelectedProvider(null)
        setStep('select-provider')
      }
    }
  }, [open, initialProvider])

  function getProviderIcon(provider: string) {
    const config = PROVIDER_CONFIGS.find((p) => p.id === provider)
    if (config) {
      return <img src={config.icon} alt={config.name} className="w-5 h-5" />
    }
    return <Key className="h-5 w-5 text-muted-foreground" />
  }

  async function handleProviderSelect(provider: ProviderConfig) {
    setSelectedProvider(provider)
    setError(null)

    if (provider.authType === 'oauth') {
      // Redirect to OAuth flow
      try {
        const response = await api.post<{ authUrl: string }>('/credentials/google-drive/auth', {
          provider: provider.id,
        })
        if (response.success && response.data) {
          window.location.href = response.data.authUrl
        }
      } catch (error) {
        console.error('Failed to initiate OAuth:', error)
        setError('Failed to initiate OAuth flow')
      }
    } else {
      setStep('form')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedProvider) return

    setIsSubmitting(true)
    setError(null)

    try {
      let endpoint = ''
      let payload: Record<string, string> = {}

      if (selectedProvider.authType === 'service_account') {
        endpoint = '/credentials/service-account'
        payload = {
          name: formData.name,
          provider: selectedProvider.id,
          serviceAccountJson: formData.serviceAccountJson,
        }
      } else if (selectedProvider.authType === 'api_key') {
        endpoint = '/credentials/api-key'
        payload = {
          name: formData.name,
          provider: selectedProvider.id,
          accessKeyId: formData.accessKeyId,
          secretAccessKey: formData.secretAccessKey,
        }

        // Add provider-specific fields
        if (formData.region) {
          payload.region = formData.region
        }
        if (formData.accountId) {
          payload.accountId = formData.accountId
        }
      }

      const response = await api.post(endpoint, payload)

      if (response.success) {
        onSuccess()
        onOpenChange(false)
      } else {
        setError(response.error || 'Failed to create credential')
      }
    } catch (error) {
      console.error('Failed to create credential:', error)
      setError('Failed to create credential')
    } finally {
      setIsSubmitting(false)
    }
  }

  function renderField(field: FieldConfig) {
    if (field.type === 'select' && field.options) {
      return (
        <Select
          value={formData[field.key] || ''}
          onValueChange={(value) => setFormData({ ...formData, [field.key]: value })}
        >
          <SelectTrigger>
            <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }

    if (field.type === 'textarea') {
      return (
        <Textarea
          id={field.key}
          value={formData[field.key] || ''}
          onChange={(e) => setFormData({ ...formData, [field.key]: e.target.value })}
          placeholder={field.placeholder}
          required={field.required}
          rows={6}
          className="font-mono text-xs"
        />
      )
    }

    return (
      <Input
        id={field.key}
        type={field.type}
        value={formData[field.key] || ''}
        onChange={(e) => setFormData({ ...formData, [field.key]: e.target.value })}
        placeholder={field.placeholder}
        required={field.required}
      />
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="lg" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add Cloud Storage Credential</SheetTitle>
          <SheetDescription>
            Connect a cloud storage account to use as a backup destination
          </SheetDescription>
        </SheetHeader>

        <div className="py-6">
          {step === 'select-provider' && (
            <div className="space-y-4">
              <Label>Select Provider</Label>
              <div className="grid gap-2">
                {PROVIDER_CONFIGS.map((provider) => (
                  <button
                    key={provider.id}
                    className="w-full flex items-center gap-3 p-3 border border-border bg-secondary/30 hover:bg-secondary/50 hover:border-primary transition-colors text-left"
                    onClick={() => handleProviderSelect(provider)}
                  >
                    {getProviderIcon(provider.id)}
                    <div className="flex-1">
                      <div className="font-medium text-sm">{provider.name}</div>
                      <div className="text-xs text-muted-foreground">{provider.description}</div>
                    </div>
                    {provider.authType === 'oauth' && (
                      <span className="text-xs text-muted-foreground px-2 py-1 bg-secondary rounded">
                        OAuth
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          )}

          {step === 'form' && selectedProvider && selectedProvider.fields && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => {
                    setStep('select-provider')
                    setSelectedProvider(null)
                    setFormData({})
                    setError(null)
                  }}
                  type="button"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="flex items-center gap-2">
                  {getProviderIcon(selectedProvider.id)}
                  <Label>{selectedProvider.name}</Label>
                </div>
              </div>

              {selectedProvider.fields.map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={field.key}>
                    {field.label}
                    {field.required && <span className="text-destructive ml-1">*</span>}
                  </Label>
                  {renderField(field)}
                </div>
              ))}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <SheetFooter className="pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setStep('select-provider')
                    setSelectedProvider(null)
                    setFormData({})
                  }}
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
                    'Add Credential'
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
