export type DiffEvent = {
  googleEventId: string;
  title: string;
  location: string | null;
  startAt: Date;
  endAt: Date;
};

export type ScheduleChange =
  | { kind: 'moved'; before: DiffEvent; after: DiffEvent }
  | { kind: 'room'; before: DiffEvent; after: DiffEvent }
  | { kind: 'cancelled'; before: DiffEvent }
  | { kind: 'added'; after: DiffEvent };

/**
 * What changed for students between two snapshots of one course calendar.
 * Only classes between `now` and `now + horizonMs` count, and description-only
 * edits (most of the "Updated invitation" noise) are ignored. A class deleted
 * and re-created at another time with the same title is reported as moved.
 */
export function diffSchedule(before: DiffEvent[], after: DiffEvent[], now: Date, horizonMs: number): ScheduleChange[] {
  const end = now.getTime() + horizonMs;
  const relevant = (e: DiffEvent) => e.startAt.getTime() >= now.getTime() && e.startAt.getTime() <= end;
  const afterById = new Map(after.map((e) => [e.googleEventId, e]));
  const beforeIds = new Set(before.map((e) => e.googleEventId));

  const changes: ScheduleChange[] = [];
  const cancelled: DiffEvent[] = [];
  for (const b of before) {
    const a = afterById.get(b.googleEventId);
    if (!a) {
      if (relevant(b)) cancelled.push(b);
      continue;
    }
    if (!relevant(b) && !relevant(a)) continue;
    if (a.startAt.getTime() !== b.startAt.getTime() || a.endAt.getTime() !== b.endAt.getTime()) {
      changes.push({ kind: 'moved', before: b, after: a });
    } else if ((a.location ?? '') !== (b.location ?? '')) {
      changes.push({ kind: 'room', before: b, after: a });
    }
  }

  const added = after.filter((a) => !beforeIds.has(a.googleEventId) && relevant(a));
  for (const b of cancelled) {
    const i = added.findIndex((a) => a.title === b.title);
    if (i >= 0) {
      changes.push({ kind: 'moved', before: b, after: added[i] });
      added.splice(i, 1);
    } else {
      changes.push({ kind: 'cancelled', before: b });
    }
  }
  for (const a of added) changes.push({ kind: 'added', after: a });

  return changes.sort((x, y) => when(x) - when(y));
}

function when(c: ScheduleChange): number {
  return ('before' in c ? c.before : c.after).startAt.getTime();
}
