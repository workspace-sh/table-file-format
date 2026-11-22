import * as Gtk from "@gtkx/gi/gtk";
import { act, render, screen, userEvent, waitFor } from "@gtkx/testing";
import { fromBundle, showView } from "@workspace.sh/table-app";
import type { ParsedTable } from "@workspace.sh/table-core";
import { bundles } from "@workspace.sh/table-fixtures";
import { CalendarView, DisplaySettingsProvider } from "@workspace.sh/table-gtk";
import { calendarEntries, hourWindow, remembered, setCalendarRange, setViewMemory, weekDays } from "@workspace.sh/table-ui/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The calendar on GTK (#849), on the calendars example: a month of bars, a
// week over an hourly grid, an agenda, and what has no date. What goes where
// is table-ui's calendar module; these check GTK draws it and edits through it.

const held: Record<string, ParsedTable> = Object.assign({}, ...Object.entries(bundles).map(([key, b]) => fromBundle(key, b)));
const SCHEDULE = "4o3xeghnb4z7k";
const TIMELINE = "6upq9tqutnqp3";

function calendar(key: string, viewId: string, edits: { onUpdateRow?: (id: string, field: string, value: unknown) => void; onAddRow?: () => string } = {}) {
  const table = held[key]!;
  const shown = showView(held, key, table.views.find((v) => v.id === viewId)!);
  return render(
    <DisplaySettingsProvider value={{ locale: "en-GB" }}>
      <CalendarView view={shown.view} rows={shown.rows} schema={table.schema} bodies={table.bodies} {...edits} />
    </DisplaySettingsProvider>,
  );
}

const bar = async (title: string) => {
  const found = await screen.findAllByText(title);
  let at: Gtk.Widget | null = found[0] as unknown as Gtk.Widget;
  while (at && at.getName() !== "calendar-bar" && at.getName() !== "calendar-timed") at = at.getParent();
  return at!;
};
/** A month's day, by its number: the ground of its square in the week shown. */
const dayIn = async (week: number, column: number) => {
  const weeks = await screen.findAllByName("calendar-week");
  const days: Gtk.Widget[] = [];
  for (let c = weeks[week]!.getFirstChild(); c; c = c.getNextSibling()) if (c.getName() === "calendar-day") days.push(c);
  return days[column]!;
};

