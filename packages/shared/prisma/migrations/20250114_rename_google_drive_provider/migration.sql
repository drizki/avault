-- Rename google_drive provider to google_drive_shared
-- This migration updates existing credentials and destinations to use the new provider name

-- Update StorageCredential table
UPDATE "StorageCredential"
SET provider = 'google_drive_shared'
WHERE provider = 'google_drive';

-- Update StorageDestination table
UPDATE "StorageDestination"
SET provider = 'google_drive_shared'
WHERE provider = 'google_drive';
