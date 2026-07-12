import type { Task, TaskResult } from "../lib/types.js";
import { runOavr } from "./base.js";

const SLOT_API_VERSION = "2024-09-04";
const BOOKING_API_VERSION = "2026-02-25";
const SEARCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

class CalApiError extends Error {
  public readonly safeToRetry: boolean;

  public constructor(status: number, message: string) {
    super(`Cal.com request failed: ${message}`);
    this.name = "CalApiError";
    this.safeToRetry = status === 400 || status === 404 || status === 409 || status === 422;
  }
}

type BookingInstruction = {
  mode: "requested_time" | "next_available";
  requestedStart?: string;
};

type BookingState = {
  eventTypeId: number;
  timeZone: string;
  targetStart: string;
  mode: BookingInstruction["mode"];
};

type BookingAction = {
  booking: CalBooking;
  targetStart: string;
  mode: BookingInstruction["mode"];
};

type CalBooking = {
  uid: string;
  title: string;
  status: string;
  start: string;
  end: string;
  eventTypeId: number;
};

export type BookingEvidence = {
  bookingUid: string;
  eventTypeId: number;
  requestedStart: string;
  start: string;
  end: string;
  status: string;
  mode: BookingInstruction["mode"];
  verifiedByFreshRead: boolean;
};

function requiredEnv(
  name:
    | "CALCOM_API_KEY"
    | "CALCOM_EVENT_TYPE_ID"
    | "CALCOM_TIME_ZONE"
    | "CALCOM_ATTENDEE_NAME"
    | "CALCOM_ATTENDEE_EMAIL",
): string {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function eventTypeId(): number {
  const value = Number(requiredEnv("CALCOM_EVENT_TYPE_ID"));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("CALCOM_EVENT_TYPE_ID must be a positive integer");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function parseBookingInstruction(instruction: string): BookingInstruction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(instruction);
  } catch {
    throw new Error("Booking instruction must be structured JSON");
  }
  if (!isRecord(parsed) || (parsed.mode !== "requested_time" && parsed.mode !== "next_available")) {
    throw new Error("Booking instruction mode must be requested_time or next_available");
  }
  if (parsed.mode === "requested_time") {
    if (
      !hasExactKeys(parsed, ["mode", "requestedStart"])
      || typeof parsed.requestedStart !== "string"
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(parsed.requestedStart)
      || !Number.isFinite(Date.parse(parsed.requestedStart))
    ) {
      throw new Error("requested_time booking requires only mode and a timezone-explicit ISO requestedStart");
    }
    return { mode: parsed.mode, requestedStart: new Date(Date.parse(parsed.requestedStart)).toISOString() };
  }
  if (!hasExactKeys(parsed, ["mode"])) {
    throw new Error("next_available booking accepts only the mode field");
  }
  return { mode: parsed.mode };
}

export function normalizeBookingInstruction(instruction: string): string {
  return JSON.stringify(parseBookingInstruction(instruction));
}

function parseBooking(value: unknown): CalBooking {
  if (!isRecord(value) || value.status !== "success" || !isRecord(value.data)) {
    throw new Error("Cal.com returned an invalid booking response");
  }
  const data = value.data;
  if (
    typeof data.uid !== "string"
    || typeof data.title !== "string"
    || typeof data.status !== "string"
    || typeof data.start !== "string"
    || typeof data.end !== "string"
    || typeof data.eventTypeId !== "number"
  ) {
    throw new Error("Cal.com booking response is missing required fields");
  }
  return {
    uid: data.uid,
    title: data.title,
    status: data.status,
    start: data.start,
    end: data.end,
    eventTypeId: data.eventTypeId,
  };
}

async function calRequest(
  path: string,
  version: string,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(`https://api.cal.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${requiredEnv("CALCOM_API_KEY")}`,
      "cal-api-version": version,
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
  });
  const payload = await response.json() as unknown;
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.message === "string"
      ? payload.message
      : `HTTP ${response.status}`;
    throw new CalApiError(response.status, message);
  }
  return payload;
}

function parseAvailableStarts(value: unknown): string[] {
  if (!isRecord(value) || value.status !== "success" || !isRecord(value.data)) {
    throw new Error("Cal.com returned an invalid slots response");
  }
  const starts: string[] = [];
  for (const slots of Object.values(value.data)) {
    if (!Array.isArray(slots)) {
      continue;
    }
    for (const slot of slots) {
      if (isRecord(slot) && typeof slot.start === "string" && Number.isFinite(Date.parse(slot.start))) {
        starts.push(slot.start);
      }
    }
  }
  return starts.sort((left, right) => Date.parse(left) - Date.parse(right));
}