describe("a calendar on GTK", () => {
  const kept = new Map<string, string>();
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 10, 23, 12) });
    kept.clear();
    setViewMemory({ get: (k) => kept.get(k), set: (k, v) => void kept.set(k, v) });
  });
  afterEach(() => vi.useRealTimers());

  it("draws a month with an entry's span as one bar a week, and what doesn't fit as more", async () => {
    await calendar("calendars/milestones", TIMELINE);
    await screen.findByText("November 2026");
    // Sprint 24 runs 23 November to 4 December: a bar in each of the two weeks it covers.
    expect(await screen.findAllByText("Sprint 24")).toHaveLength(2);
    expect((await screen.findAllByText(/^\+\d+ more$/)).length).toBeGreaterThan(0);
  });

  it("moves a month at a time, goes to today, and jumps to a date", async () => {
    await calendar("calendars/milestones", TIMELINE);
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Next month" }));
    await screen.findByText("December 2026");
    await userEvent.click(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Today" }));
    await screen.findByText("November 2026");
  });

  it("keeps the range chosen on this device, not in the file, and draws a week over its hours", async () => {
    await calendar("calendars/events", SCHEDULE);
    await act(() => setCalendarRange(SCHEDULE, "week"));
    expect(remembered(`table-calendar-range:${SCHEDULE}`)).toBe("week");
    expect(held["calendars/events"]!.views.find((v) => v.id === SCHEDULE)).not.toHaveProperty("range");
    await screen.findByText("all-day");
    await screen.findByText("09:00");
    // Monday's meetings overlap, and share the day's width.
    const review = await bar("Design review");
    const call = await bar("Client call");
    await waitFor(() => expect(review.getWidth()).toBeGreaterThan(0));
    expect(Math.abs(review.getWidth() - call.getWidth())).toBeLessThan(4);
    expect(await screen.findByRole(Gtk.AccessibleRole.BUTTON, { name: "Previous week" })).toBeDefined();
  });

  it("lists the month by day as an agenda, a span under each day it covers", async () => {
    await calendar("calendars/milestones", TIMELINE);
    await act(() => setCalendarRange(TIMELINE, "agenda"));
    await screen.findByText("Monday 23 November");
    expect((await screen.findAllByText(/^Day \d+ of 12$/)).length).toBeGreaterThan(1);
  });

  it("shows what has no date when asked", async () => {
    await calendar("calendars/events", SCHEDULE);
    expect(screen.queryAllByText("Unscheduled workshop")).toHaveLength(0);
    await userEvent.click(await screen.findByName("calendar-no-date"));
    await screen.findByText("Unscheduled workshop");
  });

  it("lists what a search found by its day, wherever it is in time", async () => {
    const table = held["calendars/events"]!;
    const shown = showView(held, "calendars/events", table.views.find((v) => v.id === SCHEDULE)!);
    const found = shown.rows.filter((r) => /trip/i.test(String(r.title)));
    await render(
      <DisplaySettingsProvider value={{ locale: "en-GB" }}>
        <CalendarView view={shown.view} rows={found} schema={table.schema} searchQuery="trip" />
      </DisplaySettingsProvider>,
    );
    await screen.findByText(/^Tuesday,? 29 December 2026$/);
    await screen.findByText("Someday trip");
  });

  it("moves an entry dragged to another day, keeping its length, and resizes one by its end", async () => {
    const onUpdateRow = vi.fn();
    await calendar("calendars/milestones", TIMELINE, { onUpdateRow });
    const sprint = held["calendars/milestones"]!.rows.find((r) => r.title === "Sprint 24")!;
    // Onto Wednesday 25 November: the week of the 23rd is the fifth shown, from Monday.
    await userEvent.drop(await dayIn(4, 2), `move:${sprint.id}`);
    expect(onUpdateRow).toHaveBeenCalledWith(sprint.id, "from", "2026-11-25");
    expect(onUpdateRow).toHaveBeenCalledWith(sprint.id, "to", "2026-12-06");
    onUpdateRow.mockClear();
    await userEvent.drop(await dayIn(4, 6), `end:${sprint.id}`);
    expect(onUpdateRow).toHaveBeenCalledWith(sprint.id, "to", "2026-11-29");
    expect((await screen.findAllByName("calendar-bar-end")).length).toBeGreaterThan(0);
  });

  it("retimes an entry dropped on a week's hour", async () => {
    const onUpdateRow = vi.fn();
    await calendar("calendars/events", SCHEDULE, { onUpdateRow });
    await act(() => setCalendarRange(SCHEDULE, "week"));
    const dentist = held["calendars/events"]!.rows.find((r) => r.title === "Dentist")!;
    const tuesday = (await screen.findAllByName("calendar-hours"))[1]!;
    // The first hour shown, and half way down it: the dentist's 45 minutes then.
    const table = held["calendars/events"]!;
    const { first } = hourWindow(calendarEntries(table.views.find((v) => v.id === SCHEDULE)!, table.rows).entries, weekDays("2026-11-23", 1));
    await userEvent.drop(tuesday.getFirstChild()!, `move:${dentist.id}`, { y: 22 });
    const at = (m: number) => `2026-11-24T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`;
    expect(onUpdateRow).toHaveBeenCalledWith(dentist.id, "start", at(first * 60 + 30));
    expect(onUpdateRow).toHaveBeenCalledWith(dentist.id, "end", at(first * 60 + 75));
  });

  it("adds a row on a day double-clicked", async () => {
    const onUpdateRow = vi.fn();
    const onAddRow = vi.fn(() => "new-row");
    await calendar("calendars/milestones", TIMELINE, { onUpdateRow, onAddRow });
    await userEvent.dblClick(await dayIn(4, 3));
    expect(onAddRow).toHaveBeenCalledTimes(1);
    expect(onUpdateRow).toHaveBeenCalledWith("new-row", "from", "2026-11-26");
  });

  it("can't be dragged where the table can't be changed", async () => {
    await calendar("calendars/milestones", TIMELINE);
    const sprint = await bar("Sprint 24");
    expect(screen.queryAllByName("calendar-bar-end")).toHaveLength(0);
    // No drag source on the bar, and no drop target on a day.
    await expect(userEvent.dragAndDrop(sprint, await dayIn(4, 2), "move:x")).rejects.toThrow();
  });
});
