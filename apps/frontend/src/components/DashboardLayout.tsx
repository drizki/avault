import { ReactNode } from 'react'
import { Navbar } from '@/components/Navbar'

interface DashboardLayoutProps {
  children: ReactNode
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <div className="bg-background pt-2 px-2 flex flex-col min-h-screen md:h-screen md:overflow-hidden">
      <div className="shrink-0 mb-2">
        <Navbar />
      </div>
      <main className="flex-1 pb-2 md:overflow-hidden">
        {children}
      </main>
    </div>
  )
}
