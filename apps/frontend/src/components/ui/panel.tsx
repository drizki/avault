import * as React from 'react'
import { cn } from '@/lib/utils'

interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {}

const Panel = React.forwardRef<HTMLDivElement, PanelProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn('border border-border bg-card', className)}
        {...props}
      >
        {children}
      </div>
    )
  }
)
Panel.displayName = 'Panel'

interface PanelHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  actions?: React.ReactNode
}

const PanelHeader = React.forwardRef<HTMLDivElement, PanelHeaderProps>(
  ({ className, actions, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'flex h-8 items-center justify-between border-b border-border bg-secondary/50 px-3',
          className
        )}
        {...props}
      >
        <div className="flex items-center gap-2">
          {children}
        </div>
        {actions && (
          <div className="flex items-center gap-1">
            {actions}
          </div>
        )}
      </div>
    )
  }
)
PanelHeader.displayName = 'PanelHeader'

const PanelTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn('text-[13px] font-semibold text-foreground', className)}
    {...props}
  />
))
PanelTitle.displayName = 'PanelTitle'

const PanelContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn('p-3 overflow-auto', className)}
      {...props}
    />
  )
})
PanelContent.displayName = 'PanelContent'

export { Panel, PanelHeader, PanelTitle, PanelContent }
