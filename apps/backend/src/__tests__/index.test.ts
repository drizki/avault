import { describe, it, expect, vi, beforeAll } from 'vitest'

// Mock all external dependencies before importing
const mocks = vi.hoisted(() => {
  const serve = vi.fn()
  const schedulerStart = vi.fn().mockResolvedValue(undefined)
  const schedulerStop = vi.fn().mockResolvedValue(undefined)
  const dbDisconnect = vi.fn().mockResolvedValue(undefined)
  const closeRedisConnections = vi.fn().mockResolvedValue(undefined)
  const getRedis = vi.fn().mockReturnValue({
    publish: vi.fn().mockResolvedValue(1),
    set: vi.fn().mockResolvedValue('OK'),
  })
  const publishSystemLog = vi.fn().mockResolvedValue(undefined)

  return {
    serve,
    schedulerStart,
    schedulerStop,
    dbDisconnect,
    closeRedisConnections,
    getRedis,
    publishSystemLog,
  }
})

// Mock @hono/node-server
vi.mock('@hono/node-server', () => ({
  serve: mocks.serve,
}))

// Mock @avault/shared
vi.mock('@avault/shared', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...(actual as object),
    PrismaClient: vi.fn().mockImplementation(() => ({
      $disconnect: mocks.dbDisconnect,
      backupJob: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    })),
    getRedis: mocks.getRedis,
    closeRedisConnections: mocks.closeRedisConnections,
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  }
})

// Mock scheduler
vi.mock('../lib/scheduler', () => ({
  initScheduler: vi.fn().mockReturnValue({
    start: mocks.schedulerStart,
    stop: mocks.schedulerStop,
  }),
}))

// Mock log-stream
vi.mock('../lib/log-stream', () => ({
  systemLog: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  publishSystemLog: mocks.publishSystemLog,
}))

// Mock queue
vi.mock('../lib/queue', () => ({
  closeQueue: vi.fn().mockResolvedValue(undefined),
}))

// Store app reference for reuse
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: any

describe('backend entry point', () => {
  // Import the module once for all tests
  beforeAll(async () => {
    const module = await import('../index')
    app = module.default
  })

  it('exports a Hono app', () => {
    expect(app).toBeDefined()
    expect(typeof app.fetch).toBe('function')
  })

  it('starts HTTP server', () => {
    expect(mocks.serve).toHaveBeenCalled()
  })

  it('configures server on correct port', () => {
    expect(mocks.serve).toHaveBeenCalledWith(
      expect.objectContaining({
        port: expect.any(Number),
      })
    )
  })

  it('initializes scheduler', () => {
    expect(mocks.schedulerStart).toHaveBeenCalled()
  })

  describe('app routes', () => {
    it('responds to health check', async () => {
      const res = await app.request('/')
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.name).toBe('avault-backend')
      expect(body.status).toBe('running')
    })

    it('returns 404 for unknown routes', async () => {
      const res = await app.request('/nonexistent-path')
      expect(res.status).toBe(404)

      const body = await res.json()
      expect(body.success).toBe(false)
      expect(body.error).toBe('Not found')
    })
  })
})
