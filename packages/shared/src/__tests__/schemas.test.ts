import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  UserRoleEnum,
  UserSchema,
  StorageProviderEnum,
  CreateCredentialSchema,
  GoogleDriveCredentialDataSchema,
  S3CredentialDataSchema,
  GCSCredentialDataSchema,
  CreateDestinationSchema,
  RetentionTypeEnum,
  CronExpressionSchema,
  CreateBackupJobSchema,
  BrowsePathSchema,
  NASFileSchema,
  BackupStatusEnum,
  TriggerSourceEnum,
  BackupHistoryQuerySchema,
  GoogleOAuthInitSchema,
  GoogleOAuthCallbackSchema,
  SuccessResponseSchema,
  ErrorResponseSchema,
  PaginatedResponseSchema,
  OAuthProviders,
  ApiKeyProviders,
  ServiceAccountProviders,
} from '../schemas'

describe('schemas', () => {
  describe('UserRoleEnum', () => {
    it('accepts valid roles', () => {
      expect(UserRoleEnum.parse('ADMIN')).toBe('ADMIN')
      expect(UserRoleEnum.parse('USER')).toBe('USER')
    })

    it('rejects invalid roles', () => {
      expect(() => UserRoleEnum.parse('SUPERUSER')).toThrow()
      expect(() => UserRoleEnum.parse('')).toThrow()
    })
  })

  describe('UserSchema', () => {
    it('validates complete user object', () => {
      const user = {
        id: 'clxxxxxxxxxxxxxxxxx',
        email: 'test@example.com',
        name: 'Test User',
        avatarUrl: 'https://example.com/avatar.png',
        role: 'USER',
        createdAt: new Date(),
        lastLoginAt: new Date(),
      }
      expect(() => UserSchema.parse(user)).not.toThrow()
    })

    it('allows null for optional fields', () => {
      const user = {
        id: 'clxxxxxxxxxxxxxxxxx',
        email: 'test@example.com',
        name: null,
        avatarUrl: null,
        role: 'ADMIN',
        createdAt: new Date(),
        lastLoginAt: null,
      }
      expect(() => UserSchema.parse(user)).not.toThrow()
    })

    it('rejects invalid email', () => {
      const user = {
        id: 'clxxxxxxxxxxxxxxxxx',
        email: 'not-an-email',
        name: null,
        avatarUrl: null,
        role: 'USER',
        createdAt: new Date(),
        lastLoginAt: null,
      }
      expect(() => UserSchema.parse(user)).toThrow()
    })
  })

  describe('StorageProviderEnum', () => {
    it('accepts all valid providers', () => {
      const providers = [
        'google_drive_shared',
        'google_drive_my_drive',
        'google_cloud_storage',
        's3',
        'cloudflare_r2',
        'digitalocean_spaces',
      ]
      providers.forEach((p) => {
        expect(StorageProviderEnum.parse(p)).toBe(p)
      })
    })

    it('rejects invalid providers', () => {
      expect(() => StorageProviderEnum.parse('dropbox')).toThrow()
      expect(() => StorageProviderEnum.parse('onedrive')).toThrow()
    })
  })

  describe('Provider categorization', () => {
    it('has correct OAuth providers', () => {
      expect(OAuthProviders).toContain('google_drive_shared')
      expect(OAuthProviders).toContain('google_drive_my_drive')
      expect(OAuthProviders).not.toContain('s3')
    })

    it('has correct API key providers', () => {
      expect(ApiKeyProviders).toContain('s3')
      expect(ApiKeyProviders).toContain('cloudflare_r2')
      expect(ApiKeyProviders).toContain('digitalocean_spaces')
    })

    it('has correct service account providers', () => {
      expect(ServiceAccountProviders).toContain('google_cloud_storage')
    })
  })

  describe('CreateCredentialSchema', () => {
    it('validates valid credential', () => {
      const cred = { name: 'My Credential', provider: 'google_drive_shared' }
      expect(() => CreateCredentialSchema.parse(cred)).not.toThrow()
    })

    it('rejects empty name', () => {
      const cred = { name: '', provider: 's3' }
      expect(() => CreateCredentialSchema.parse(cred)).toThrow()
    })
  })

  describe('GoogleDriveCredentialDataSchema', () => {
    it('validates valid credentials', () => {
      const creds = {
        access_token: 'ya29.xxx',
        refresh_token: '1//xxx',
        expiry_date: Date.now() + 3600000,
        token_type: 'Bearer',
        scope: 'https://www.googleapis.com/auth/drive',
      }
      expect(() => GoogleDriveCredentialDataSchema.parse(creds)).not.toThrow()
    })

    it('uses default token_type', () => {
      const creds = {
        access_token: 'ya29.xxx',
        refresh_token: '1//xxx',
        expiry_date: Date.now(),
        scope: 'drive',
      }
      const parsed = GoogleDriveCredentialDataSchema.parse(creds)
      expect(parsed.token_type).toBe('Bearer')
    })
  })

  describe('S3CredentialDataSchema', () => {
    it('validates valid S3 credentials', () => {
      const creds = {
        access_key_id: 'AKIAIOSFODNN7EXAMPLE',
        secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        region: 'us-west-2',
      }
      expect(() => S3CredentialDataSchema.parse(creds)).not.toThrow()
    })

    it('uses default region', () => {
      const creds = {
        access_key_id: 'AKIAIOSFODNN7EXAMPLE',
        secret_access_key: 'secret',
      }
      const parsed = S3CredentialDataSchema.parse(creds)
      expect(parsed.region).toBe('us-east-1')
    })

    it('accepts optional fields', () => {
      const creds = {
        access_key_id: 'AKIAIOSFODNN7EXAMPLE',
        secret_access_key: 'secret',
        endpoint: 'https://s3.example.com',
        bucket: 'my-bucket',
        force_path_style: true,
        account_id: 'account123',
      }
      expect(() => S3CredentialDataSchema.parse(creds)).not.toThrow()
    })

    it('rejects empty access_key_id', () => {
      const creds = {
        access_key_id: '',
        secret_access_key: 'secret',
      }
      expect(() => S3CredentialDataSchema.parse(creds)).toThrow()
    })
  })

  describe('GCSCredentialDataSchema', () => {
    it('validates valid GCS service account', () => {
      const creds = {
        type: 'service_account',
        project_id: 'my-project',
        private_key_id: 'key123',
        private_key: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----',
        client_email: 'sa@project.iam.gserviceaccount.com',
        client_id: '123456789',
        auth_uri: 'https://accounts.google.com/o/oauth2/auth',
        token_uri: 'https://oauth2.googleapis.com/token',
        auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
        client_x509_cert_url: 'https://www.googleapis.com/robot/v1/metadata/x509/sa%40project.iam.gserviceaccount.com',
      }
      expect(() => GCSCredentialDataSchema.parse(creds)).not.toThrow()
    })

    it('rejects wrong type', () => {
      const creds = {
        type: 'user_credentials',
        project_id: 'my-project',
      }
      expect(() => GCSCredentialDataSchema.parse(creds)).toThrow()
    })
  })

  describe('CreateDestinationSchema', () => {
    it('validates valid destination', () => {
      const dest = {
        credentialId: 'clxxxxxxxxxxxxxxxxx',
        provider: 's3',
        remoteId: 'my-bucket',
        name: 'Production Backup',
      }
      expect(() => CreateDestinationSchema.parse(dest)).not.toThrow()
    })

    it('accepts optional folderPath', () => {
      const dest = {
        credentialId: 'clxxxxxxxxxxxxxxxxx',
        provider: 'google_drive_shared',
        remoteId: 'drive-id',
        name: 'Backup Drive',
        folderPath: '/backups/daily',
      }
      expect(() => CreateDestinationSchema.parse(dest)).not.toThrow()
    })
  })

  describe('RetentionTypeEnum', () => {
    it('accepts valid retention types', () => {
      expect(RetentionTypeEnum.parse('VERSION_COUNT')).toBe('VERSION_COUNT')
      expect(RetentionTypeEnum.parse('DAYS')).toBe('DAYS')
      expect(RetentionTypeEnum.parse('HYBRID')).toBe('HYBRID')
    })
  })

  describe('CronExpressionSchema', () => {
    it('accepts valid cron expressions', () => {
      expect(() => CronExpressionSchema.parse('0 0 * * *')).not.toThrow()
      expect(() => CronExpressionSchema.parse('*/15 * * * *')).not.toThrow()
      expect(() => CronExpressionSchema.parse('0 2 * * 0')).not.toThrow()
    })

    it('rejects invalid cron expressions', () => {
      expect(() => CronExpressionSchema.parse('invalid')).toThrow()
      expect(() => CronExpressionSchema.parse('')).toThrow()
    })
  })

  describe('CreateBackupJobSchema', () => {
    it('validates VERSION_COUNT job with count', () => {
      const job = {
        name: 'Daily Backup',
        sourcePath: '/data',
        destinationId: 'clxxxxxxxxxxxxxxxxx',
        credentialId: 'clxxxxxxxxxxxxxxxxx',
        schedule: '0 2 * * *',
        retentionType: 'VERSION_COUNT',
        retentionCount: 5,
      }
      expect(() => CreateBackupJobSchema.parse(job)).not.toThrow()
    })

    it('validates DAYS job with days', () => {
      const job = {
        name: 'Weekly Backup',
        sourcePath: '/data',
        destinationId: 'clxxxxxxxxxxxxxxxxx',
        credentialId: 'clxxxxxxxxxxxxxxxxx',
        schedule: '0 0 * * 0',
        retentionType: 'DAYS',
        retentionDays: 30,
      }
      expect(() => CreateBackupJobSchema.parse(job)).not.toThrow()
    })

    it('validates HYBRID job with both', () => {
      const job = {
        name: 'Hybrid Backup',
        sourcePath: '/data',
        destinationId: 'clxxxxxxxxxxxxxxxxx',
        credentialId: 'clxxxxxxxxxxxxxxxxx',
        schedule: '0 0 * * *',
        retentionType: 'HYBRID',
        retentionCount: 10,
        retentionDays: 90,
      }
      expect(() => CreateBackupJobSchema.parse(job)).not.toThrow()
    })

    it('rejects VERSION_COUNT without count', () => {
      const job = {
        name: 'Invalid Backup',
        sourcePath: '/data',
        destinationId: 'clxxxxxxxxxxxxxxxxx',
        credentialId: 'clxxxxxxxxxxxxxxxxx',
        schedule: '0 2 * * *',
        retentionType: 'VERSION_COUNT',
      }
      expect(() => CreateBackupJobSchema.parse(job)).toThrow()
    })

    it('uses default namePattern', () => {
      const job = {
        name: 'Backup',
        sourcePath: '/data',
        destinationId: 'clxxxxxxxxxxxxxxxxx',
        credentialId: 'clxxxxxxxxxxxxxxxxx',
        schedule: '0 0 * * *',
        retentionType: 'VERSION_COUNT',
        retentionCount: 5,
      }
      const parsed = CreateBackupJobSchema.parse(job)
      expect(parsed.namePattern).toBe('backup-{date}-{hash}')
    })
  })

  describe('BrowsePathSchema', () => {
    it('uses default path', () => {
      const parsed = BrowsePathSchema.parse({})
      expect(parsed.path).toBe('/')
    })

    it('accepts custom path', () => {
      const parsed = BrowsePathSchema.parse({ path: '/home/user' })
      expect(parsed.path).toBe('/home/user')
    })
  })

  describe('NASFileSchema', () => {
    it('validates file entry', () => {
      const file = {
        name: 'document.pdf',
        path: '/documents/document.pdf',
        type: 'file',
        size: 1024,
      }
      expect(() => NASFileSchema.parse(file)).not.toThrow()
    })

    it('validates directory entry', () => {
      const dir = {
        name: 'photos',
        path: '/photos',
        type: 'directory',
      }
      expect(() => NASFileSchema.parse(dir)).not.toThrow()
    })
  })

  describe('BackupStatusEnum', () => {
    it('accepts all valid statuses', () => {
      const statuses = ['PENDING', 'RUNNING', 'UPLOADING', 'ROTATING', 'SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'CANCELLED']
      statuses.forEach((s) => {
        expect(() => BackupStatusEnum.parse(s)).not.toThrow()
      })
    })
  })

  describe('TriggerSourceEnum', () => {
    it('accepts valid trigger sources', () => {
      expect(TriggerSourceEnum.parse('MANUAL')).toBe('MANUAL')
      expect(TriggerSourceEnum.parse('SCHEDULED')).toBe('SCHEDULED')
    })
  })

  describe('BackupHistoryQuerySchema', () => {
    it('uses default pagination values', () => {
      const parsed = BackupHistoryQuerySchema.parse({})
      expect(parsed.page).toBe(1)
      expect(parsed.pageSize).toBe(20)
    })

    it('coerces string numbers', () => {
      const parsed = BackupHistoryQuerySchema.parse({ page: '3', pageSize: '50' })
      expect(parsed.page).toBe(3)
      expect(parsed.pageSize).toBe(50)
    })

    it('limits pageSize to 100', () => {
      expect(() => BackupHistoryQuerySchema.parse({ pageSize: 150 })).toThrow()
    })
  })

  describe('GoogleOAuthInitSchema', () => {
    it('validates name', () => {
      expect(() => GoogleOAuthInitSchema.parse({ name: 'My Drive' })).not.toThrow()
    })

    it('rejects empty name', () => {
      expect(() => GoogleOAuthInitSchema.parse({ name: '' })).toThrow()
    })
  })

  describe('GoogleOAuthCallbackSchema', () => {
    it('validates callback params', () => {
      const params = { code: 'auth-code-123', state: 'state-token' }
      expect(() => GoogleOAuthCallbackSchema.parse(params)).not.toThrow()
    })
  })

  describe('Response schemas', () => {
    it('validates success response', () => {
      const res = { success: true, data: { id: 1 }, message: 'OK' }
      expect(() => SuccessResponseSchema.parse(res)).not.toThrow()
    })

    it('validates error response', () => {
      const res = { success: false, error: 'Something went wrong' }
      expect(() => ErrorResponseSchema.parse(res)).not.toThrow()
    })

    it('validates paginated response', () => {
      const ItemSchema = z.object({ id: z.string(), name: z.string() })
      const PaginatedItemsSchema = PaginatedResponseSchema(ItemSchema)

      const res = {
        success: true,
        data: [
          { id: '1', name: 'Item 1' },
          { id: '2', name: 'Item 2' },
        ],
        pagination: {
          total: 100,
          limit: 10,
          offset: 0,
          hasMore: true,
        },
      }
      expect(() => PaginatedItemsSchema.parse(res)).not.toThrow()
    })

    it('rejects invalid paginated response', () => {
      const ItemSchema = z.object({ id: z.string() })
      const PaginatedItemsSchema = PaginatedResponseSchema(ItemSchema)

      const res = {
        success: true,
        data: [{ id: '1' }],
        pagination: {
          total: 100,
          // Missing limit, offset, hasMore
        },
      }
      expect(() => PaginatedItemsSchema.parse(res)).toThrow()
    })
  })
})
