import { describe, it, expect } from 'vitest'

// Test barrel file exports
describe('shared package exports', () => {
  it('exports Prisma client', async () => {
    const { PrismaClient } = await import('../index')
    expect(PrismaClient).toBeDefined()
  })

  it('exports Zod schemas', async () => {
    const exports = await import('../index')
    // Check for schema exports
    expect(exports.StorageProviderEnum).toBeDefined()
    expect(exports.CreateBackupJobSchema).toBeDefined()
    expect(exports.PaginatedResponseSchema).toBeDefined()
    expect(exports.UserSchema).toBeDefined()
    expect(exports.SettingSchema).toBeDefined()
  })

  it('exports Redis utilities', async () => {
    const { getRedis, createRedisConnection, closeRedisConnections } = await import('../index')
    expect(getRedis).toBeDefined()
    expect(createRedisConnection).toBeDefined()
    expect(closeRedisConnections).toBeDefined()
  })

  it('exports crypto utilities', async () => {
    const { encrypt, decrypt } = await import('../index')
    expect(encrypt).toBeDefined()
    expect(decrypt).toBeDefined()
  })

  it('exports logger utilities', async () => {
    const { logger, createLogger } = await import('../index')
    expect(logger).toBeDefined()
    expect(createLogger).toBeDefined()
  })

  it('exports storage types', async () => {
    // Type exports are verified at compile time
    // Runtime verification just ensures the module loads
    const exports = await import('../index')
    expect(exports).toBeDefined()
  })
})
