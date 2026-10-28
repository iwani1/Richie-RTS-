"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TripStatusBadge } from "./StatusBadge";
import type { LiveTrip } from "@/lib/mock/types";

/**
 * What a run is, opened from its row.
 *
 * The board's rows are the only place a run appears, so a row that cannot be opened leaves the reader
 * with a reference and no way to see what it means. This shows the fields the board actually holds and
 * says plainly what it cannot show — there is no location history, no ticket and no crew sheet behind
 * it in this build, and inventing any of them would be worse than the empty space.
 */
export function TripDetailDialog({ trip, onOpenChange }: { trip: LiveTrip | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={trip !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {trip && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="tms-mono text-foreground">{trip.id}</span>
                <TripStatusBadge status={trip.status} />
              </DialogTitle>
              <DialogDescription>{trip.route}</DialogDescription>
            </DialogHeader>

            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-[13px]">
              <dt className="tms-mono text-dim">Driver</dt>
              <dd className="text-foreground">{trip.driver}</dd>
              <dt className="tms-mono text-dim">Vehicle</dt>
              <dd className="tms-mono text-foreground">{trip.vehicle}</dd>
              <dt className="tms-mono text-dim">Arrival</dt>
              <dd className="tms-mono text-foreground">
                {trip.eta ? (
                  <>
                    {trip.eta}
                    {trip.delayMinutes > 0 && <span className="ml-2 text-warning">+{trip.delayMinutes}m late</span>}
                  </>
                ) : (
                  "—"
                )}
              </dd>
            </dl>

            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              This is everything the board holds for a run. Track history, the crew sheet and the ticket count live in
              the live application; nothing here is a record, and the positions on the map are illustrative.
            </p>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button asChild>
                <Link href="/">Open the live application</Link>
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
