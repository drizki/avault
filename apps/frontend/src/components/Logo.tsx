import { cn } from '@/lib/utils'

type LogoVariant = 'full' | 'icon'
type LogoSize = 'sm' | 'md' | 'lg'

interface LogoProps {
  variant?: LogoVariant
  size?: LogoSize
  className?: string
}

const sizeConfig = {
  sm: {
    full: 'h-6',
    icon: 'h-5 w-5',
  },
  md: {
    full: 'h-8',
    icon: 'h-7 w-7',
  },
  lg: {
    full: 'h-12',
    icon: 'h-10 w-10',
  },
}

export function Logo({ variant = 'full', size = 'md', className }: LogoProps) {
  const config = sizeConfig[size]

  if (variant === 'icon') {
    return (
      <img
        src="/favicon.svg"
        alt="Avault"
        className={cn(config.icon, className)}
      />
    )
  }

  return (
    <img
      src="/logo.svg"
      alt="Avault"
      className={cn(config.full, className)}
    />
  )
}
