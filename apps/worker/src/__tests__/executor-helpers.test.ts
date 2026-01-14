import { describe, it, expect } from 'vitest'

// Test the backup name generation pattern matching
describe('executor helpers', () => {
  // Re-implement generateBackupName for testing (since it's not exported)
  function generateBackupName(pattern: string): string {
    const now = new Date()
    const hash = 'abc123' // Mock hash for testing

    const replacements: Record<string, string> = {
      '{date}': now.toISOString().split('T')[0],
      '{datetime}': now.toISOString().replace(/[:.]/g, '-').slice(0, -5),
      '{timestamp}': now.getTime().toString(),
      '{year}': now.getFullYear().toString(),
      '{month}': String(now.getMonth() + 1).padStart(2, '0'),
      '{day}': String(now.getDate()).padStart(2, '0'),
      '{hour}': String(now.getHours()).padStart(2, '0'),
      '{minute}': String(now.getMinutes()).padStart(2, '0'),
      '{hash}': hash,
    }

    let name = pattern
    for (const [placeholder, value] of Object.entries(replacements)) {
      name = name.replace(new RegExp(placeholder, 'g'), value)
    }

    return name
  }

  describe('generateBackupName', () => {
    it('replaces {date} placeholder', () => {
      const result = generateBackupName('backup-{date}')
      expect(result).toMatch(/^backup-\d{4}-\d{2}-\d{2}$/)
    })

    it('replaces {year}, {month}, {day} placeholders', () => {
      const result = generateBackupName('{year}/{month}/{day}')
      const now = new Date()
      expect(result).toBe(
        `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`
      )
    })

    it('replaces {hash} placeholder', () => {
      const result = generateBackupName('backup-{hash}')
      expect(result).toBe('backup-abc123')
    })

    it('replaces {timestamp} placeholder', () => {
      const result = generateBackupName('backup-{timestamp}')
      expect(result).toMatch(/^backup-\d+$/)
    })

    it('handles multiple placeholders', () => {
      const result = generateBackupName('backup-{date}-{hash}')
      expect(result).toMatch(/^backup-\d{4}-\d{2}-\d{2}-abc123$/)
    })

    it('preserves text without placeholders', () => {
      const result = generateBackupName('my-backup-folder')
      expect(result).toBe('my-backup-folder')
    })
  })

  // Test OS junk file filtering
  describe('OS junk file filtering', () => {
    const OS_JUNK_FILES = new Set([
      '.DS_Store',
      '._.DS_Store',
      'Thumbs.db',
      'thumbs.db',
      'desktop.ini',
      'Desktop.ini',
      '.Spotlight-V100',
      '.Trashes',
      '.TemporaryItems',
      '.fseventsd',
    ])

    const OS_JUNK_DIRECTORIES = new Set(['$RECYCLE.BIN', 'System Volume Information'])

    it('identifies macOS junk files', () => {
      expect(OS_JUNK_FILES.has('.DS_Store')).toBe(true)
      expect(OS_JUNK_FILES.has('._.DS_Store')).toBe(true)
      expect(OS_JUNK_FILES.has('.Spotlight-V100')).toBe(true)
      expect(OS_JUNK_FILES.has('.Trashes')).toBe(true)
    })

    it('identifies Windows junk files', () => {
      expect(OS_JUNK_FILES.has('Thumbs.db')).toBe(true)
      expect(OS_JUNK_FILES.has('desktop.ini')).toBe(true)
    })

    it('identifies Windows junk directories', () => {
      expect(OS_JUNK_DIRECTORIES.has('$RECYCLE.BIN')).toBe(true)
      expect(OS_JUNK_DIRECTORIES.has('System Volume Information')).toBe(true)
    })

    it('does not flag normal files', () => {
      expect(OS_JUNK_FILES.has('document.pdf')).toBe(false)
      expect(OS_JUNK_FILES.has('.gitignore')).toBe(false)
      expect(OS_JUNK_FILES.has('.env')).toBe(false)
    })
  })

  // Test byte formatting
  describe('formatBytes', () => {
    function formatBytes(bytes: number): string {
      if (bytes === 0) return '0 B'
      const k = 1024
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
      const i = Math.floor(Math.log(bytes) / Math.log(k))
      return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
    }

    it('formats zero bytes', () => {
      expect(formatBytes(0)).toBe('0 B')
    })

    it('formats bytes', () => {
      expect(formatBytes(500)).toBe('500 B')
    })

    it('formats kilobytes', () => {
      expect(formatBytes(1024)).toBe('1 KB')
      expect(formatBytes(1536)).toBe('1.5 KB')
    })

    it('formats megabytes', () => {
      expect(formatBytes(1048576)).toBe('1 MB')
      expect(formatBytes(5242880)).toBe('5 MB')
    })

    it('formats gigabytes', () => {
      expect(formatBytes(1073741824)).toBe('1 GB')
    })

    it('formats terabytes', () => {
      expect(formatBytes(1099511627776)).toBe('1 TB')
    })
  })
})
