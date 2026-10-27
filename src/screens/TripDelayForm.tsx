import { useState, type FormEvent } from "react";
import type { TripDelayInput } from "../tms/busing";
import { DELAY_LIMITS, delayLine, latestDelay } from "../tms/delays";
import type { Trip } from "../tms/types";
import { Button, Field, Notice, Panel, TextInput, formatDateTime } from "../ui/primitives";

type Errors = Record<string, string>;

/**
 * Report that a run is late, while it is still out (DSP-04, D-105).
 *
 * Two facts go in and both are required: how far behind the timetable the run is *now*, and what is
 * holding it up. A number without a reason is a rumour the office will repeat to a client; a reason
 * without a number cannot be put on a screen.
 *
 * The history is shown above the fields, because the second report of the morning is usually the
 * delay getting worse — or the run catching up, which is an entry too (0 minutes). Nothing here
 * edits an earlier entry: what was said at 07:20 stays said.
 */
export function TripDelayForm({
  trip,
  onClose,
  onSubmit,
}: {
  trip: Trip;
  onClose: () => void;
  onSubmit: (input: TripDelayInput) => Errors | Promise<Errors>;
}) {
  const previous = latestDelay(trip);
  const [minutes, setMinutes] = useState(previous && previous.minutes > 0 ? String(previous.minutes) : "");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Errors>({});

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setErrors((await onSubmit({ minutes, reason })) ?? {});
  };

  return (
    <Panel
      title={previous && previous.minutes > 0 ? `How late is ${trip.reference} now?` : `Report a delay on ${trip.reference}`}
      description={
        previous
          ? `Last reported at ${formatDateTime(previous.at)}: ${delayLine(previous)}.`
          : "The dispatch desk, the driver's screen and the client's portal all show this until the run finishes."
      }
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field
          label="Minutes behind the timetable"
          hint={
            previous && previous.minutes > 0
              ? "How late the run is now. Enter 0 if it has caught up."
              : "How late the run is now — the number the office would say on the phone."
          }
          error={errors.minutes}
        >
          <TextInput
            type="number"
            inputMode="numeric"
            min={0}
            max={DELAY_LIMITS.maxMinutes}
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            invalid={!!errors.minutes}
            autoFocus
          />
        </Field>
        <Field
          label="What is holding the run up?"
          hint="Traffic, a closed road, a breakdown, a late passenger. Kept with the run and in the audit log."
          error={errors.reason}
        >
          <TextInput
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            invalid={!!errors.reason}
            placeholder="Traffic at the Spintex junction"
          />
        </Field>

        {previous && previous.minutes === 0 && (
          <Notice tone="info">
            The last report said the run had caught up. A new report that is still late says it fell behind again.
          </Notice>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose}>Close</Button>
          <Button type="submit" variant="primary">
            Record the delay
          </Button>
        </div>
      </form>
    </Panel>
  );
}
