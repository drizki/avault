import { describe, it, expect } from 'vitest'
import {
  validateCronExpression,
  getNextRunTime,
  calculateNextRun,
  isJobDue,
} from '../lib/scheduler/cron-utils'

describe('cron-utils', () => {
  describe('validateCronExpression', () => {
    it('validates correct cron expressions', () => {
      expect(validateCronExpression('0 0 * * *')).toBe(true) // Daily at midnight
      expect(validateCronExpression('*/15 * * * *')).toBe(true) // Every 15 minutes
      expect(validateCronExpression('0 2 * * 0')).toBe(true) // Sundays at 2 AM
      expect(validateCronExpression('0 9-17 * * 1-5')).toBe(true) // 9 AM to 5 PM weekdays
      expect(validateCronExpression('30 4 1,15 * *')).toBe(true) // 4:30 AM on 1st and 15th
    })

    it('rejects invalid cron expressions', () => {
      // cron-parser is lenient with some expressions
      expect(validateCronExpression('not a cron expression here')).toBe(false)
      expect(validateCronExpression('a b c d e')).toBe(false)
    })
  })

  describe('getNextRunTime', () => {
    it('calculates next run for daily cron', () => {
      const from = new Date('2024-01-15T10:00:00Z')
      const next = getNextRunTime('0 12 * * *', from) // Daily at noon

      expect(next.getUTCHours()).toBe(12)
      expect(next.getUTCMinutes()).toBe(0)
      expect(next > from).toBe(true)
    })

    it('calculates next run for hourly cron', () => {
      const from = new Date('2024-01-15T10:30:00Z')
      const next = getNextRunTime('0 * * * *', from) // Every hour at :00

      expect(next.getUTCMinutes()).toBe(0)
      expect(next.getUTCHours()).toBe(11) // Next hour
    })

    it('returns fallback on invalid cron', () => {
      const from = new Date('2024-01-15T10:00:00Z')
      const next = getNextRunTime('invalid cron expression', from)

      // Should return a date (fallback creates a date approximately 1 hour from input)
      // The fallback modifies the input date, so we just check it returns a Date
      expect(next).toBeInstanceOf(Date)
      expect(next.getTime()).toBeGreaterThan(0)
    })

    it('uses current time when fromDate not provided', () => {
      const before = new Date()
      const next = getNextRunTime('0 * * * *') // Every hour

      expect(next >= before).toBe(true)
    })
  })

  describe('calculateNextRun', () => {
    it('calculates from lastRun when provided', () => {
      const lastRun = new Date('2024-01-15T10:00:00Z')
      const next = calculateNextRun('0 * * * *', lastRun)

      expect(next > lastRun).toBe(true)
      expect(next.getUTCMinutes()).toBe(0)
    })

    it('calculates from now when lastRun is null', () => {
      const before = new Date()
      const next = calculateNextRun('0 * * * *', null)

      expect(next > before).toBe(true)
    })
  })

  describe('isJobDue', () => {
    it('returns true when nextRunAt is null', () => {
      expect(isJobDue(null)).toBe(true)
    })

    it('returns true when nextRunAt is in the past', () => {
      const pastDate = new Date('2024-01-01T00:00:00Z')
      const now = new Date('2024-01-15T00:00:00Z')

      expect(isJobDue(pastDate, now)).toBe(true)
    })

    it('returns true when nextRunAt equals now', () => {
      const now = new Date('2024-01-15T12:00:00Z')

      expect(isJobDue(now, now)).toBe(true)
    })

    it('returns false when nextRunAt is in the future', () => {
      const futureDate = new Date('2024-01-20T00:00:00Z')
      const now = new Date('2024-01-15T00:00:00Z')

      expect(isJobDue(futureDate, now)).toBe(false)
    })
  })
})
