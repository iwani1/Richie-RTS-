"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * What "New booking" does until booking intake exists.
 *
 * The button is on the page because it is the primary action of the screen, and a primary action
 * that silently does nothing is worse than one that explains itself. This dialog says plainly where
 * the action lives today and offers the one route that actually records a request.
 */
export function BookingIntakeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New booking</DialogTitle>
          <DialogDescription>
            Booking intake is built in the next phase of this interface. Until it lands, a new rental request is recorded
            in the live application, which writes to the real database.
          </DialogDescription>
        </DialogHeader>
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          This review build changes no records. It has no write path of its own, and it says so rather than accepting a
          booking it could not keep.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button asChild>
            <Link href="/">Open the live application</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
