/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
}))

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({
    send: mocks.send,
  })),
  ListBucketsCommand: vi.fn(),
  ListObjectsV2Command: vi.fn(),
  PutObjectCommand: vi.fn(),
  DeleteObjectsCommand: vi.fn(),
  HeadBucketCommand: vi.fn(),
}))

vi.mock('@aws-sdk/lib-storage', () => ({
  Upload: vi.fn(),
}))

import {
  S3CompatibleAdapter,
  CloudflareR2Adapter,
  DigitalOceanSpacesAdapter,
} from '../s3-compatible'

describe('S3CompatibleAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('CloudflareR2Adapter', () => {
    it('sets provider to cloudflare_r2', () => {
      const adapter = new CloudflareR2Adapter()
      expect((adapter as any).provider).toBe('cloudflare_r2')
    })

    it('throws when account_id not provided and no endpoint', async () => {
      const adapter = new CloudflareR2Adapter()

      await expect(
        adapter.initialize({
          access_key_id: 'test-key',
          secret_access_key: 'test-secret',
          region: 'auto',
        })
      ).rejects.toThrow('Cloudflare R2 requires an account ID')
    })

    it('builds endpoint from account_id', async () => {
      const { S3Client } = await import('@aws-sdk/client-s3')
      const adapter = new CloudflareR2Adapter()

      await adapter.initialize({
        access_key_id: 'test-key',
        secret_access_key: 'test-secret',
        region: 'auto',
        account_id: 'abc123',
      })

      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'https://abc123.r2.cloudflarestorage.com',
          region: 'auto',
          forcePathStyle: true,
        })
      )
    })

    it('uses custom endpoint when provided', async () => {
      const { S3Client } = await import('@aws-sdk/client-s3')
      const adapter = new CloudflareR2Adapter()

      await adapter.initialize({
        access_key_id: 'test-key',
        secret_access_key: 'test-secret',
        region: 'auto',
        endpoint: 'https://custom.r2.example.com',
      })

      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'https://custom.r2.example.com',
        })
      )
    })
  })

  describe('DigitalOceanSpacesAdapter', () => {
    it('sets provider to digitalocean_spaces', () => {
      const adapter = new DigitalOceanSpacesAdapter()
      expect((adapter as any).provider).toBe('digitalocean_spaces')
    })

    it('builds endpoint from region', async () => {
      const { S3Client } = await import('@aws-sdk/client-s3')
      const adapter = new DigitalOceanSpacesAdapter()

      await adapter.initialize({
        access_key_id: 'test-key',
        secret_access_key: 'test-secret',
        region: 'sfo3',
      })

      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'https://sfo3.digitaloceanspaces.com',
          region: 'sfo3',
        })
      )
    })

    it('uses default region when not provided', async () => {
      const { S3Client } = await import('@aws-sdk/client-s3')
      const adapter = new DigitalOceanSpacesAdapter()

      await adapter.initialize({
        access_key_id: 'test-key',
        secret_access_key: 'test-secret',
        region: '',
      })

      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'https://nyc3.digitaloceanspaces.com',
          region: 'nyc3',
        })
      )
    })

    it('does not use path style', async () => {
      const { S3Client } = await import('@aws-sdk/client-s3')
      const adapter = new DigitalOceanSpacesAdapter()

      await adapter.initialize({
        access_key_id: 'test-key',
        secret_access_key: 'test-secret',
        region: 'nyc3',
      })

      // forcePathStyle should NOT be set (DigitalOcean uses virtual hosting)
      expect(S3Client).toHaveBeenCalledWith(
        expect.not.objectContaining({
          forcePathStyle: true,
        })
      )
    })
  })

  describe('Generic S3CompatibleAdapter', () => {
    it('throws on unknown provider without config', async () => {
      const adapter = new S3CompatibleAdapter('unknown_provider')

      // Unknown provider has no config, so initialization will fail
      await expect(
        adapter.initialize({
          access_key_id: 'test-key',
          secret_access_key: 'test-secret',
          region: 'us-east-1',
          endpoint: 'https://custom.s3.example.com',
        })
      ).rejects.toThrow()
    })
  })
})
