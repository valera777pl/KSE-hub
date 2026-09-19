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
  createdAt: string;
  updatedAt: string;
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
export type TabId = 'rooms' | 'moodle' | 'venture' | 'careers' | 'copilot';
