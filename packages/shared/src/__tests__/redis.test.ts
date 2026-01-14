import { describe, it, expect, vi } from 'vitest'

// Mock ioredis
vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    on: vi.fn().mockReturnThis(),
    quit: vi.fn().mockResolvedValue('OK'),
  })),
}))

import {
  getRedis,
  createRedisConnection,
  getRedisSubscriber,
  closeRedisConnections,
  Redis,
} from '../redis'

describe('redis module', () => {
  describe('getRedis', () => {
    it('returns a redis instance', () => {
      const redis = getRedis()
      expect(redis).toBeDefined()
    })

    it('returns the same instance on subsequent calls (singleton)', () => {
      const redis1 = getRedis()
      const redis2 = getRedis()
      expect(redis1).toBe(redis2)
    })
  })

  describe('getRedisSubscriber', () => {
    it('returns a redis subscriber instance', () => {
      const subscriber = getRedisSubscriber()
      expect(subscriber).toBeDefined()
    })

    it('returns the same instance on subsequent calls (singleton)', () => {
      const sub1 = getRedisSubscriber()
      const sub2 = getRedisSubscriber()
      expect(sub1).toBe(sub2)
    })
  })

  describe('createRedisConnection', () => {
    it('creates a new redis connection', () => {
      const connection = createRedisConnection()
      expect(connection).toBeDefined()
    })

    it('accepts custom config', () => {
      const connection = createRedisConnection({ host: 'custom-host', port: 6380 })
      expect(connection).toBeDefined()
    })
  })

  describe('closeRedisConnections', () => {
    it('resolves without error', async () => {
      await expect(closeRedisConnections()).resolves.toBeUndefined()
    })
  })

  describe('exports', () => {
    it('exports Redis type', () => {
      expect(Redis).toBeDefined()
    })
  })
})
