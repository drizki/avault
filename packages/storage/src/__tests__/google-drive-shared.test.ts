/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  drivesList: vi.fn(),
  drivesCreate: vi.fn(),
  filesList: vi.fn(),
  filesCreate: vi.fn(),
  filesDelete: vi.fn(),
  aboutGet: vi.fn(),
  setCredentials: vi.fn(),
  on: vi.fn(),
}))

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        setCredentials: mocks.setCredentials,
        on: mocks.on,
      })),
    },
    drive: vi.fn().mockReturnValue({
      drives: {
        list: mocks.drivesList,
        create: mocks.drivesCreate,
      },
      files: {
        list: mocks.filesList,
        create: mocks.filesCreate,
        delete: mocks.filesDelete,
      },
      about: {
        get: mocks.aboutGet,
      },
    }),
  },
}))

import { GoogleDriveSharedAdapter } from '../google-drive-shared'

describe('GoogleDriveSharedAdapter', () => {
  let adapter: GoogleDriveSharedAdapter
  const credentials = {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    expiry_date: Date.now() + 3600000,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    adapter = new GoogleDriveSharedAdapter()
  })

  describe('initialize()', () => {
    it('initializes OAuth2 client with credentials', async () => {
      await adapter.initialize(credentials)

      expect(mocks.setCredentials).toHaveBeenCalledWith({
        access_token: credentials.access_token,
        refresh_token: credentials.refresh_token,
        expiry_date: credentials.expiry_date,
      })
    })

    it('sets up token refresh listener', async () => {
      await adapter.initialize(credentials)

      expect(mocks.on).toHaveBeenCalledWith('tokens', expect.any(Function))
    })

    it('updates credentials when tokens event fires with refresh_token', async () => {
      let tokensCallback: ((tokens: any) => void) | null = null
      mocks.on.mockImplementation((event: string, callback: (tokens: any) => void) => {
        if (event === 'tokens') {
          tokensCallback = callback
        }
      })

      await adapter.initialize(credentials)

      // Simulate the tokens event being fired
      expect(tokensCallback).not.toBeNull()
      tokensCallback!({ refresh_token: 'new-refresh-token' })

      expect(mocks.setCredentials).toHaveBeenCalledWith({
        refresh_token: 'new-refresh-token',
      })
    })
  })

  describe('listDestinations()', () => {
    it('throws error if not initialized', async () => {
      await expect(adapter.listDestinations()).rejects.toThrow('Adapter not initialized')
    })

    it('returns list of shared drives', async () => {
      await adapter.initialize(credentials)

      mocks.drivesList.mockResolvedValue({
        data: {
          drives: [
            { id: 'drive-1', name: 'Team Drive 1', colorRgb: '#4285f4' },
            { id: 'drive-2', name: 'Team Drive 2' },
          ],
        },
      })

      const destinations = await adapter.listDestinations()

      expect(destinations).toHaveLength(2)
      expect(destinations[0]).toEqual({
        id: 'drive-1',
        name: 'Team Drive 1',
        provider: 'google_drive_shared',
        metadata: {
          colorRgb: '#4285f4',
          backgroundImageLink: undefined,
        },
      })
    })

    it('returns empty array when no drives', async () => {
      await adapter.initialize(credentials)

      mocks.drivesList.mockResolvedValue({ data: { drives: null } })

      const destinations = await adapter.listDestinations()

      expect(destinations).toEqual([])
    })
  })

  describe('createSharedDrive()', () => {
    it('throws error if not initialized', async () => {
      await expect(adapter.createSharedDrive('Test Drive')).rejects.toThrow('Adapter not initialized')
    })

    it('creates a new shared drive', async () => {
      await adapter.initialize(credentials)

      mocks.drivesCreate.mockResolvedValue({
        data: {
          id: 'new-drive-id',
          name: 'New Drive',
          colorRgb: '#4285f4',
        },
      })

      const result = await adapter.createSharedDrive('New Drive')

      expect(result).toEqual({
        id: 'new-drive-id',
        name: 'New Drive',
        provider: 'google_drive_shared',
        metadata: {
          colorRgb: '#4285f4',
          backgroundImageLink: undefined,
        },
      })
      expect(mocks.drivesCreate).toHaveBeenCalledWith({
        requestId: expect.stringMatching(/^avault-\d+-\w+$/),
        requestBody: { name: 'New Drive' },
      })
    })
  })

  describe('listFolders()', () => {
    it('throws error if not initialized', async () => {
      await expect(adapter.listFolders('drive-1')).rejects.toThrow('Adapter not initialized')
    })

    it('lists folders in a destination', async () => {
      await adapter.initialize(credentials)

      mocks.filesList.mockResolvedValue({
        data: {
          files: [
            { id: 'folder-1', name: 'Backups', createdTime: '2024-01-15T10:00:00Z', modifiedTime: '2024-01-15T12:00:00Z' },
            { id: 'folder-2', name: 'Archives', createdTime: '2024-01-14T10:00:00Z' },
          ],
        },
      })

      const folders = await adapter.listFolders('drive-1')

      expect(folders).toHaveLength(2)
      expect(folders[0]).toEqual({
        id: 'folder-1',
        name: 'Backups',
        path: 'Backups',
        createdTime: new Date('2024-01-15T10:00:00Z'),
        modifiedTime: new Date('2024-01-15T12:00:00Z'),
      })
    })

    it('lists folders under a parent folder', async () => {
      await adapter.initialize(credentials)

      mocks.filesList.mockResolvedValue({ data: { files: [] } })

      await adapter.listFolders('drive-1', 'parent-folder-id')

      expect(mocks.filesList).toHaveBeenCalledWith(
        expect.objectContaining({
          q: "'parent-folder-id' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false",
        })
      )
    })
  })

  describe('createFolder()', () => {
    it('throws error if not initialized', async () => {
      await expect(adapter.createFolder('drive-1', 'New Folder')).rejects.toThrow('Adapter not initialized')
    })

    it('creates a folder in destination root', async () => {
      await adapter.initialize(credentials)

      mocks.filesCreate.mockResolvedValue({
        data: {
          id: 'new-folder-id',
          name: 'New Folder',
          createdTime: '2024-01-15T10:00:00Z',
          modifiedTime: '2024-01-15T10:00:00Z',
        },
      })

      const folder = await adapter.createFolder('drive-1', 'New Folder')

      expect(folder).toEqual({
        id: 'new-folder-id',
        name: 'New Folder',
        path: 'New Folder',
        createdTime: new Date('2024-01-15T10:00:00Z'),
        modifiedTime: new Date('2024-01-15T10:00:00Z'),
      })
      expect(mocks.filesCreate).toHaveBeenCalledWith({
        requestBody: {
          name: 'New Folder',
          mimeType: 'application/vnd.google-apps.folder',
          parents: ['drive-1'],
        },
        supportsAllDrives: true,
        fields: 'id, name, mimeType, createdTime, modifiedTime',
      })
    })

    it('creates a folder under parent folder', async () => {
      await adapter.initialize(credentials)

      mocks.filesCreate.mockResolvedValue({
        data: {
          id: 'subfolder-id',
          name: 'Subfolder',
          createdTime: '2024-01-15T10:00:00Z',
          modifiedTime: '2024-01-15T10:00:00Z',
        },
      })

      await adapter.createFolder('drive-1', 'Subfolder', 'parent-folder-id')

      expect(mocks.filesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            parents: ['parent-folder-id'],
          }),
        })
      )
    })
  })

  describe('deleteFolder()', () => {
    it('throws error if not initialized', async () => {
      await expect(adapter.deleteFolder('drive-1', 'folder-name')).rejects.toThrow('Adapter not initialized')
    })

    it('deletes a folder by name', async () => {
      await adapter.initialize(credentials)

      mocks.filesList.mockResolvedValue({
        data: {
          files: [{ id: 'folder-id', name: 'Folder to Delete' }],
        },
      })
      mocks.filesDelete.mockResolvedValue({})

      await adapter.deleteFolder('drive-1', 'Folder to Delete')

      expect(mocks.filesDelete).toHaveBeenCalledWith({
        fileId: 'folder-id',
        supportsAllDrives: true,
      })
    })

    it('throws error when folder not found', async () => {
      await adapter.initialize(credentials)

      mocks.filesList.mockResolvedValue({ data: { files: [] } })

      await expect(adapter.deleteFolder('drive-1', 'NonExistent')).rejects.toThrow('Folder not found: NonExistent')
    })
  })

  describe('listBackups()', () => {
    it('throws error if not initialized', async () => {
      await expect(adapter.listBackups('drive-1', '')).rejects.toThrow('Adapter not initialized')
    })

    it('lists backup folders in destination', async () => {
      await adapter.initialize(credentials)

      mocks.filesList.mockResolvedValue({
        data: {
          files: [
            { id: 'backup-1', name: 'backup-2024-01-15', createdTime: '2024-01-15T10:00:00Z', size: '1024' },
            { id: 'backup-2', name: 'backup-2024-01-14', createdTime: '2024-01-14T10:00:00Z' },
          ],
        },
      })

      const backups = await adapter.listBackups('drive-1', '')

      expect(backups).toHaveLength(2)
      expect(backups[0]).toEqual({
        name: 'backup-2024-01-15',
        path: 'backup-2024-01-15',
        createdTime: new Date('2024-01-15T10:00:00Z'),
        size: 1024,
      })
      expect(backups[1].size).toBeUndefined()
    })
  })

  describe('validateCredentials()', () => {
    it('returns false if not initialized', async () => {
      const result = await adapter.validateCredentials()
      expect(result).toBe(false)
    })

    it('returns true for valid credentials', async () => {
      await adapter.initialize(credentials)
      mocks.aboutGet.mockResolvedValue({ data: { user: {} } })

      const result = await adapter.validateCredentials()

      expect(result).toBe(true)
    })

    it('returns false when API call fails', async () => {
      await adapter.initialize(credentials)
      mocks.aboutGet.mockRejectedValue(new Error('Invalid credentials'))

      const result = await adapter.validateCredentials()

      expect(result).toBe(false)
    })
  })

  describe('renameFolder()', () => {
    it('throws not implemented error', async () => {
      await adapter.initialize(credentials)

      await expect(adapter.renameFolder('drive-1', 'old-name', 'new-name')).rejects.toThrow('Rename not implemented for Google Drive Shared')
    })
  })

  describe('preBuildFolderStructure()', () => {
    it('throws error if not initialized', async () => {
      await expect(adapter.preBuildFolderStructure('drive-1', 'root-id', 'root-name', ['a/b.txt'])).rejects.toThrow('Adapter not initialized')
    })

    it('pre-builds folder structure for file paths', async () => {
      await adapter.initialize(credentials)

      // Mock folder existence check
      mocks.filesList.mockResolvedValue({ data: { files: [] } })
      // Mock folder creation
      mocks.filesCreate.mockResolvedValue({
        data: { id: 'new-folder-id', name: 'subdir' },
      })

      await adapter.preBuildFolderStructure('drive-1', 'root-folder-id', 'backup-2024-01-15', [
        'subdir/file1.txt',
        'subdir/nested/file2.txt',
      ])

      // Should check for/create 'subdir' and 'subdir/nested'
      expect(mocks.filesList).toHaveBeenCalled()
      expect(mocks.filesCreate).toHaveBeenCalled()
    })

    it('uses cached folder if already exists', async () => {
      await adapter.initialize(credentials)

      // Return existing folder
      mocks.filesList.mockResolvedValue({
        data: { files: [{ id: 'existing-folder-id', name: 'subdir' }] },
      })

      await adapter.preBuildFolderStructure('drive-1', 'root-folder-id', 'backup-2024-01-15', [
        'subdir/file1.txt',
      ])

      // Should find existing folder, not create new one
      expect(mocks.filesCreate).not.toHaveBeenCalled()
    })
  })

  describe('uploadFile()', () => {
    it('throws error if not initialized', async () => {
      const mockStream = { pipe: vi.fn() } as any

      await expect(
        adapter.uploadFile({
          destinationId: 'drive-1',
          folderPath: 'backup-folder',
          fileName: 'test.txt',
          fileStream: mockStream,
          fileSize: 100,
          mimeType: 'text/plain',
        })
      ).rejects.toThrow('Adapter not initialized')
    })

    it('uploads file to destination folder', async () => {
      await adapter.initialize(credentials)

      // Mock finding the backup folder
      mocks.filesList.mockResolvedValueOnce({
        data: { files: [{ id: 'backup-folder-id', name: 'backup-folder' }] },
      })

      // Mock file upload
      mocks.filesCreate.mockResolvedValue({
        data: {
          id: 'file-id',
          name: 'test.txt',
          size: '100',
        },
      })

      const mockStream = {
        pipe: vi.fn().mockReturnThis(),
      } as any

      const result = await adapter.uploadFile({
        destinationId: 'drive-1',
        folderPath: 'backup-folder',
        fileName: 'test.txt',
        fileStream: mockStream,
        fileSize: 100,
        mimeType: 'text/plain',
      })

      expect(result).toEqual({
        fileId: 'file-id',
        fileName: 'test.txt',
        size: 100,
        path: 'backup-folder/test.txt',
      })
    })

    it('throws error when folder not found', async () => {
      await adapter.initialize(credentials)

      mocks.filesList.mockResolvedValue({ data: { files: [] } })

      const mockStream = {
        pipe: vi.fn().mockReturnThis(),
      } as any

      await expect(
        adapter.uploadFile({
          destinationId: 'drive-1',
          folderPath: 'nonexistent-folder',
          fileName: 'test.txt',
          fileStream: mockStream,
          fileSize: 100,
          mimeType: 'text/plain',
        })
      ).rejects.toThrow('Folder not found: nonexistent-folder')
    })

    it('creates nested folders during upload', async () => {
      await adapter.initialize(credentials)

      // Mock finding the backup folder
      mocks.filesList.mockResolvedValueOnce({
        data: { files: [{ id: 'backup-folder-id', name: 'backup-folder' }] },
      })
      // Mock checking for nested folder (not found)
      mocks.filesList.mockResolvedValueOnce({
        data: { files: [] },
      })
      // Mock creating nested folder
      mocks.filesCreate
        .mockResolvedValueOnce({
          data: { id: 'nested-folder-id', name: 'subdir' },
        })
        // Mock uploading file
        .mockResolvedValueOnce({
          data: { id: 'file-id', name: 'file.txt', size: '100' },
        })

      const mockStream = {
        pipe: vi.fn().mockReturnThis(),
      } as any

      const result = await adapter.uploadFile({
        destinationId: 'drive-1',
        folderPath: 'backup-folder',
        fileName: 'subdir/file.txt',
        fileStream: mockStream,
        fileSize: 100,
        mimeType: 'text/plain',
      })

      expect(result.path).toBe('backup-folder/subdir/file.txt')
    })
  })
})
