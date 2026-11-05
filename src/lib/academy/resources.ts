import type { AcademyClient, AcademySession } from '@/lib/academy/client';

/**
 * Read-only PESU Academy resources exposed by the resource API.
 *
 * Action/mode codes start from the reverse-engineered mobile app (Vision2822/pesu-api,
 * `pesu_api/endpoints.py`) and were checked against live responses on 2026-11-03.
 *
 * Every dispatcher call needs a `menuId`. Academy checks that the account can open that menu,
 * not that it belongs to the action, so the profile menu every student has (ACADEMY_MENU_ID)
 * serves the other read actions too. Resources not yet seen returning real data keep
 * `menuId: null` and answer 501 instead of guessing. Ops can set or override ids without a
 * code change via ACADEMY_MENU_IDS='{"timetable":"12345",...}'.
 *
 * Normalizers are allowlists: only the fields listed here leave the server, so new or
 * sensitive Academy fields are never passed through to third-party apps.
 */

/** The profile menu id, the only mobile menu id known; see the note above. */
export const ACADEMY_MENU_ID = '11172';

export type ResourceId =
  | 'semesters'
  | 'courses'
  | 'syllabus'
  | 'attendance'
  | 'isa_results'
  | 'esa_results'
  | 'cgpa'
  | 'calendar'
  | 'timetable'
  | 'announcements'
  | 'assignments'
  | 'seating';

type FieldMap = Record<string, readonly string[]>;
type Scalar = string | number | boolean;
export type NormalizedRecord = Record<string, Scalar>;

export interface ResourceContext {
  /** Query parameters from the API request (already validated by the route). */
  query: URLSearchParams;
}

export interface ResourceDefinition {
  id: ResourceId;
  scope: string;
  action: number;
  mode: number;
  menuId: string | null;
  /** Sends Academy's `batchClassId` from `?semester=`, defaulting to the latest semester. */
  bySemester?: boolean;
  /** Extra dispatcher form fields derived from the request. */
  params?: (ctx: ResourceContext) => Record<string, string | undefined>;
  /** Picks the row objects out of the payload. Defaults to the largest array found. */
  rows?: (payload: unknown) => Record<string, unknown>[];
  /** Drops normalized rows that do not match the request (for filters Academy does not apply). */
  filter?: (row: NormalizedRecord, ctx: ResourceContext) => boolean;
  fields: FieldMap;
}

