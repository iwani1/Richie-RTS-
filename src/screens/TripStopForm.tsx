import { useState, type FormEvent } from "react";
import type { ManifestRider } from "../tms/bookings";
import type { ProgressiveStopInput } from "../tms/busing";
import { stopDetailLine, stopMapLink } from "../tms/stops";
import type { BoardingOutcome, BusRoute, Trip } from "../tms/types";
import { Button, Field, Notice, Panel, Select, TextInput, formatDateTime } from "../ui/primitives";

type Errors = Record<string, string>;

/**
 * One immutable stop record: actual arrival time plus an outcome for everyone expected here.
 *
 * The list is the run's manifest — the route roster *and* the riders holding a booked seat at this
 * stop (D-85). A visitor left off it is a visitor nobody records, and the office would never know
 * whether they were carried.
 */
export function TripStopForm({
  trip,
  route,
  manifest,
  onClose,
  onSubmit,
}: {
  trip: Trip;
  route: BusRoute;
  manifest: ManifestRider[];
  onClose: () => void;
  onSubmit: (input: ProgressiveStopInput) => Errors | Promise<Errors>;
}) {
  const stop = route.stops[trip.stopLogs.length];
  const passengers = stop
    ? manifest.filter((entry) => entry.pickupStopId === stop.id && !trip.boardings.some((b) => b.passengerId === entry.passenger.id))
    : [];
  const [actualTime, setActualTime] = useState("");
  const [outcomes, setOutcomes] = useState<Record<string, "" | BoardingOutcome>>({});
  const [errors, setErrors] = useState<Errors>({});

  if (!stop) {
    return (
      <Panel title={`No stops remain: ${trip.reference}`} onClose={onClose}>
        <Notice tone="info">Every stop is already recorded. Complete the run from its trip row.</Notice>
        <div className="mt-4 flex justify-end"><Button onClick={onClose}>Close</Button></div>
      </Panel>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const localErrors: Errors = {};
    const missing = passengers.find((entry) => !outcomes[entry.passenger.id]);
    if (missing) localErrors.boardings = `Record whether ${missing.passenger.fullName} boarded at ${stop.name}.`;
    if (Object.keys(localErrors).length) {
      setErrors(localErrors);
      return;
    }
    setErrors((await onSubmit({
      stopId: stop.id,
      actualTime,
      boardings: passengers.map((entry) => ({ passengerId: entry.passenger.id, outcome: outcomes[entry.passenger.id] as BoardingOutcome })),
    })) ?? {});
  };

  return (
    <Panel
      title={`Record stop: ${trip.reference}`}
      description={`${stop.name} · stop ${trip.stopLogs.length + 1} of ${route.stops.length}. Scheduled ${stop.scheduledTime}. Stops are recorded in route order.`}
      onClose={onClose}
    >
      {/* RTE-01: what the driver should be looking at, and a link to it. The form is opened at the
          stop, so this is a check that they are at the right one before anyone is marked as no-show. */}
      <div className="mb-4 rounded-sm border border-[color:var(--rts-line)] bg-[var(--rts-paper-2)] px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">This stop</p>
        <p className="text-sm text-stone-800">{stopDetailLine(stop) || <em className="rts-unset">no directions recorded</em>}</p>
        {stopMapLink(stop) && (
          <a className="text-xs underline" href={stopMapLink(stop)!} target="_blank" rel="noreferrer">
            Open in maps
          </a>
        )}
      </div>
      {/* Q-48: nothing is pushed anywhere, so the run carries the marker. It sits above the stop
          fields because it changes who is expected at the stop being recorded right now. */}
      {trip.rosterChanges.length > 0 && (
        <Notice tone="warning" title={`The roster changed since this run started (${trip.rosterChanges.length})`} className="mb-4">
          <ul className="mt-1 space-y-1 text-sm">
            {trip.rosterChanges.map((change) => (
              <li key={change.id}>
                <span className="rts-mono text-xs text-stone-600">{formatDateTime(change.at)}</span> · {change.summary}{" "}
                <span className="text-xs text-stone-500">({change.by})</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-stone-600">
            The list of riders below is the roster and the seats booked for this run, as they are now. Record an
            outcome for everyone still shown at this stop.
          </p>
        </Notice>
      )}
      <form onSubmit={submit} className="space-y-4">
        <Field label={`Actual arrival at ${stop.name}`} error={errors.actualTime}>
          <TextInput type="time" value={actualTime} onChange={(event) => setActualTime(event.target.value)} invalid={!!errors.actualTime} autoFocus />
        </Field>
        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500">Boarding at this stop ({passengers.length})</h3>
          {passengers.length === 0 ? (
            <p className="text-sm text-stone-500">Nobody is expected at this stop. Only the arrival time will be recorded.</p>
          ) : (
            <ul className="space-y-2">
              {passengers.map((entry) => (
                <li key={entry.passenger.id}>
                  <Field
                    label={entry.passenger.fullName}
                    hint={
                      entry.source === "booking"
                        ? `Booked seat ${entry.bookingReference ?? ""} — not on the regular roster.`
                        : "No phone number or employee reference is shown."
                    }
                  >
                    <Select
                      value={outcomes[entry.passenger.id] ?? ""}
                      onChange={(event) => setOutcomes({ ...outcomes, [entry.passenger.id]: event.target.value as "" | BoardingOutcome })}
                    >
                      <option value="">Select outcome</option>
                      <option value="boarded">Boarded</option>
                      <option value="no_show">Did not board</option>
                    </Select>
                  </Field>
                </li>
              ))}
            </ul>
          )}
          {errors.boardings && <p className="mt-2 text-xs font-medium text-red-700" role="alert">{errors.boardings}</p>}
        </section>
        <Notice tone="info">This stop record is appended to the run. It cannot be edited after submission; any correction must follow an audited operations process.</Notice>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Close</Button>
          <Button type="submit" variant="primary">Save stop</Button>
        </div>
      </form>
    </Panel>
  );
}