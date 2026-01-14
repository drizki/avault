import React, { createContext, useContext, useState, useEffect } from 'react'
import { api } from '../api'

interface User {
  id: string
  email: string
  name: string | null
  avatarUrl: string | null
  role: 'ADMIN' | 'USER'
  createdAt: string
  lastLoginAt: string | null
}

interface AuthContextValue {
  user: User | null
  isLoading: boolean
  isAuthenticated: boolean
  isAdmin: boolean
  login: () => Promise<void>
  logout: () => Promise<void>
  refetch: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Fetch current user on mount
  useEffect(() => {
    fetchUser()
  }, [])

  async function fetchUser() {
    setIsLoading(true)
    try {
      const response = await api.get<User>('/auth/me')

      if (response.success && response.data) {
        setUser(response.data)
      } else {
        setUser(null)
      }
    } catch (error) {
      console.error('Failed to fetch user:', error)
      setUser(null)
    } finally {
      setIsLoading(false)
    }
  }

  async function login() {
    try {
      // Call the backend to get the Google OAuth URL
      const response = await api.post<{ authUrl: string; state: string }>('/auth/login/google')

      if (response.success && response.data) {
        // Redirect to Google OAuth
        window.location.href = response.data.authUrl
      } else {
        throw new Error(response.error || 'Failed to initialize login')
      }
    } catch (error: unknown) {
      console.error('Login error:', error)
      throw error
    }
  }

  async function logout() {
    try {
      await api.post('/auth/logout')
      setUser(null)
      window.location.href = '/login'
    } catch (error) {
      console.error('Logout error:', error)
    }
  }

  async function refetch() {
    await fetchUser()
  }

  const isAuthenticated = !!user
  const isAdmin = user?.role === 'ADMIN'

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated,
        isAdmin,
        login,
        logout,
        refetch,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
