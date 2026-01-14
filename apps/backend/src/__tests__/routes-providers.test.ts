import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResponse = { success: boolean; data?: any; error?: string }

import providersRoutes from '../routes/providers'

describe('providers routes', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let app: Hono<any>

  beforeEach(() => {
    app = new Hono()
    app.route('/api/providers', providersRoutes)
  })

  describe('GET /api/providers', () => {
    it('returns all provider configurations', async () => {
      const res = await app.request('/api/providers')

      expect(res.status).toBe(200)
      const body = await res.json() as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data).toHaveProperty('google_drive_shared')
      expect(body.data).toHaveProperty('google_drive_my_drive')
      expect(body.data).toHaveProperty('google_cloud_storage')
      expect(body.data).toHaveProperty('s3')
      expect(body.data).toHaveProperty('cloudflare_r2')
      expect(body.data).toHaveProperty('digitalocean_spaces')
    })

    it('includes provider details', async () => {
      const res = await app.request('/api/providers')
      const body = await res.json() as ApiResponse

      const s3Provider = body.data.s3
      expect(s3Provider).toHaveProperty('id', 's3')
      expect(s3Provider).toHaveProperty('name', 'Amazon S3')
      expect(s3Provider).toHaveProperty('authType', 'api_key')
      expect(s3Provider).toHaveProperty('fields')
      expect(s3Provider.fields).toHaveLength(3)
    })

    it('includes OAuth providers', async () => {
      const res = await app.request('/api/providers')
      const body = await res.json() as ApiResponse

      expect(body.data.google_drive_shared.authType).toBe('oauth')
      expect(body.data.google_drive_my_drive.authType).toBe('oauth')
    })

    it('includes service account providers', async () => {
      const res = await app.request('/api/providers')
      const body = await res.json() as ApiResponse

      expect(body.data.google_cloud_storage.authType).toBe('service_account')
    })
  })

  describe('GET /api/providers/:id', () => {
    it('returns specific provider by id', async () => {
      const res = await app.request('/api/providers/s3')

      expect(res.status).toBe(200)
      const body = await res.json() as ApiResponse
      expect(body.success).toBe(true)
      expect(body.data.id).toBe('s3')
      expect(body.data.name).toBe('Amazon S3')
    })

    it('returns Google Drive Shared config', async () => {
      const res = await app.request('/api/providers/google_drive_shared')
      const body = await res.json() as ApiResponse

      expect(body.data).toEqual({
        id: 'google_drive_shared',
        name: 'Google Drive (Shared Drives)',
        icon: '/icons/google_drive.svg',
        authType: 'oauth',
        description: expect.any(String),
        features: ['shared_drives', 'folders', 'team_access'],
      })
    })

    it('returns Cloudflare R2 config with required fields', async () => {
      const res = await app.request('/api/providers/cloudflare_r2')
      const body = await res.json() as ApiResponse

      expect(body.data.id).toBe('cloudflare_r2')
      expect(body.data.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'access_key_id', required: true }),
          expect.objectContaining({ name: 'secret_access_key', required: true }),
          expect.objectContaining({ name: 'account_id', required: true }),
        ])
      )
    })

    it('returns 404 for unknown provider', async () => {
      const res = await app.request('/api/providers/dropbox')

      expect(res.status).toBe(404)
      const body = await res.json() as ApiResponse
      expect(body.success).toBe(false)
      expect(body.error).toBe('Provider not found')
    })

    it('returns region options for S3', async () => {
      const res = await app.request('/api/providers/s3')
      const body = await res.json() as ApiResponse

      const regionField = body.data.fields.find((f: any) => f.name === 'region')
      expect(regionField.type).toBe('select')
      expect(regionField.options).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: 'us-east-1' }),
          expect.objectContaining({ value: 'eu-west-1' }),
        ])
      )
    })

    it('returns region options for DigitalOcean Spaces', async () => {
      const res = await app.request('/api/providers/digitalocean_spaces')
      const body = await res.json() as ApiResponse

      const regionField = body.data.fields.find((f: any) => f.name === 'region')
      expect(regionField.options).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: 'nyc3' }),
          expect.objectContaining({ value: 'ams3' }),
        ])
      )
    })
  })
})
