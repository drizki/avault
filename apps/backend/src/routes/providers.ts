import { Hono } from 'hono'
import type { Env } from '../index'

const providers = new Hono<Env>()

/**
 * Provider configuration for frontend UI.
 */
interface ProviderField {
  name: string
  label: string
  type: 'text' | 'password' | 'textarea' | 'select'
  placeholder?: string
  options?: { value: string; label: string }[]
  required?: boolean
}

interface ProviderConfig {
  id: string
  name: string
  icon: string
  authType: 'oauth' | 'api_key' | 'service_account'
  description: string
  features: string[]
  fields?: ProviderField[]
}

// AWS S3 regions
const AWS_REGIONS = [
  { value: 'us-east-1', label: 'US East (N. Virginia)' },
  { value: 'us-east-2', label: 'US East (Ohio)' },
  { value: 'us-west-1', label: 'US West (N. California)' },
  { value: 'us-west-2', label: 'US West (Oregon)' },
  { value: 'eu-west-1', label: 'Europe (Ireland)' },
  { value: 'eu-west-2', label: 'Europe (London)' },
  { value: 'eu-west-3', label: 'Europe (Paris)' },
  { value: 'eu-central-1', label: 'Europe (Frankfurt)' },
  { value: 'eu-north-1', label: 'Europe (Stockholm)' },
  { value: 'ap-northeast-1', label: 'Asia Pacific (Tokyo)' },
  { value: 'ap-northeast-2', label: 'Asia Pacific (Seoul)' },
  { value: 'ap-northeast-3', label: 'Asia Pacific (Osaka)' },
  { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore)' },
  { value: 'ap-southeast-2', label: 'Asia Pacific (Sydney)' },
  { value: 'ap-south-1', label: 'Asia Pacific (Mumbai)' },
  { value: 'sa-east-1', label: 'South America (São Paulo)' },
]

// DigitalOcean Spaces regions
const DO_REGIONS = [
  { value: 'nyc3', label: 'New York 3' },
  { value: 'ams3', label: 'Amsterdam 3' },
  { value: 'sfo3', label: 'San Francisco 3' },
  { value: 'sgp1', label: 'Singapore 1' },
  { value: 'fra1', label: 'Frankfurt 1' },
  { value: 'syd1', label: 'Sydney 1' },
]

/**
 * Provider configurations.
 */
const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  google_drive_shared: {
    id: 'google_drive_shared',
    name: 'Google Drive (Shared Drives)',
    icon: '/icons/google_drive.svg',
    authType: 'oauth',
    description: 'Access Google Workspace Shared Drives for team collaboration',
    features: ['shared_drives', 'folders', 'team_access'],
  },
  google_drive_my_drive: {
    id: 'google_drive_my_drive',
    name: 'Google Drive (My Drive)',
    icon: '/icons/google_drive.svg',
    authType: 'oauth',
    description: 'Access your personal Google Drive storage',
    features: ['folders', 'personal_storage'],
  },
  google_cloud_storage: {
    id: 'google_cloud_storage',
    name: 'Google Cloud Storage',
    icon: '/icons/google_cloud_storage.svg',
    authType: 'service_account',
    description: 'Enterprise-grade object storage with global availability',
    features: ['buckets', 'storage_classes'],
    fields: [
      {
        name: 'service_account_json',
        label: 'Service Account JSON',
        type: 'textarea',
        placeholder: 'Paste your service account JSON key here...',
        required: true,
      },
    ],
  },
  s3: {
    id: 's3',
    name: 'Amazon S3',
    icon: '/icons/amazon_s3.svg',
    authType: 'api_key',
    description: 'AWS Simple Storage Service - industry-leading scalability',
    features: ['buckets', 'regions', 'versioning'],
    fields: [
      {
        name: 'access_key_id',
        label: 'Access Key ID',
        type: 'text',
        placeholder: 'AKIAIOSFODNN7EXAMPLE',
        required: true,
      },
      {
        name: 'secret_access_key',
        label: 'Secret Access Key',
        type: 'password',
        placeholder: 'Enter your secret access key',
        required: true,
      },
      {
        name: 'region',
        label: 'Region',
        type: 'select',
        options: AWS_REGIONS,
        required: true,
      },
    ],
  },
  cloudflare_r2: {
    id: 'cloudflare_r2',
    name: 'Cloudflare R2',
    icon: '/icons/cloudflare_r2.svg',
    authType: 'api_key',
    description: 'Zero egress fee object storage with S3 compatibility',
    features: ['buckets', 'zero_egress'],
    fields: [
      {
        name: 'access_key_id',
        label: 'Access Key ID',
        type: 'text',
        placeholder: 'Your R2 access key ID',
        required: true,
      },
      {
        name: 'secret_access_key',
        label: 'Secret Access Key',
        type: 'password',
        placeholder: 'Your R2 secret access key',
        required: true,
      },
      {
        name: 'account_id',
        label: 'Cloudflare Account ID',
        type: 'text',
        placeholder: 'Your Cloudflare account ID (found in dashboard URL)',
        required: true,
      },
    ],
  },
  digitalocean_spaces: {
    id: 'digitalocean_spaces',
    name: 'DigitalOcean Spaces',
    icon: '/icons/digitalocean_spaces.svg',
    authType: 'api_key',
    description: 'Simple and scalable S3-compatible object storage',
    features: ['buckets', 'regions', 'cdn'],
    fields: [
      {
        name: 'access_key_id',
        label: 'Spaces Access Key',
        type: 'text',
        placeholder: 'Your Spaces access key',
        required: true,
      },
      {
        name: 'secret_access_key',
        label: 'Spaces Secret Key',
        type: 'password',
        placeholder: 'Your Spaces secret key',
        required: true,
      },
      {
        name: 'region',
        label: 'Region',
        type: 'select',
        options: DO_REGIONS,
        required: true,
      },
    ],
  },
}

// Get all providers
providers.get('/', (c) => {
  return c.json({
    success: true,
    data: PROVIDER_CONFIGS,
  })
})

// Get a specific provider
providers.get('/:id', (c) => {
  const id = c.req.param('id')
  const config = PROVIDER_CONFIGS[id]

  if (!config) {
    return c.json({ success: false, error: 'Provider not found' }, 404)
  }

  return c.json({
    success: true,
    data: config,
  })
})

export default providers
