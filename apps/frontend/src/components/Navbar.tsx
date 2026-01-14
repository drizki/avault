import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SettingsSheet } from '@/components/SettingsSheet'

export function Navbar() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  return (
    <>
      <nav className="flex p-2 items-center justify-between border border-border bg-card gap-2">
        {/* Logo */}
        <Link to="/" className="flex items-center ml-1">
          <img src="/logo.svg" alt="Avault" className="h-5" />
        </Link>

        {/* Settings */}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={() => setIsSettingsOpen(true)}
        >
          <Settings className="h-4 w-4" />
        </Button>
      </nav>

      <SettingsSheet open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
    </>
  )
}
