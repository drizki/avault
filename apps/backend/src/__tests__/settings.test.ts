import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SettingsService } from '../lib/settings'

describe('SettingsService', () => {
  let mockDb: any
  let settingsService: SettingsService

  beforeEach(() => {
    mockDb = {
      systemSettings: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        upsert: vi.fn(),
      },
    }
    settingsService = new SettingsService(mockDb)
  })

  describe('get', () => {
    it('returns default value when setting not found', async () => {
      mockDb.systemSettings.findUnique.mockResolvedValue(null)

      const result = await settingsService.get('nonexistent', 'default')

      expect(result).toBe('default')
    })

    it('returns parsed value when setting exists', async () => {
      mockDb.systemSettings.findUnique.mockResolvedValue({
        key: 'test.setting',
        value: JSON.stringify({ foo: 'bar' }),
      })

      const result = await settingsService.get('test.setting', {})

      expect(result).toEqual({ foo: 'bar' })
    })

    it('returns boolean values correctly', async () => {
      mockDb.systemSettings.findUnique.mockResolvedValue({
        key: 'auth.enabled',
        value: 'true',
      })

      const result = await settingsService.get('auth.enabled', false)

      expect(result).toBe(true)
    })

    it('returns default when value is corrupted JSON', async () => {
      mockDb.systemSettings.findUnique.mockResolvedValue({
        key: 'corrupted',
        value: 'not valid json {{{',
      })

      const result = await settingsService.get('corrupted', 'fallback')

      expect(result).toBe('fallback')
    })

    it('handles numeric values', async () => {
      mockDb.systemSettings.findUnique.mockResolvedValue({
        key: 'max.items',
        value: '100',
      })

      const result = await settingsService.get('max.items', 50)

      expect(result).toBe(100)
    })

    it('handles array values', async () => {
      mockDb.systemSettings.findUnique.mockResolvedValue({
        key: 'allowed.domains',
        value: JSON.stringify(['example.com', 'test.com']),
      })

      const result = await settingsService.get<string[]>('allowed.domains', [])

      expect(result).toEqual(['example.com', 'test.com'])
    })
  })

  describe('set', () => {
    it('upserts setting with stringified value', async () => {
      mockDb.systemSettings.upsert.mockResolvedValue({})

      await settingsService.set('test.key', { value: 123 })

      expect(mockDb.systemSettings.upsert).toHaveBeenCalledWith({
        where: { key: 'test.key' },
        create: {
          key: 'test.key',
          value: '{"value":123}',
          updatedBy: undefined,
        },
        update: {
          value: '{"value":123}',
          updatedBy: undefined,
        },
      })
    })

    it('includes userId when provided', async () => {
      mockDb.systemSettings.upsert.mockResolvedValue({})

      await settingsService.set('test.key', true, 'user-123')

      expect(mockDb.systemSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ updatedBy: 'user-123' }),
          update: expect.objectContaining({ updatedBy: 'user-123' }),
        })
      )
    })

    it('handles string values', async () => {
      mockDb.systemSettings.upsert.mockResolvedValue({})

      await settingsService.set('app.name', 'My App')

      expect(mockDb.systemSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ value: '"My App"' }),
        })
      )
    })
  })

  describe('areSignupsAllowed', () => {
    it('returns true by default', async () => {
      mockDb.systemSettings.findUnique.mockResolvedValue(null)

      const result = await settingsService.areSignupsAllowed()

      expect(result).toBe(true)
    })

    it('returns stored value when set', async () => {
      mockDb.systemSettings.findUnique.mockResolvedValue({
        key: 'auth.allowSignups',
        value: 'false',
      })

      const result = await settingsService.areSignupsAllowed()

      expect(result).toBe(false)
    })
  })

  describe('isSystemInitialized', () => {
    it('returns false by default', async () => {
      mockDb.systemSettings.findUnique.mockResolvedValue(null)

      const result = await settingsService.isSystemInitialized()

      expect(result).toBe(false)
    })

    it('returns true when initialized', async () => {
      mockDb.systemSettings.findUnique.mockResolvedValue({
        key: 'system.initialized',
        value: 'true',
      })

      const result = await settingsService.isSystemInitialized()

      expect(result).toBe(true)
    })
  })

  describe('initializeDefaults', () => {
    it('sets default values when not exist', async () => {
      mockDb.systemSettings.findUnique.mockResolvedValue(null)
      mockDb.systemSettings.upsert.mockResolvedValue({})

      await settingsService.initializeDefaults()

      expect(mockDb.systemSettings.upsert).toHaveBeenCalledTimes(2)
    })

    it('does not overwrite existing values', async () => {
      mockDb.systemSettings.findUnique.mockResolvedValue({
        key: 'existing',
        value: 'true',
      })

      await settingsService.initializeDefaults()

      expect(mockDb.systemSettings.upsert).not.toHaveBeenCalled()
    })
  })

  describe('getAll', () => {
    it('returns all settings as object', async () => {
      mockDb.systemSettings.findMany.mockResolvedValue([
        { key: 'setting1', value: '"value1"' },
        { key: 'setting2', value: '123' },
        { key: 'setting3', value: '{"nested": true}' },
      ])

      const result = await settingsService.getAll()

      expect(result).toEqual({
        setting1: 'value1',
        setting2: 123,
        setting3: { nested: true },
      })
    })

    it('returns empty object when no settings', async () => {
      mockDb.systemSettings.findMany.mockResolvedValue([])

      const result = await settingsService.getAll()

      expect(result).toEqual({})
    })

    it('handles corrupted values gracefully', async () => {
      mockDb.systemSettings.findMany.mockResolvedValue([
        { key: 'good', value: '"valid"' },
        { key: 'bad', value: 'invalid json {{' },
      ])

      const result = await settingsService.getAll()

      expect(result.good).toBe('valid')
      expect(result.bad).toBe('invalid json {{') // Returns raw value
    })
  })
})
