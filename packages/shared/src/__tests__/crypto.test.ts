import { describe, it, expect, beforeAll } from 'vitest'

// Set up test encryption key before importing crypto module
beforeAll(() => {
  // 64-character hex string (32 bytes)
  process.env.ENCRYPTION_KEY = 'a'.repeat(64)
})

describe('crypto', () => {
  it('encrypts and decrypts data correctly', async () => {
    // Dynamic import after env is set
    const { encrypt, decrypt } = await import('../crypto')

    const originalData = 'Hello, World!'
    const encrypted = encrypt(originalData)

    expect(encrypted.encryptedData).toBeDefined()
    expect(encrypted.iv).toBeDefined()
    expect(encrypted.authTag).toBeDefined()
    expect(encrypted.encryptedData).not.toBe(originalData)

    const decrypted = decrypt(encrypted.encryptedData, encrypted.iv, encrypted.authTag)
    expect(decrypted).toBe(originalData)
  })

  it('produces different ciphertexts for same plaintext (unique IVs)', async () => {
    const { encrypt } = await import('../crypto')

    const data = 'Same data'
    const encrypted1 = encrypt(data)
    const encrypted2 = encrypt(data)

    // Different IVs should produce different ciphertexts
    expect(encrypted1.iv).not.toBe(encrypted2.iv)
    expect(encrypted1.encryptedData).not.toBe(encrypted2.encryptedData)
  })

  it('handles complex JSON data', async () => {
    const { encrypt, decrypt } = await import('../crypto')

    const credentials = {
      access_token: 'ya29.a0AfH6SMB...',
      refresh_token: '1//0eGq...',
      expiry_date: 1704067200000,
      scope: 'https://www.googleapis.com/auth/drive.file',
    }

    const originalJson = JSON.stringify(credentials)
    const encrypted = encrypt(originalJson)
    const decrypted = decrypt(encrypted.encryptedData, encrypted.iv, encrypted.authTag)

    expect(JSON.parse(decrypted)).toEqual(credentials)
  })

  it('handles empty strings', async () => {
    const { encrypt, decrypt } = await import('../crypto')

    const encrypted = encrypt('')
    const decrypted = decrypt(encrypted.encryptedData, encrypted.iv, encrypted.authTag)

    expect(decrypted).toBe('')
  })

  it('handles unicode characters', async () => {
    const { encrypt, decrypt } = await import('../crypto')

    const unicodeData = 'Hello 世界 🌍 مرحبا'
    const encrypted = encrypt(unicodeData)
    const decrypted = decrypt(encrypted.encryptedData, encrypted.iv, encrypted.authTag)

    expect(decrypted).toBe(unicodeData)
  })

  it('fails to decrypt with wrong auth tag', async () => {
    const { encrypt, decrypt } = await import('../crypto')

    const encrypted = encrypt('secret data')
    const wrongAuthTag = 'f'.repeat(32) // Wrong auth tag

    expect(() => {
      decrypt(encrypted.encryptedData, encrypted.iv, wrongAuthTag)
    }).toThrow()
  })

  it('fails to decrypt with wrong IV', async () => {
    const { encrypt, decrypt } = await import('../crypto')

    const encrypted = encrypt('secret data')
    const wrongIv = 'f'.repeat(32) // Wrong IV

    expect(() => {
      decrypt(encrypted.encryptedData, wrongIv, encrypted.authTag)
    }).toThrow()
  })
})
