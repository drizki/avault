import { logger, type PrismaClient } from '@avault/shared'

interface LogEntry {
  historyId?: string
  userId: string
  jobId?: string
  timestamp: Date
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
  message: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>
}

export class LogBuffer {
  private buffer: LogEntry[] = []
  private flushInterval: NodeJS.Timeout | null = null
  private readonly maxBufferSize: number
  private readonly flushIntervalMs: number
  private readonly retentionDays: number
  private isFlushing: boolean = false

  constructor(
    private db: PrismaClient,
    options: {
      maxBufferSize?: number
      flushIntervalMs?: number
      retentionDays?: number
    } = {}
  ) {
    this.maxBufferSize = options.maxBufferSize || 50
    this.flushIntervalMs = options.flushIntervalMs || 2000 // 2 seconds
    this.retentionDays = options.retentionDays || 30
    this.startFlushTimer()
  }

  /**
   * Add a log entry to the buffer
   * Triggers immediate flush if buffer is full
   */
  async add(entry: LogEntry): Promise<void> {
    this.buffer.push(entry)

    // Immediate flush if buffer is full
    if (this.buffer.length >= this.maxBufferSize) {
      await this.flush()
    }
  }

  /**
   * Flush buffered logs to database
   * Uses batch insert for performance
   */
  private async flush(): Promise<void> {
    if (this.buffer.length === 0 || this.isFlushing) return

    const toFlush = [...this.buffer]
    this.buffer = []
    this.isFlushing = true

    try {
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + this.retentionDays)

      await this.db.logEntry.createMany({
        data: toFlush.map((entry) => ({
          historyId: entry.historyId,
          userId: entry.userId,
          jobId: entry.jobId,
          timestamp: entry.timestamp,
          level: entry.level,
          message: entry.message,
          metadata: entry.metadata || undefined,
          expiresAt,
        })),
        skipDuplicates: true,
      })

      logger.debug({ count: toFlush.length }, 'Flushed logs to database')
    } catch (error: unknown) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error), count: toFlush.length },
        'Failed to flush logs to database'
      )

      // Re-add failed logs to buffer (with limit to prevent memory issues)
      if (this.buffer.length < this.maxBufferSize * 2) {
        this.buffer.unshift(...toFlush)
      } else {
        logger.warn(
          { droppedLogs: toFlush.length },
          'Buffer overflow - dropping logs'
        )
      }
    } finally {
      this.isFlushing = false
    }
  }

  /**
   * Start periodic flush timer
   */
  private startFlushTimer(): void {
    this.flushInterval = setInterval(() => {
      this.flush().catch((err) => {
        logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Error in log buffer flush timer')
      })
    }, this.flushIntervalMs)
  }

  /**
   * Shutdown the buffer and flush remaining logs
   */
  async shutdown(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval)
      this.flushInterval = null
    }
    await this.flush()
    logger.info('Log buffer shut down')
  }
}
