import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
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

import { GoogleDriveMyDriveAdapter } from '../google-drive-my-drive'

describe('GoogleDriveMyDriveAdapter', () => {
  let adapter: GoogleDriveMyDriveAdapter
  const credentials = {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    expiry_date: Date.now() + 3600000,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    adapter = new GoogleDriveMyDriveAdapter()
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

    it('does not update credentials when tokens event fires without refresh_token', async () => {
      let tokensCallback: ((tokens: any) => void) | null = null
      mocks.on.mockImplementation((event: string, callback: (tokens: any) => void) => {
        if (event === 'tokens') {
          tokensCallback = callback
        }
      })

      await adapter.initialize(credentials)
      vi.clearAllMocks()

      // Simulate the tokens event being fired without refresh_token
      tokensCallback!({ access_token: 'new-access-token' })

      // setCredentials should not be called again
      expect(mocks.setCredentials).not.toHaveBeenCalled()
    })
  })

  describe('listDestinations()', () => {
    it('throws error if not initialized', async () => {
      await expect(adapter.listDestinations()).rejects.toThrow('Adapter not initialized')
    })

    it('returns My Drive as single destination with user name', async () => {
      await adapter.initialize(credentials)

      mocks.aboutGet.mockResolvedValue({
        data: {
          user: {
            displayName: 'John Doe',
            emailAddress: 'john@example.com',
          },
        },
      })

      const destinations = await adapter.listDestinations()

      expect(destinations).toHaveLength(1)
      expect(destinations[0]).toEqual({
        id: 'root',
        name: 'My Drive (John Doe)',
        provider: 'google_drive_my_drive',
        metadata: {
          email: 'john@example.com',
        },
      })
    })

    it('falls back to email when displayName is missing', async () => {
      await adapter.initialize(credentials)

      mocks.aboutGet.mockResolvedValue({
        data: {
          user: {
            emailAddress: 'user@example.com',
          },
        },
      })

      const destinations = await adapter.listDestinations()

      expect(destinations[0].name).toBe('My Drive (user@example.com)')
    })

    it('falls back to "My Drive" when no user info', async () => {
      await adapter.initialize(credentials)

      mocks.aboutGet.mockResolvedValue({ data: { user: null } })

      const destinations = await adapter.listDestinations()

      expect(destinations[0].name).toBe('My Drive (My Drive)')
    })
  })

  describe('listFolders()', () => {
    it('throws error if not initialized', async () => {
      await expect(adapter.listFolders('root')).rejects.toThrow('Adapter not initialized')
    })

    it('lists folders in root', async () => {
      await adapter.initialize(credentials)

      mocks.filesList.mockResolvedValue({
        data: {
          files: [
            { id: 'folder-1', name: 'Backups', createdTime: '2024-01-15T10:00:00Z', modifiedTime: '2024-01-15T12:00:00Z' },
            { id: 'folder-2', name: 'Documents' },
          ],
        },
      })

      const folders = await adapter.listFolders('root')

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

      await adapter.listFolders('root', 'parent-folder-id')

      expect(mocks.filesList).toHaveBeenCalledWith(
        expect.objectContaining({
          q: "'parent-folder-id' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false",
        })
      )
    })
  })

  describe('createFolder()', () => {
    it('throws error if not initialized', async () => {
      await expect(adapter.createFolder('root', 'New Folder')).rejects.toThrow('Adapter not initialized')
    })

    it('creates a folder in root', async () => {
      await adapter.initialize(credentials)

      mocks.filesCreate.mockResolvedValue({
        data: {
          id: 'new-folder-id',
          name: 'New Folder',
          createdTime: '2024-01-15T10:00:00Z',
          modifiedTime: '2024-01-15T10:00:00Z',
        },
      })

      const folder = await adapter.createFolder('root', 'New Folder')

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
          parents: ['root'],
        },
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

      await adapter.createFolder('root', 'Subfolder', 'parent-folder-id')

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
      await expect(adapter.deleteFolder('root', 'folder-name')).rejects.toThrow('Adapter not initialized')
    })

    it('deletes a folder by name', async () => {
      await adapter.initialize(credentials)

      mocks.filesList.mockResolvedValue({
        data: {
          files: [{ id: 'folder-id', name: 'Folder to Delete' }],
        },
      })
      mocks.filesDelete.mockResolvedValue({})

      await adapter.deleteFolder('root', 'Folder to Delete')

      expect(mocks.filesDelete).toHaveBeenCalledWith({
        fileId: 'folder-id',
      })
    })

    it('throws error when folder not found', async () => {
      await adapter.initialize(credentials)

      mocks.filesList.mockResolvedValue({ data: { files: [] } })

      await expect(adapter.deleteFolder('root', 'NonExistent')).rejects.toThrow('Folder not found: NonExistent')
    })
  })

  describe('listBackups()', () => {
    it('throws error if not initialized', async () => {
      await expect(adapter.listBackups('root', '')).rejects.toThrow('Adapter not initialized')
    })

    it('lists backup folders in root', async () => {
      await adapter.initialize(credentials)

      mocks.filesList.mockResolvedValue({
        data: {
          files: [
            { id: 'backup-1', name: 'backup-2024-01-15', createdTime: '2024-01-15T10:00:00Z', size: '1024' },
            { id: 'backup-2', name: 'backup-2024-01-14', createdTime: '2024-01-14T10:00:00Z' },
          ],
        },
      })

      const backups = await adapter.listBackups('root', '')

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

      await expect(adapter.renameFolder('root', 'old-name', 'new-name')).rejects.toThrow('Rename not implemented for Google Drive My Drive')
    })
  })

  describe('uploadFile()', () => {
    it('throws error if not initialized', async () => {
      const mockStream = { pipe: vi.fn() } as any

      await expect(
        adapter.uploadFile({
          destinationId: 'root',
          folderPath: 'backup-folder',
          fileName: 'test.txt',
          fileStream: mockStream,
          fileSize: 100,
          mimeType: 'text/plain',
        })
      ).rejects.toThrow('Adapter not initialized')
    })

    it('uploads file to root folder', async () => {
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
        destinationId: 'root',
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
          destinationId: 'root',
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
        destinationId: 'root',
        folderPath: 'backup-folder',
        fileName: 'subdir/file.txt',
        fileStream: mockStream,
        fileSize: 100,
        mimeType: 'text/plain',
      })

      expect(result.path).toBe('backup-folder/subdir/file.txt')
    })

    it('uses existing nested folder if found', async () => {
      await adapter.initialize(credentials)

      // Mock finding the backup folder
      mocks.filesList.mockResolvedValueOnce({
        data: { files: [{ id: 'backup-folder-id', name: 'backup-folder' }] },
      })
      // Mock checking for nested folder (found)
      mocks.filesList.mockResolvedValueOnce({
        data: { files: [{ id: 'existing-subdir-id', name: 'subdir' }] },
      })
      // Mock uploading file
      mocks.filesCreate.mockResolvedValueOnce({
        data: { id: 'file-id', name: 'file.txt', size: '100' },
      })

      const mockStream = {
        pipe: vi.fn().mockReturnThis(),
      } as any

      await adapter.uploadFile({
        destinationId: 'root',
        folderPath: 'backup-folder',
        fileName: 'subdir/file.txt',
        fileStream: mockStream,
        fileSize: 100,
        mimeType: 'text/plain',
      })

      // Should only call filesCreate once (for the file, not the folder)
      expect(mocks.filesCreate).toHaveBeenCalledTimes(1)
    })
  })
})