const CODE = ['subjectCode', 'SubjectCode', 'courseCode', 'CourseCode', 'subCode'] as const;
const NAME = ['subjectName', 'SubjectName', 'courseName', 'CourseName', 'subName'] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** The row objects in `payload[key]`, or none. */
function rowsAt(payload: unknown, key: string): Record<string, unknown>[] {
  const value = isPlainObject(payload) ? payload[key] : undefined;
  return Array.isArray(value) ? value.filter(isPlainObject) : [];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Academy stores some text HTML-escaped (e.g. `&amp;`); return plain text. */
export function decodeEntities(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.replace(/&(#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#')) {
      const code = Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

const IST_OFFSET_MS = 330 * 60 * 1000;

/** Academy dates are epoch milliseconds at midnight IST; return the IST calendar date. */
export function istDate(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return new Date(value + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Collapses runs of whitespace, which Academy leaves inside some names. */
function squish(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ') : value;
}

/**
 * Plain text from Academy's announcement HTML: block tags become line breaks, links keep their URL,
 * every other tag is dropped and entities are decoded. Apps get text they can show safely.
 */
export function htmlToText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value
    .replace(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => {
      const inner = label.replace(/<[^>]*>/g, '').trim();
      return inner && inner !== href ? `${inner} (${href})` : href;
    })
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]*>/g, '');
  const decoded = String(decodeEntities(text));
  return decoded
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function flag(value: unknown): boolean | undefined {
  return value === 1 || value === 0 ? value === 1 : undefined;
}

/** Academy numbers timetable days 1 = Monday .. 6 = Saturday; 0 and 7 are both read as Sunday. */
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** `?day=` as a weekday name: `mon`, `Monday` or `1`..`7` (1 = Monday, 7 = Sunday). */
export function weekdayName(value: string): string | undefined {
  if (/^[1-7]$/.test(value)) return WEEKDAYS[Number(value)];
  const prefix = value.slice(0, 3).toLowerCase();
  return WEEKDAYS.find((name) => name.slice(0, 3).toLowerCase() === prefix);
}

/**
 * Academy sends slot times as IST `HH:MM:SS` with arbitrary seconds. Return an ISO 8601 time with
 * an explicit offset (`08:45:00+05:30`): a weekly slot has no date, so this is the standard form.
 */
export function clockTime(value: unknown): string | undefined {
  return typeof value === 'string' && /^\d{2}:\d{2}/.test(value) ? `${value.slice(0, 5)}:00+05:30` : undefined;
}

function sortKey(row: { dayNumber?: unknown; start?: string }): string {
  const day = typeof row.dayNumber === 'number' ? (row.dayNumber || 7) : 9;
  return `${day}|${row.start ?? '99:99'}`;
}

export const RESOURCES: Record<ResourceId, ResourceDefinition> = {
  semesters: {
    id: 'semesters',
    scope: 'courses:read',
    action: 18,
    mode: 1, // StudentCourseMode.GET_SEMESTERS
    menuId: ACADEMY_MENU_ID,
    fields: {
      id: ['batchClassId'],
      name: ['className'],
    },
  },
  courses: {
    id: 'courses',
    scope: 'courses:read',
    action: 18,
    mode: 2, // StudentCourseMode.GET_SUBJECTS_BY_SEMESTER
    menuId: ACADEMY_MENU_ID,
    bySemester: true,
    rows: (payload) => rowsAt(payload, 'STUDENT_SUBJECTS'),
    fields: {
      id: ['SubjectId', 'subjectId'],
      code: CODE,
      name: NAME,
      type: ['Description'], // Core or Elective
      status: ['SubjectStatusText', 'status', 'Status'],
      semesterId: ['BatchClassId'],
    },
  },
  syllabus: {
    id: 'syllabus',
    scope: 'courses:read',
    action: 18,
    mode: 11, // StudentCourseMode.COURSE_INFO
    menuId: ACADEMY_MENU_ID,
    params: ({ query }) => ({ subjectId: query.get('course') ?? undefined }),
    rows: (payload) =>
      rowsAt(payload, 'COURSE_CONTENT').map((row) => ({
        ...row,
        Heading: decodeEntities(row.Heading),
        CourseContent: decodeEntities(row.CourseContent),
      })),
    fields: {
      courseId: ['SubjectId'],
      code: CODE,
      name: NAME,
      section: ['CourseContentType'], // Course Objectives, Course Outcome, Course Units, Reference Books
      heading: ['Heading'],
      content: ['CourseContent'],
      order: ['CourseContentOrder'],
    },
  },
  attendance: {
    id: 'attendance',
    scope: 'attendance:read',
    action: 18,
    mode: 6, // StudentCourseMode.GET_ATTENDANCE
    menuId: ACADEMY_MENU_ID,
    bySemester: true,
    // The payload also repeats STUDENT_SUBJECTS; attendance figures are only in ATTENDANCE_LIST.
    rows: (payload) => rowsAt(payload, 'ATTENDANCE_LIST'),
    fields: {
      courseId: ['SubjectId'],
      code: CODE,
      name: NAME,
      classesHeld: ['TotalClasses', 'totalClasses'],
      classesAttended: ['AttendedClasses', 'attendedClasses'],
      // Academy's own spelling, plus the corrected one in case it is ever fixed.
      percentage: ['AttendancePercenrage', 'AttendancePercentage', 'attendancePercentage'],
    },
  },
  isa_results: {
    id: 'isa_results',
    scope: 'results:read',
    // ISA marks come nested in the per-semester results call; ISA mode 9 returns nothing.
    action: 7,
    mode: 11, // ESAResultsMode.GET_DETAILED
    menuId: ACADEMY_MENU_ID,
    bySemester: true,
    rows: (payload) => [
      // The semester in progress has no per-course results yet; its ISA marks come as flat rows.
      ...rowsAt(payload, 'Current_SEMESTERWISE'),
      ...rowsAt(payload, 'STUDENT_ALL_SUBJECTS').flatMap((subject) => [
        ...rowsAt(subject, 'ISARESULTS'),
        // The course's final ISA total has no name or code of its own.
        ...rowsAt(subject, 'FinalISA').map((final) => ({
          subjectId: subject.SubjectId,
          SubjectCode: subject.subjectCode,
          SubjectName: subject.SubjectName,
          Name: typeof final.ISAMaster === 'string' ? final.ISAMaster : 'Final ISA',
          Marks: final.Marks,
        })),
      ]),
    ],
    fields: {
      courseId: ['subjectId', 'SubjectId'],
      code: CODE,
      name: NAME,
      assessment: ['Name'],
      marks: ['Marks'],
      maxMarks: ['MaxISAMarks'],
    },
  },
  esa_results: {
    id: 'esa_results',
    scope: 'results:read',
    action: 7,
    mode: 11, // ESAResultsMode.GET_DETAILED
    menuId: ACADEMY_MENU_ID,
    bySemester: true,
    // One row per course; the semester's SGPA and CGPA sit in a separate summary row.
    rows: (payload) => {
      const summary = rowsAt(payload, 'CGPA_SEMESTERWISE')[0] ?? {};
      return rowsAt(payload, 'STUDENT_ALL_SUBJECTS').map((subject) => ({
        ...subject,
        SGPA: summary.SGPA,
        CGPA: summary.CGPA,
      }));
    },
    fields: {
      courseId: ['SubjectId'],
      code: CODE,
      name: NAME,
      semester: ['Semester'],
      examSession: ['Description'], // e.g. MAY 2021
      grade: ['grade', 'Grade'],
      credits: ['Credits'],
      earnedCredits: ['EarnedCredit', 'EarnedCredits'],
      sgpa: ['SGPA'],
      cgpa: ['CGPA'],
    },
  },
  cgpa: {
    id: 'cgpa',
    scope: 'results:read',
    action: 7,
    mode: 6, // ESAResultsMode.GET_SEM_LIST, which also carries the overall CGPA
    menuId: ACADEMY_MENU_ID,
    rows: (payload) => rowsAt(payload, 'StudentCGPAWISE'),
    fields: {
      cgpa: ['CGPA'],
      credits: ['Credits'],
      earnedCredits: ['EarnedCredits'],
    },
  },
  calendar: {
    id: 'calendar',
    scope: 'timetable:read',
    action: 14,
    mode: 1, // CALENDAR_EVENTS for the student's current term
    menuId: ACADEMY_MENU_ID,
    rows: (payload) =>
      findRows(payload).map((row) => ({
        name: squish(row.name),
        description: squish(row.description),
        type: row.eventType,
        startDate: istDate(row.startDate),
        // Academy's end is exclusive (midnight after the last day).
        endDate: typeof row.endDate === 'number' ? istDate(row.endDate - 1) : undefined,
        holiday: flag(row.isHoliday),
        classDay: flag(row.isClass),
        term: row.calendarOfEventName,
      })),
    fields: {
      name: ['name'],
      description: ['description'],
      type: ['type'], // University Events, Test Schedule, National Festival, ...
      startDate: ['startDate'],
      endDate: ['endDate'],
      holiday: ['holiday'],
      classDay: ['classDay'],
      term: ['term'],
    },
  },
  timetable: {
    id: 'timetable',
    scope: 'timetable:read',
    action: 16,
    mode: 1, // TimetableMode.GET_TIMETABLE; the per-day mode 2 returns nothing, so `day` filters here
    menuId: ACADEMY_MENU_ID,
    rows: (payload) =>
      findRows(payload)
        .map((row) => ({
          day: typeof row.day === 'number' ? WEEKDAYS[row.day] : undefined,
          dayNumber: row.day,
          start: clockTime(row.startTime),
          end: clockTime(row.endTime),
          subjectCode: row.subjectCode,
          subjectName: row.subjectName,
          faculty: row.facultyName,
          room: row.roomName,
        }))
        .sort((a, b) => sortKey(a).localeCompare(sortKey(b))),
    filter: (row, { query }) => {
      const day = query.get('day');
      return !day || row.day === weekdayName(day);
    },
    fields: {
      day: ['day'],
      start: ['start'],
      end: ['end'],
      code: ['subjectCode'],
      name: ['subjectName'],
      faculty: ['faculty'],
      room: ['room'],
    },
  },
  announcements: {
    id: 'announcements',
    scope: 'announcements:read',
    action: 20,
    // Mode 7 lists the student's announcement feed, newest first; pesu-api's mode 5 returns nothing.
    // Academy ignores `pageNo` and always returns the whole feed.
    mode: 7,
    menuId: ACADEMY_MENU_ID,
    rows: (payload) =>
      findRows(payload).map((row) => ({
        id: row.announcementId,
        title: squish(decodeEntities(row.announcementName)),
        date: istDate(row.startdate),
        description: htmlToText(row.description),
        // A pre-signed PESU Academy link that expires; download it rather than storing the URL.
        image: typeof row.bannerImagePath === 'string' && /^https:\/\//.test(row.bannerImagePath) ? row.bannerImagePath : undefined,
        // Attachments need a link only PESU Academy can sign, so only their number is returned.
        attachments: Array.isArray(row.files) ? row.files.length : undefined,
      })),
    fields: {
      id: ['id'],
      title: ['title'],
      date: ['date'],
      description: ['description'],
      image: ['image'],
      attachments: ['attachments'],
    },
  },
  assignments: {
    id: 'assignments',
    scope: 'assignments:read',
    action: 37,
    mode: 1, // AssignmentsMode.GET_LIST
    menuId: null, // not yet seen returning data
    fields: {
      id: ['assignmentId', 'AssignmentId', 'id'],
      title: ['title', 'Title', 'assignmentName', 'AssignmentName'],
      code: CODE,
      name: NAME,
      dueDate: ['dueDate', 'DueDate', 'submissionDate', 'lastDate', 'endDate'],
      status: ['status', 'Status', 'submissionStatus'],
    },
  },
  seating: {
    id: 'seating',
    scope: 'seating:read',
    action: 13,
    mode: 3, // SeatingMode.GET
    menuId: null, // not yet seen returning data
    fields: {
      code: CODE,
      name: NAME,
      date: ['examDate', 'ExamDate', 'date'],
      time: ['examTime', 'ExamTime', 'time', 'session'],
      room: ['roomNo', 'RoomNo', 'room', 'hallName', 'blockName'],
      seat: ['seatNo', 'SeatNo', 'seatNumber'],
    },
  },
};

export class ResourceUnavailableError extends Error {
  constructor(public readonly resource: ResourceId) {
    super(`PESU Academy ${resource} is not available yet`);
    this.name = 'ResourceUnavailableError';
  }
}

/** Verified menu ids supplied by ops, e.g. ACADEMY_MENU_IDS='{"attendance":"12345"}'. */
export function menuIdOverrides(raw: string | undefined = process.env.ACADEMY_MENU_IDS): Partial<Record<ResourceId, string>> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Partial<Record<ResourceId, string>> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key in RESOURCES && (typeof value === 'string' || typeof value === 'number') && /^\d+$/.test(String(value))) {
        out[key as ResourceId] = String(value);
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function resolveMenuId(def: ResourceDefinition): string | null {
  return menuIdOverrides()[def.id] ?? def.menuId;
}

/** Finds the array of row objects in a dispatcher payload (top level or nested a few levels). */
export function findRows(payload: unknown, depth: number = 0): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    if (payload.some(isPlainObject)) return payload.filter(isPlainObject);
    return [];
  }
  if (!isPlainObject(payload) || depth > 3) return [];
  let best: Record<string, unknown>[] = [];
  for (const value of Object.values(payload)) {
    const rows = findRows(value, depth + 1);
    if (rows.length > best.length) best = rows;
  }
  return best;
}

/**
 * Copies only allowlisted fields, taking the first candidate key with a scalar value. Blank strings
 * count as missing (Academy sends "" for some unrecorded values, e.g. an ISA's maximum marks).
 */
export function pickFields(row: Record<string, unknown>, fields: FieldMap): NormalizedRecord {
  const out: NormalizedRecord = {};
  for (const [outKey, candidates] of Object.entries(fields)) {
    for (const key of candidates) {
      const value = row[key];
      if (typeof value === 'string' && value.trim()) {
        out[outKey] = value.trim();
        break;
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        out[outKey] = value;
        break;
      }
    }
  }
  return out;
}

export function normalizeRows(def: ResourceDefinition, payload: unknown): NormalizedRecord[] {
  return (def.rows ? def.rows(payload) : findRows(payload))
    .map((row) => pickFields(row, def.fields))
    .filter((row) => Object.keys(row).length > 0);
}

/** Academy's id for the student's latest semester, or null when it lists none. */
async function latestSemesterId(client: AcademyClient, session: AcademySession): Promise<string | null> {
  const def = RESOURCES.semesters;
  const menuId = resolveMenuId(def);
  if (!menuId) throw new ResourceUnavailableError(def.id);
  const rows = findRows(await client.dispatch(session, { action: def.action, mode: def.mode, menuId }));
  const withId = rows.filter((row) => row.batchClassId !== undefined && row.batchClassId !== null);
  let latest: { id: string; order: number } | null = null;
  for (const row of withId) {
    const order = row.batchClassOrder;
    if (typeof order !== 'number' || !Number.isFinite(order)) continue;
    if (!latest || order > latest.order) latest = { id: String(row.batchClassId), order };
  }
  // Without an order, trust Academy's own listing, which puts the newest semester first.
  if (!latest && withId.length) return String(withId[0].batchClassId);
  return latest?.id ?? null;
}

export async function fetchResource(
  client: AcademyClient,
  session: AcademySession,
  def: ResourceDefinition,
  ctx: ResourceContext
): Promise<NormalizedRecord[]> {
  const menuId = resolveMenuId(def);
  if (!menuId) throw new ResourceUnavailableError(def.id);

  const extra = def.params?.(ctx) ?? {};
  if (def.bySemester) {
    const semester = ctx.query.get('semester') ?? (await latestSemesterId(client, session));
    if (!semester) return [];
    extra.batchClassId = semester;
  }
  const payload = await client.dispatch(session, { action: def.action, mode: def.mode, menuId, ...extra });
  const rows = normalizeRows(def, payload);
  return def.filter ? rows.filter((row) => def.filter!(row, ctx)) : rows;
}
