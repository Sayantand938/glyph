import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function ExitDialog({
  open,
  onOpenChange,
  onLeave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onLeave: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Leave this session?</DialogTitle>
          <DialogDescription>
            Every answer so far is already saved. The remaining cards will be
            waiting next time.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep studying
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false)
              onLeave()
            }}
          >
            Leave
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
