// Setup file that runs before all tests
// Set required environment variables
process.env.ENCRYPTION_KEY = 'a'.repeat(64)
process.env.JWT_SECRET = 'test-jwt-secret-for-testing-only'
process.env.GOOGLE_CLIENT_ID = 'test-client-id'
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret'
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:4000/callback'
process.env.REDIS_URL = 'redis://localhost:6379'
process.env.LOG_LEVEL = 'silent' // Suppress logs in tests
