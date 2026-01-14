import { PrismaClient, logger } from '@avault/shared'

export class SettingsService {
  constructor(private db: PrismaClient) {}

  /**
   * Get a setting value by key
   */
  async get<T>(key: string, defaultValue: T): Promise<T> {
    const setting = await this.db.systemSettings.findUnique({
      where: { key },
    })

    if (!setting) {
      return defaultValue
    }

    try {
      return JSON.parse(setting.value) as T
    } catch (error) {
      // Log corrupted setting data instead of silently ignoring
      logger.warn(
        { key, value: setting.value, error },
        'Failed to parse setting value, using default'
      )
      return defaultValue
    }
  }

  /**
   * Set a setting value by key
   */
  async set<T>(key: string, value: T, userId?: string): Promise<void> {
    await this.db.systemSettings.upsert({
      where: { key },
      create: {
        key,
        value: JSON.stringify(value),
        updatedBy: userId,
      },
      update: {
        value: JSON.stringify(value),
        updatedBy: userId,
      },
    })
  }

  /**
   * Check if new signups are allowed
   */
  async areSignupsAllowed(): Promise<boolean> {
    return await this.get('auth.allowSignups', true)
  }

  /**
   * Check if the system has been initialized (has at least one user)
   */
  async isSystemInitialized(): Promise<boolean> {
    return await this.get('system.initialized', false)
  }

  /**
   * Initialize default settings
   */
  async initializeDefaults(): Promise<void> {
    // Set default values if they don't exist
    const allowSignups = await this.db.systemSettings.findUnique({
      where: { key: 'auth.allowSignups' },
    })

    if (!allowSignups) {
      await this.set('auth.allowSignups', true)
    }

    const initialized = await this.db.systemSettings.findUnique({
      where: { key: 'system.initialized' },
    })

    if (!initialized) {
      await this.set('system.initialized', false)
    }
  }

  /**
   * Get all settings
   */
  async getAll(): Promise<Record<string, unknown>> {
    const settings = await this.db.systemSettings.findMany()

    const result: Record<string, unknown> = {}
    for (const setting of settings) {
      try {
        result[setting.key] = JSON.parse(setting.value)
      } catch (error) {
        // Log but continue - return raw value for unparseable settings
        logger.warn({ key: setting.key, error }, 'Failed to parse setting value in getAll')
        result[setting.key] = setting.value
      }
    }

    return result
  }
}
