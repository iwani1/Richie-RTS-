import { useState, type FormEvent } from "react";
import type { ProgressiveStopInput } from "../tms/busing";
import type { BoardingOutcome, BusRoute, Passenger, Trip } from "../tms/types";
import { Button, Field, Notice, Panel, Select, TextInput, formatDateTime } from "../ui/primitives";

type Errors = Record<string, string>;

/** One immutable stop record: actual arrival time plus outcomes for this stop's roster. */
export function TripStopForm({
  trip,
  route,
  roster,
  onClose,
  onSubmit,
}: {
  trip: Trip;
  route: BusRoute;
  roster: Passenger[];
  onClose: () => void;
  onSubmit: (input: ProgressiveStopInput) => Errors | Promise<Errors>;
}) {
  const stop = route.stops[trip.stopLogs.length];
  const passengers = stop
    ? roster.filter((passenger) => passenger.status === "active" && passenger.stopId === stop.id && !trip.boardings.some((b) => b.passengerId === passenger.id))
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
    const missing = passengers.find((passenger) => !outcomes[passenger.id]);
    if (missing) localErrors.boardings = `Record whether ${missing.fullName} boarded at ${stop.name}.`;
    if (Object.keys(localErrors).length) {
      setErrors(localErrors);
      return;
    }
    setErrors((await onSubmit({
      stopId: stop.id,
      actualTime,
      boardings: passengers.map((passenger) => ({ passengerId: passenger.id, outcome: outcomes[passenger.id] as BoardingOutcome })),
    })) ?? {});
  };

  return (
    <Panel
      title={`Record stop: ${trip.reference}`}
      description={`${stop.name} · stop ${trip.stopLogs.length + 1} of ${route.stops.length}. Scheduled ${stop.scheduledTime}. Stops are recorded in route order.`}
      onClose={onClose}
    >
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
            The list of riders below is the roster as it is now. Record an outcome for everyone still shown at this stop.
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
            <p className="text-sm text-stone-500">No active passengers are assigned to this stop. Only the arrival time will be recorded.</p>
          ) : (
            <ul className="space-y-2">
              {passengers.map((passenger) => (
                <li key={passenger.id}>
                  <Field label={passenger.fullName} hint="No phone number or employee reference is shown.">
                    <Select value={outcomes[passenger.id] ?? ""} onChange={(event) => setOutcomes({ ...outcomes, [passenger.id]: event.target.value as "" | BoardingOutcome })}>
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