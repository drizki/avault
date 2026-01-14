import { CronExpressionParser } from 'cron-parser'
import { logger } from '@avault/shared'

/**
 * Validates a cron expression
 * @param expression - Cron expression (5-field format: minute hour day month weekday)
 * @returns true if valid, false otherwise
 */
export function validateCronExpression(expression: string): boolean {
  try {
    CronExpressionParser.parse(expression)
    return true
  } catch {
    return false
  }
}

/**
 * Gets the next run time from a cron expression
 * @param cronExpression - Cron expression (5-field format)
 * @param fromDate - Optional date to calculate from (defaults to now)
 * @returns Next run date in UTC
 */
export function getNextRunTime(cronExpression: string, fromDate?: Date): Date {
  try {
    const from = fromDate || new Date()
    const interval = CronExpressionParser.parse(cronExpression, {
      currentDate: from,
      tz: 'UTC',
    })
    return interval.next().toDate()
  } catch (error: unknown) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error), cronExpression },
      'Failed to calculate next run time'
    )
    // Fallback: return 1 hour from now
    const fallback = fromDate || new Date()
    fallback.setHours(fallback.getHours() + 1)
    return fallback
  }
}

/**
 * Calculates the next run time based on schedule and last run
 * @param cronExpression - Cron expression
 * @param lastRun - Last run date (null if never run)
 * @returns Next run date
 */
export function calculateNextRun(cronExpression: string, lastRun: Date | null): Date {
  const from = lastRun || new Date()
  return getNextRunTime(cronExpression, from)
}

/**
 * Checks if a job is due to run
 * @param nextRunAt - Scheduled next run time
 * @param now - Current time (defaults to now)
 * @returns true if job is due
 */
export function isJobDue(nextRunAt: Date | null, now: Date = new Date()): boolean {
  if (!nextRunAt) return true // Never run before
  return nextRunAt <= now
}
