import type { AcademyClient, AcademySession } from '@/lib/academy/client';

/**
 * Read-only PESU Academy resources exposed by the resource API.
 *
 * Action/mode codes come from the reverse-engineered mobile app (Vision2822/pesu-api,
 * `pesu_api/endpoints.py`). The dispatcher additionally requires a feature-specific `menuId`
 * (observed 2026-10-23: "Menu ID is required"); only the profile menu id is known so far, so a
 * resource with `menuId: null` is reported as unavailable instead of guessed. Ops can supply
 * verified ids without a code change via ACADEMY_MENU_IDS='{"attendance":"12345",...}'.
 *
 * Normalizers are allowlists: only the fields listed here leave the server, so new or
 * sensitive Academy fields are never passed through to third-party apps.
 */

export type ResourceId =
  | 'semesters'
  | 'courses'
  | 'attendance'
  | 'isa_results'
  | 'esa_results'
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
  /** Login identifier (SRN/PRN) the vault credentials belong to. */
  username: string;
}

export interface ResourceDefinition {
  id: ResourceId;
  scope: string;
  action: number;
  mode: number;
  menuId: string | null;
  /** Extra dispatcher form fields derived from the request. */
  params?: (ctx: ResourceContext) => Record<string, string | undefined>;
  fields: FieldMap;
}

const CODE = ['subjectCode', 'SubjectCode', 'courseCode', 'CourseCode', 'subCode'] as const;
const NAME = ['subjectName', 'SubjectName', 'courseName', 'CourseName', 'subName'] as const;

export const RESOURCES: Record<ResourceId, ResourceDefinition> = {
  semesters: {
    id: 'semesters',
    scope: 'courses:read',
    action: 18,
    mode: 1, // StudentCourseMode.GET_SEMESTERS
    menuId: null,
    fields: {
      id: ['semId', 'semesterId', 'SemesterId', 'batchClassId', 'id'],
      name: ['semName', 'semesterName', 'SemesterName', 'className', 'name'],
    },
  },
  courses: {
    id: 'courses',
    scope: 'courses:read',
    action: 18,
    mode: 2, // StudentCourseMode.GET_SUBJECTS_BY_SEMESTER
    menuId: null,
    params: ({ query }) => ({ selectedSemester: query.get('semester') ?? undefined }),
    fields: {
      id: ['subjectId', 'SubjectId', 'courseId', 'CourseId'],
      code: CODE,
      name: NAME,
      faculty: ['facultyName', 'FacultyName'],
      status: ['status', 'Status', 'courseStatus'],
    },
  },
  attendance: {
    id: 'attendance',
    scope: 'attendance:read',
    action: 18,
    mode: 6, // StudentCourseMode.GET_ATTENDANCE
    menuId: null,
    params: ({ query }) => ({ selectedSemester: query.get('semester') ?? undefined }),
    fields: {
      code: CODE,
      name: NAME,
      classesHeld: ['totalClasses', 'TotalClasses', 'classesHeld', 'conductedClasses', 'totalClassesConducted'],
      classesAttended: ['attendedClasses', 'AttendedClasses', 'classesAttended', 'presentClasses', 'totalPresent'],
      percentage: ['attendancePercentage', 'AttendancePercentage', 'percentage', 'Percentage'],
    },
  },
  isa_results: {
    id: 'isa_results',
    scope: 'results:read',
    action: 6,
    mode: 9, // ISAResultsMode.GET_ISA_RESULTS
    menuId: null,
    fields: {
      code: CODE,
      name: NAME,
      assessment: ['assessmentName', 'AssessmentName', 'isaName', 'testName'],
      marks: ['marks', 'Marks', 'obtainedMarks', 'marksObtained', 'MarksObtained'],
      maxMarks: ['maxMarks', 'MaxMarks', 'totalMarks', 'TotalMarks'],
    },
  },
  esa_results: {
    id: 'esa_results',
    scope: 'results:read',
    action: 7,
    mode: 3, // ESAResultsMode.GET
    menuId: null,
    params: ({ username }) => ({ usn: username }),
    fields: {
      code: CODE,
      name: NAME,
      semester: ['semester', 'Semester', 'semName', 'className'],
      grade: ['grade', 'Grade', 'finalGrade'],
      credits: ['credits', 'Credits', 'credit', 'earnedCredits'],
      sgpa: ['sgpa', 'SGPA', 'Sgpa'],
      cgpa: ['cgpa', 'CGPA', 'Cgpa'],
    },
  },
  timetable: {
    id: 'timetable',
    scope: 'timetable:read',
    action: 16,
    mode: 1, // TimetableMode.GET_TIMETABLE (mode 2 + day for a single day)
    menuId: null,
    params: ({ query }) => (query.get('day') ? { day: query.get('day')! } : {}),
    fields: {
      day: ['day', 'Day', 'dayName'],
      start: ['startTime', 'StartTime', 'fromTime'],
      end: ['endTime', 'EndTime', 'toTime'],
      code: CODE,
      name: NAME,
      faculty: ['facultyName', 'FacultyName'],
      room: ['roomName', 'RoomName', 'additionalInfo'],
    },
  },
  announcements: {
    id: 'announcements',
    scope: 'announcements:read',
    action: 20,
    mode: 5, // AnnouncementMode.LIST
    menuId: null,
    params: ({ query }) => ({ pageNo: query.get('page') ?? '1' }),
    fields: {
      id: ['announcementId', 'AnnouncementId', 'id'],
      title: ['title', 'Title', 'announcementTitle', 'subject'],
      date: ['date', 'announcementDate', 'createdDate', 'postedDate'],
    },
  },
  assignments: {
    id: 'assignments',
    scope: 'assignments:read',
    action: 37,
    mode: 1, // AssignmentsMode.GET_LIST
    menuId: null,
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
    menuId: null,
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
    super(`PESU Academy ${resource} is not available yet (dispatcher menu id not configured)`);
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

/** Copies only allowlisted fields, taking the first candidate key present with a scalar value. */
export function pickFields(row: Record<string, unknown>, fields: FieldMap): NormalizedRecord {
  const out: NormalizedRecord = {};
  for (const [outKey, candidates] of Object.entries(fields)) {
    for (const key of candidates) {
      const value = row[key];
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        out[outKey] = typeof value === 'string' ? value.trim() : value;
        break;
      }
    }
  }
  return out;
}

export function normalizeRows(def: ResourceDefinition, payload: unknown): NormalizedRecord[] {
  return findRows(payload)
    .map((row) => pickFields(row, def.fields))
    .filter((row) => Object.keys(row).length > 0);
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
  // Timetable has a dedicated per-day mode
  const mode = def.id === 'timetable' && extra.day ? 2 : def.mode;
  const payload = await client.dispatch(session, { action: def.action, mode, menuId, ...extra });
  return normalizeRows(def, payload);
}
