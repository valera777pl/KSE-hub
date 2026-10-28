/* ─── User ─── */
export interface User {
  id: number;
  telegramId: number;
  username: string | null;
  fullName: string;
  avatarUrl: string | null;
  moodleToken: string | null;
  calendarUrl: string | null;
  studentType: 'grant' | 'contract';
  faculty: string | null;
  year: number | null;
  languagePref: 'uk' | 'en';
  digestSources: DigestSource[];
  digestHour: number; // Kyiv hour, -1 = digest off
  scheduleVisible: boolean;
  onboardedAt: string | null;
  notifyScheduleChanges: boolean;
  classReminders: boolean;
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string;
}

export type DigestSource = 'moodle' | 'gmail' | 'slack';

export interface GoogleStatus {
  connected: boolean;
  email: string | null;
  needsReconnect: boolean;
  lastSyncAt: string | null;
}

/* ─── Room Booking ─── */
export interface Room {
  id: number;
  name: string;
  type: 'skype_room' | 'silent_box';
  capacity: number;
  hasDesk: boolean;
  hasPower: boolean;
  floor: number | null;
  metadata: Record<string, any> | null;
  available?: boolean;
}

export interface Booking {
  id: number;
  roomId: number;
  userId: number;
  startTime: string;
  endTime: string;
  status: 'active' | 'cancelled' | 'completed';
  createdAt: string;
}

export interface BookingWithRoom {
  booking: Booking;
  room: Room;
}

export interface QuotaInfo {
  used: number;
  remaining: number;
  max: number;
}

/* ─── Moodle ─── */
export interface MoodleCourse {
  id: number;
  userId: number;
  courseId: string;
  courseName: string;
  courseNameUk: string | null;
  sections: any;
  syncedAt: string | null;
}

export interface MoodleAssignment {
  id: number;
  userId: number;
  courseId: number | null;
  externalId: string | null;
  title: string;
  dueDate: string | null;
  sourceUrl: string | null;
  isCompleted: boolean;
  type: 'assignment' | 'quiz' | 'event';
  createdAt: string;
  /** From Moodle's receipt email: handed in at this time */
  submittedAt?: string | null;
  /** From Moodle's feedback email: the teacher (or Grader AI) replied */
  feedbackAt?: string | null;
}

export interface DeadlineWithCourse {
  assignment: MoodleAssignment;
  courseName: string | null;
}

/* ─── VentureMatch ─── */
export interface VentureProfile {
  id: number;
  userId: number;
  title: string;
  bio: string | null;
  skills: string[];
  lookingFor: string[];
  githubUrl: string | null;
  portfolioUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VentureProject {
  id: number;
  userId: number;
  title: string;
  pitch: string | null;
  problem: string | null;
  targetMvp: string | null;
  requiredRoles: string[];
  commitmentLevel: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SwipeCardProfile {
  profile: VentureProfile;
  user: {
    id: number;
    fullName: string;
    username: string | null;
    avatarUrl: string | null;
    faculty: string | null;
    year: number | null;
  };
}

export interface SwipeCardProject {
  project: VentureProject;
  user: {
    id: number;
    fullName: string;
    username: string | null;
    avatarUrl: string | null;
  };
}

export interface MatchResult {
  matched: boolean;
  match?: any;
  matchedUser?: {
    id: number;
    telegramId: number;
    username: string | null;
    fullName: string;
    avatarUrl: string | null;
  };
}

/* ─── Opportunities ─── */
export interface Opportunity {
  id: number;
  title: string;
  company: string;
  domain: string | null;
  eligibility: 'grant' | 'contract' | 'all';
  category: 'internship' | 'job' | 'grant' | 'research';
  deadline: string | null;
  url: string | null;
  description: string | null;
  salaryInfo: string | null;
  createdAt: string;
  source: 'email' | 'manual';
  emailUrl: string | null;
  /** Programme codes from the letter; empty = open to everyone */
  programs?: string[];
  saved?: boolean;
}

/* ─── Notifications ─── */
export interface Notification {
  id: number;
  userId: number;
  type: 'deadline' | 'match' | 'booking_expiry' | 'system';
  title: string;
  message: string | null;
  actionUrl: string | null;
  isRead: boolean;
  createdAt: string;
}

/* ─── Copilot ─── */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: { name: string; args: any }[];
  timestamp: Date;
}

/* ─── Navigation ─── */
export type TabId = 'today' | 'study' | 'rooms' | 'opps';

/* ─── Schedule ─── */
export interface ClassEvent {
  id: number;
  calendarId: number;
  courseCode: string;
  section: string | null;
  title: string;
  location: string | null;
  startAt: string;
  endAt: string;
}

export interface StudentMatch {
  userId: number;
  name: string;
  cohort: number | null;
  fullName: string;
  username: string | null;
  /** Telegram photo, when the student has one */
  avatarUrl?: string | null;
}

export interface ScheduleCompare {
  student: StudentMatch;
  weekStart: string;
  events: (ClassEvent & { shared: boolean })[];
  sharedCourses: string[];
}

/* ─── Startups ─── */
export interface StartupCard {
  project: VentureProject;
  author: { id: number; name: string };
  myStatus: Application['status'] | null;
}

export interface Application {
  id: number;
  projectId: number;
  role: string | null;
  message: string | null;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
  project: { id: number; title: string };
  applicant?: { name: string; headline: string | null; skills: string[]; contact: string | null };
  author?: { name: string; contact: string | null };
}

/** A mutual friend or a pending request (GET /friends). */
export interface FriendCard {
  friendshipId: number;
  userId: number;
  name: string;
  avatarUrl: string | null;
  username: string | null;
}

export interface FriendsList {
  friends: FriendCard[];
  incoming: FriendCard[];
  outgoing: FriendCard[];
}

/** A reminder the bot hasn't sent yet (GET /reminders). */
export interface Reminder {
  id: number;
  kind: 'self' | 'event';
  text: string;
  remindAt: string;
  startapp: string | null;
  eventId: number | null;
}

/** An event from KSE mailings (GET /events). */
export interface EventItem {
  id: number;
  title: string;
  startsAt: string;
  location: string | null;
  description: string | null;
  programs: string[];
  registrationUrl: string | null;
  /** A personal invitation, not a mailing */
  personal: boolean;
  /** «Нагадати за день» is on */
  reminded: boolean;
  createdAt: string;
}

/** GET /courses/:code — one course in one place. */
export interface CoursePageData {
  code: string;
  title: string | null;
  sections: string[];
  nextClass: ClassEvent | null;
  deadlines: DeadlineWithCourse[];
  slack: { url: string; name: string | null } | null;
  officeHours: string | null;
  friends: { userId: number; name: string; avatarUrl: string | null; sameSection: boolean }[];
}

/** GET /courses/:code/mail — searched in Gmail on the spot. */
export interface CourseMail {
  id: string;
  subject: string;
  from: string;
  receivedAt: string;
  url: string;
}
