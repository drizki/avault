import { S3Adapter, S3Credentials } from './s3.js'

/**
 * Provider-specific configuration for S3-compatible services.
 */
interface S3ProviderConfig {
  name: string
  endpointTemplate?: string
  regionDefault: string
  forcePathStyle: boolean
  requiresAccountId?: boolean
}

/**
 * Configuration for each S3-compatible provider.
 */
const PROVIDER_CONFIGS: Record<string, S3ProviderConfig> = {
  cloudflare_r2: {
    name: 'Cloudflare R2',
    endpointTemplate: 'https://{accountId}.r2.cloudflarestorage.com',
    regionDefault: 'auto',
    forcePathStyle: true,
    requiresAccountId: true,
  },
  digitalocean_spaces: {
    name: 'DigitalOcean Spaces',
    endpointTemplate: 'https://{region}.digitaloceanspaces.com',
    regionDefault: 'nyc3',
    forcePathStyle: false,
  },
}

export interface S3CompatibleCredentials extends S3Credentials {
  account_id?: string // For Cloudflare R2
}

/**
 * Wrapper adapter for S3-compatible storage providers.
 * Supports: Backblaze B2, Cloudflare R2, DigitalOcean Spaces, MinIO
 */
export class S3CompatibleAdapter extends S3Adapter {
  private providerConfig: S3ProviderConfig

  constructor(providerType: string) {
    super()
    this.provider = providerType
    this.providerConfig = PROVIDER_CONFIGS[providerType] || PROVIDER_CONFIGS.minio
  }

  async initialize(credentials: S3CompatibleCredentials): Promise<void> {
    // Build endpoint if not provided
    let endpoint = credentials.endpoint

    if (!endpoint && this.providerConfig.endpointTemplate) {
      endpoint = this.providerConfig.endpointTemplate
        .replace('{region}', credentials.region || this.providerConfig.regionDefault)
        .replace('{accountId}', credentials.account_id || '')
    }

    // For providers that require an account ID
    if (this.providerConfig.requiresAccountId && !credentials.account_id && !credentials.endpoint) {
      throw new Error(`${this.providerConfig.name} requires an account ID`)
    }

    await super.initialize({
      ...credentials,
      endpoint,
      region: credentials.region || this.providerConfig.regionDefault,
      force_path_style: this.providerConfig.forcePathStyle,
    })
  }
}

// Export individual adapter classes for convenience
export class CloudflareR2Adapter extends S3CompatibleAdapter {
  constructor() {
    super('cloudflare_r2')
  }
}

export class DigitalOceanSpacesAdapter extends S3CompatibleAdapter {
  constructor() {
    super('digitalocean_spaces')
  }
}
