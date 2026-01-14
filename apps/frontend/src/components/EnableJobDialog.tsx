import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Loader2 } from 'lucide-react'

interface EnableJobDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  jobName: string
  onEnable: () => Promise<void>
  onSkip: () => void
  isEnabling?: boolean
}

export function EnableJobDialog({
  open,
  onOpenChange,
  jobName,
  onEnable,
  onSkip,
  isEnabling = false,
}: EnableJobDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Enable Backup Job?</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-medium text-foreground">"{jobName}"</span> has been created
            successfully.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <p className="text-sm text-muted-foreground">
          Enable now to start running backups on schedule?
        </p>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onSkip} disabled={isEnabling}>
            Skip
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onEnable}
            disabled={isEnabling}
            className="bg-primary hover:bg-primary/90"
          >
            {isEnabling ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Enabling...
              </>
            ) : (
              'Enable Now'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