async function observeAvailableSlots(
  bookingInstruction: BookingInstruction,
  excludedStarts: ReadonlySet<string>,
): Promise<BookingState> {
  const earliestAllowed = Date.now() + 60 * 60 * 1_000;
  const requestedTime = bookingInstruction.requestedStart === undefined
    ? undefined
    : Date.parse(bookingInstruction.requestedStart);
  if (requestedTime !== undefined && requestedTime < earliestAllowed) {
    throw new Error("Requested booking time must be at least one hour in the future");
  }
  const start = new Date(requestedTime === undefined ? earliestAllowed : requestedTime - 60 * 1_000).toISOString();
  const end = new Date(requestedTime === undefined ? Date.now() + SEARCH_WINDOW_MS : requestedTime + 60 * 60 * 1_000).toISOString();
  const id = eventTypeId();
  const timeZone = requiredEnv("CALCOM_TIME_ZONE");
  const query = new URLSearchParams({
    start,
    end,
    eventTypeId: String(id),
    timeZone,
  });
  const availableStarts = parseAvailableStarts(
    await calRequest(`/v2/slots?${query.toString()}`, SLOT_API_VERSION),
  ).filter((slotStart) => !excludedStarts.has(slotStart));
  const targetStart = requestedTime === undefined
    ? availableStarts[0]
    : availableStarts.find((slotStart) => Date.parse(slotStart) === requestedTime);
  if (targetStart === undefined) {
    throw new Error(requestedTime === undefined
      ? "Cal.com returned no available slots in the next seven days"
      : "The requested Cal.com time is not available");
  }
  return { eventTypeId: id, timeZone, targetStart, mode: bookingInstruction.mode };
}

async function createBooking(state: BookingState, taskId: string): Promise<CalBooking> {
  return parseBooking(await calRequest("/v2/bookings", BOOKING_API_VERSION, {
    method: "POST",
    body: JSON.stringify({
      start: new Date(Date.parse(state.targetStart)).toISOString(),
      eventTypeId: state.eventTypeId,
      attendee: {
        name: requiredEnv("CALCOM_ATTENDEE_NAME"),
        email: requiredEnv("CALCOM_ATTENDEE_EMAIL"),
        timeZone: state.timeZone,
        language: "en",
      },
      metadata: {
        source: "switchboard",
        taskId,
      },
    }),
  }));
}

async function readBooking(uid: string): Promise<CalBooking> {
  return parseBooking(
    await calRequest(`/v2/bookings/${encodeURIComponent(uid)}`, BOOKING_API_VERSION),
  );
}

function sameInstant(left: string, right: string): boolean {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime === rightTime;
}

export async function runBookingTask(
  task: Task,
  requester: string,
  instruction: string,
  parentId?: string,
): Promise<TaskResult> {
  if (task.template !== "booking") {
    throw new Error("Booking specialist received a non-booking task");
  }
  if (instruction.trim() === "") {
    throw new Error("A booking instruction cannot be empty");
  }

  const bookingInstruction = parseBookingInstruction(instruction);
  let bookingAttempted = false;
  let createdAction: BookingAction | undefined;
  const excludedStarts = new Set<string>();

  return runOavr({
    observe: async (): Promise<BookingState> => observeAvailableSlots(bookingInstruction, excludedStarts),
    act: async (state): Promise<BookingAction> => {
      if (createdAction !== undefined) {
        return createdAction;
      }
      if (bookingAttempted) {
        throw new Error("Cal.com booking outcome is unknown; refusing to risk a duplicate booking");
      }
      bookingAttempted = true;
      try {
        const booking = await createBooking(state, task.id);
        createdAction = { booking, targetStart: state.targetStart, mode: state.mode };
        return createdAction;
      } catch (error: unknown) {
        if (error instanceof CalApiError && error.safeToRetry) {
          bookingAttempted = false;
          excludedStarts.add(state.targetStart);
        }
        throw error;
      }
    },
    verify: async (action): Promise<{ ok: boolean; evidence: BookingEvidence; reason?: string }> => {
      const current = await readBooking(action.booking.uid);
      const verifiedByFreshRead = current.uid === action.booking.uid
        && current.eventTypeId === eventTypeId()
        && current.status === "accepted"
        && sameInstant(current.start, action.booking.start)
        && sameInstant(current.start, action.targetStart);
      const evidence: BookingEvidence = {
        bookingUid: current.uid,
        eventTypeId: current.eventTypeId,
        requestedStart: action.targetStart,
        start: current.start,
        end: current.end,
        status: current.status,
        mode: action.mode,
        verifiedByFreshRead,
      };
      return {
        ok: verifiedByFreshRead,
        evidence,
        ...(verifiedByFreshRead ? {} : { reason: "Cal.com booking did not match after a fresh read" }),
      };
    },
    recover: async (): Promise<void> => undefined,
  }, { task, requester, ...(parentId === undefined ? {} : { parentId }) });
}
