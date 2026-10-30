import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  bigint,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
  vector,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

/* ───────────── ENUMS ───────────── */

export const studentTypeEnum = pgEnum('student_type', ['grant', 'contract']);
export const languageEnum = pgEnum('language_pref', ['uk', 'en']);
export const roomTypeEnum = pgEnum('room_type', ['skype_room', 'silent_box']);
export const bookingStatusEnum = pgEnum('booking_status', ['active', 'cancelled', 'completed']);
export const assignmentTypeEnum = pgEnum('assignment_type', ['assignment', 'quiz', 'event']);
export const swipeTargetTypeEnum = pgEnum('swipe_target_type', ['profile', 'project']);
export const matchTypeEnum = pgEnum('match_type', ['profile', 'project']);
export const eligibilityEnum = pgEnum('eligibility', ['grant', 'contract', 'all']);
export const opportunityCategoryEnum = pgEnum('opportunity_category', [
  'internship', 'job', 'grant', 'research',
]);
export const applicationStatusEnum = pgEnum('application_status', ['pending', 'accepted', 'declined']);
export const notificationTypeEnum = pgEnum('notification_type', [
  'deadline', 'match', 'booking_expiry', 'system',
]);

/* ───────────── USERS ───────────── */

/** What the pinned message in the bot chat shows (015). */
export type PinnedKind = 'off' | 'next' | 'deadline' | 'day';
export type SlackSlot = 'morning' | 'evening';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  telegramId: bigint('telegram_id', { mode: 'number' }).notNull().unique(),
  username: varchar('username', { length: 255 }),
  fullName: varchar('full_name', { length: 255 }).notNull(),
  avatarUrl: text('avatar_url'),
  moodleToken: text('moodle_token'),
  calendarUrl: text('calendar_url'),
  studentType: studentTypeEnum('student_type').default('contract'),
  faculty: varchar('faculty', { length: 255 }),
  year: integer('year'),
  languagePref: languageEnum('language_pref').default('uk'),
  // Telegram bot: which sources go into the digest and at what hour (Europe/Kyiv)
  digestSources: jsonb('digest_sources').$type<DigestSource[]>().default(['moodle', 'gmail', 'slack']).notNull(),
  digestHour: integer('digest_hour').default(20).notNull(),
  lastDigestAt: timestamp('last_digest_at'),
  calendarSyncedAt: timestamp('calendar_synced_at'),
  botBlocked: boolean('bot_blocked').default(false).notNull(),
  // Other KSE Hub students can see this student's weekly schedule (off = hidden from search)
  scheduleVisible: boolean('schedule_visible').default(true).notNull(),
  // Finished the mini app sign-up (KSE mail connected); the bot works only after this
  onboardedAt: timestamp('onboarded_at'),
  // Schedule notifications: class moved/cancelled (on), "class in 15 min" (opt-in)
  notifyScheduleChanges: boolean('notify_schedule_changes').default(true).notNull(),
  classReminders: boolean('class_reminders').default(false).notNull(),
  lastWeeklyAt: timestamp('last_weekly_at'),
  isAdmin: boolean('is_admin').default(false).notNull(),
  // 011: who sent the invite link this student came from
  invitedBy: integer('invited_by'),
  // 015: the live pinned message in the bot chat — what it shows, its id, its current text
  // 018: on for new students — the next class at the top of the chat
  pinnedKind: varchar('pinned_kind', { length: 10 }).$type<PinnedKind>().default('next').notNull(),
  pinnedMessageId: integer('pinned_message_id'),
  pinnedText: text('pinned_text'),
  // 016: when the Slack digest comes — morning (09:00), evening (20:00) or both
  slackDigestSlots: jsonb('slack_digest_slots').$type<SlackSlot[]>().default(['evening']).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('users_telegram_id_idx').on(table.telegramId),
]);

export type DigestSource = 'moodle' | 'gmail' | 'slack';

/* ───────────── DEADLINE REMINDERS ───────────── */

// One row per (assignment, kind) so the cron never sends the same reminder twice
export const deadlineReminders = pgTable('deadline_reminders', {
  id: serial('id').primaryKey(),
  assignmentId: integer('assignment_id').notNull().references(() => moodleAssignments.id, { onDelete: 'cascade' }),
  kind: varchar('kind', { length: 10 }).notNull(),
  sentAt: timestamp('sent_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('deadline_reminders_assignment_kind_idx').on(table.assignmentId, table.kind),
]);

/* ───────────── GOOGLE (Gmail + Calendar) ───────────── */

export const googleAccounts = pgTable('google_accounts', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  email: varchar('email', { length: 255 }).notNull(),
  // AES-256-GCM encrypted (utils/crypto.ts), never stored in plain text
  refreshTokenEnc: text('refresh_token_enc').notNull(),
  scopes: text('scopes'),
  lastSyncAt: timestamp('last_sync_at'),
  calendarsSyncedAt: timestamp('calendars_synced_at'),
  syncError: text('sync_error'),
  connectedAt: timestamp('connected_at').defaultNow().notNull(),
});

export type EmailSource = 'gmail' | 'slack' | 'moodle';
export type EmailCategory =
  | 'deadline' | 'event' | 'internship' | 'job' | 'startup' | 'admin' | 'newsletter' | 'other';

/**
 * One summary per distinct piece of content. The same mailing sent to many
 * students (same Message-ID, or same normalized body) is summarized once.
 */
export const summaries = pgTable('summaries', {
  id: serial('id').primaryKey(),
  messageIdHeader: varchar('message_id_header', { length: 500 }).unique(),
  bodyHash: varchar('body_hash', { length: 64 }).notNull().unique(),
  summary: text('summary').notNull(),
  category: varchar('category', { length: 20 }).$type<EmailCategory>().notNull(),
  important: boolean('important').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const emails = pgTable('emails', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  gmailId: varchar('gmail_id', { length: 100 }).notNull(),
  source: varchar('source', { length: 10 }).$type<EmailSource>().default('gmail').notNull(),
  fromName: varchar('from_name', { length: 255 }),
  subject: text('subject'),
  receivedAt: timestamp('received_at').notNull(),
  summaryId: integer('summary_id').references(() => summaries.id, { onDelete: 'set null' }),
  digestedAt: timestamp('digested_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('emails_user_gmail_idx').on(table.userId, table.gmailId),
  index('emails_user_digest_idx').on(table.userId, table.digestedAt),
]);

/* ───────────── SCHEDULE (KSE course calendars) ───────────── */

/**
 * KSE publishes one Google calendar per course section ("ECON100 [L1] …").
 * Students subscribe to theirs; two students share a class exactly when they
 * share a calendar. Events are stored once per calendar, not per student.
 */
export const courseCalendars = pgTable('course_calendars', {
  id: serial('id').primaryKey(),
  googleId: varchar('google_id', { length: 255 }).notNull().unique(),
  courseCode: varchar('course_code', { length: 20 }).notNull(),
  section: varchar('section', { length: 20 }),
  title: varchar('title', { length: 255 }).notNull(),
  eventsSyncedAt: timestamp('events_synced_at'),
});

export const userCalendars = pgTable('user_calendars', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  calendarId: integer('calendar_id').notNull().references(() => courseCalendars.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('user_calendars_user_calendar_idx').on(table.userId, table.calendarId),
  index('user_calendars_calendar_idx').on(table.calendarId),
]);

export const calendarEvents = pgTable('calendar_events', {
  id: serial('id').primaryKey(),
  calendarId: integer('calendar_id').notNull().references(() => courseCalendars.id, { onDelete: 'cascade' }),
  googleEventId: varchar('google_event_id', { length: 255 }).notNull(),
  title: text('title').notNull(),
  location: text('location'),
  startAt: timestamp('start_at').notNull(),
  endAt: timestamp('end_at').notNull(),
}, (table) => [
  uniqueIndex('calendar_events_calendar_event_idx').on(table.calendarId, table.googleEventId),
  index('calendar_events_start_idx').on(table.startAt),
]);

// "Class in 15 min" sent once per student per class
export const classReminders = pgTable('class_reminders', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  eventId: varchar('event_key', { length: 300 }).notNull(),
  sentAt: timestamp('sent_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('class_reminders_user_event_idx').on(table.userId, table.eventId),
]);

/* ───────────── KSE KNOWLEDGE BASE ───────────── */

// Public KSE pages the assistant can quote; `hash` lets a re-crawl skip unchanged pages
export const kbPages = pgTable('kb_pages', {
  id: serial('id').primaryKey(),
  url: text('url').notNull().unique(),
  title: text('title').notNull(),
  hash: varchar('hash', { length: 64 }).notNull(),
  fetchedAt: timestamp('fetched_at').defaultNow().notNull(),
});

export const kbChunks = pgTable('kb_chunks', {
  id: serial('id').primaryKey(),
  pageId: integer('page_id').notNull().references(() => kbPages.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 768 }).notNull(),
}, (table) => [
  index('kb_chunks_page_idx').on(table.pageId),
]);

/* ───────────── ANALYTICS ───────────── */

// One row per meaningful action ("ai.message", "tab.schedule", "digest.sent"…), for the admin dashboard
export const usageEvents = pgTable('usage_events', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  event: varchar('event', { length: 50 }).notNull(),
  props: jsonb('props').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('usage_events_created_idx').on(table.createdAt),
  index('usage_events_event_idx').on(table.event, table.createdAt),
]);

/* ───────────── AI ASSISTANT ───────────── */

// Recent turns of the student's chat with the assistant (bot chat and mini app share it)
export const chatMessages = pgTable('chat_messages', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 10 }).$type<'user' | 'assistant'>().notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('chat_messages_user_idx').on(table.userId, table.createdAt),
]);

/* ───────────── ROOMS ───────────── */

export const rooms = pgTable('rooms', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  type: roomTypeEnum('type').notNull(),
  capacity: integer('capacity').notNull().default(1),
  hasDesk: boolean('has_desk').default(false),
  hasPower: boolean('has_power').default(true),
  floor: integer('floor'),
  metadata: jsonb('metadata'),
});

/* ───────────── BOOKINGS ───────────── */

export const bookings = pgTable('bookings', {
  id: serial('id').primaryKey(),
  roomId: integer('room_id').notNull().references(() => rooms.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time').notNull(),
  status: bookingStatusEnum('status').default('active').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('bookings_room_time_idx').on(table.roomId, table.startTime, table.endTime),
  index('bookings_user_date_idx').on(table.userId, table.startTime),
]);

/* ───────────── MOODLE ───────────── */

export const moodleCourses = pgTable('moodle_courses', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  courseId: varchar('course_id', { length: 100 }).notNull(),
  courseName: varchar('course_name', { length: 500 }).notNull(),
  courseNameUk: varchar('course_name_uk', { length: 500 }),
  sections: jsonb('sections'),
  syncedAt: timestamp('synced_at').defaultNow(),
});

export const moodleAssignments = pgTable('moodle_assignments', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  courseId: integer('course_id').references(() => moodleCourses.id, { onDelete: 'cascade' }),
  externalId: varchar('external_id', { length: 100 }),
  title: varchar('title', { length: 500 }).notNull(),
  dueDate: timestamp('due_date'),
  sourceUrl: text('source_url'),
  isCompleted: boolean('is_completed').default(false),
  type: assignmentTypeEnum('type').default('assignment'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  // 010: another practice group's copy, an "opens" entry, a duplicate or no due date (utils/moodleGroups.ts)
  hidden: boolean('hidden').default(false).notNull(),
  groupNo: integer('group_no'),
  // 010: from Moodle's receipt and feedback emails
  submittedAt: timestamp('submitted_at'),
  feedbackAt: timestamp('feedback_at'),
}, (table) => [
  index('assignments_user_due_idx').on(table.userId, table.dueDate),
]);

/* ───────────── VENTURE MATCH ───────────── */

export const ventureProfiles = pgTable('venture_profiles', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull(),
  bio: text('bio'),
  skills: jsonb('skills').$type<string[]>().default([]),
  lookingFor: jsonb('looking_for').$type<string[]>().default([]),
  githubUrl: varchar('github_url', { length: 500 }),
  portfolioUrl: varchar('portfolio_url', { length: 500 }),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const ventureProjects = pgTable('venture_projects', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull(),
  pitch: text('pitch'),
  problem: text('problem'),
  targetMvp: text('target_mvp'),
  requiredRoles: jsonb('required_roles').$type<string[]>().default([]),
  commitmentLevel: varchar('commitment_level', { length: 100 }),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/* ───────────── SWIPES & MATCHES ───────────── */

export const swipes = pgTable('swipes', {
  id: serial('id').primaryKey(),
  actorId: integer('actor_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  targetId: integer('target_id').notNull(),
  targetType: swipeTargetTypeEnum('target_type').notNull(),
  isLike: boolean('is_like').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('swipes_actor_target_idx').on(table.actorId, table.targetId, table.targetType),
]);

export const matches = pgTable('matches', {
  id: serial('id').primaryKey(),
  userAId: integer('user_a_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  userBId: integer('user_b_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  matchType: matchTypeEnum('match_type').notNull(),
  projectId: integer('project_id').references(() => ventureProjects.id),
  matchedAt: timestamp('matched_at').defaultNow().notNull(),
});

/* ───────────── STARTUP APPLICATIONS ───────────── */

// A student asks to join a startup in a role; the author accepts or declines
export const projectApplications = pgTable('project_applications', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id').notNull().references(() => ventureProjects.id, { onDelete: 'cascade' }),
  applicantId: integer('applicant_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 100 }),
  message: text('message'),
  status: applicationStatusEnum('status').default('pending').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  decidedAt: timestamp('decided_at'),
}, (table) => [
  uniqueIndex('project_applications_project_applicant_idx').on(table.projectId, table.applicantId),
]);

/* ───────────── OPPORTUNITIES ───────────── */

export const opportunities = pgTable('opportunities', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 500 }).notNull(),
  company: varchar('company', { length: 255 }).notNull(),
  domain: varchar('domain', { length: 255 }),
  eligibility: eligibilityEnum('eligibility').default('all').notNull(),
  category: opportunityCategoryEnum('category').default('internship').notNull(),
  deadline: timestamp('deadline'),
  url: text('url'),
  description: text('description'),
  salaryInfo: varchar('salary_info', { length: 255 }),
  // Programme codes from the letter ("BE", "EBD"); empty means open to everyone
  programs: varchar('programs', { length: 10 }).array().default(sql`'{}'`).notNull(),
  slackMessageId: varchar('slack_message_id', { length: 100 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('opportunities_deadline_idx').on(table.deadline),
  index('opportunities_eligibility_idx').on(table.eligibility),
]);

/** Opportunities a student saved; a reminder goes out 3 days before the application deadline. */
export const savedOpportunities = pgTable('saved_opportunities', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  opportunityId: integer('opportunity_id').notNull().references(() => opportunities.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  remindedAt: timestamp('reminded_at'),
}, (table) => [primaryKey({ columns: [table.userId, table.opportunityId] })]);

/* ───────────── NOTIFICATIONS ───────────── */

export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: notificationTypeEnum('type').notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  message: text('message'),
  actionUrl: text('action_url'),
  isRead: boolean('is_read').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('notifications_user_unread_idx').on(table.userId, table.isRead),
]);

/* ───────────── RELATIONS ───────────── */

export const usersRelations = relations(users, ({ many }) => ({
  bookings: many(bookings),
  moodleCourses: many(moodleCourses),
  moodleAssignments: many(moodleAssignments),
  ventureProfiles: many(ventureProfiles),
  ventureProjects: many(ventureProjects),
  swipes: many(swipes),
  notifications: many(notifications),
}));

export const roomsRelations = relations(rooms, ({ many }) => ({
  bookings: many(bookings),
}));

export const bookingsRelations = relations(bookings, ({ one }) => ({
  room: one(rooms, { fields: [bookings.roomId], references: [rooms.id] }),
  user: one(users, { fields: [bookings.userId], references: [users.id] }),
}));

export const moodleCoursesRelations = relations(moodleCourses, ({ one, many }) => ({
  user: one(users, { fields: [moodleCourses.userId], references: [users.id] }),
  assignments: many(moodleAssignments),
}));

export const moodleAssignmentsRelations = relations(moodleAssignments, ({ one }) => ({
  user: one(users, { fields: [moodleAssignments.userId], references: [users.id] }),
  course: one(moodleCourses, { fields: [moodleAssignments.courseId], references: [moodleCourses.id] }),
}));

export const ventureProfilesRelations = relations(ventureProfiles, ({ one }) => ({
  user: one(users, { fields: [ventureProfiles.userId], references: [users.id] }),
}));

export const ventureProjectsRelations = relations(ventureProjects, ({ one }) => ({
  user: one(users, { fields: [ventureProjects.userId], references: [users.id] }),
}));

export const swipesRelations = relations(swipes, ({ one }) => ({
  actor: one(users, { fields: [swipes.actorId], references: [users.id] }),
}));

export const matchesRelations = relations(matches, ({ one }) => ({
  userA: one(users, { fields: [matches.userAId], references: [users.id], relationName: 'matchUserA' }),
  userB: one(users, { fields: [matches.userBId], references: [users.id], relationName: 'matchUserB' }),
  project: one(ventureProjects, { fields: [matches.projectId], references: [ventureProjects.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

/* ───────────── FRIENDS (011) ───────────── */

export type FriendshipStatus = 'pending' | 'accepted' | 'declined';

/** One row per pair (unique on least/greatest of the two ids, see sql/011_friends.sql). */
export const friendships = pgTable('friendships', {
  id: serial('id').primaryKey(),
  requesterId: integer('requester_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  addresseeId: integer('addressee_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 10 }).$type<FriendshipStatus>().default('pending').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  decidedAt: timestamp('decided_at'),
});

/* ───────────── REMINDERS (012) ───────────── */

export type ReminderKind = 'self' | 'friend' | 'event';

/** To myself, from a friend (sent at once, kept for the daily limit) or the day before an event. */
export const reminders = pgTable('reminders', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  fromUserId: integer('from_user_id').references(() => users.id, { onDelete: 'cascade' }),
  kind: varchar('kind', { length: 10 }).$type<ReminderKind>().default('self').notNull(),
  text: varchar('text', { length: 300 }).notNull(),
  remindAt: timestamp('remind_at').notNull(),
  startapp: varchar('startapp', { length: 64 }),
  eventId: integer('event_id'),
  sentAt: timestamp('sent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const reminderMutes = pgTable('reminder_mutes', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mutedUserId: integer('muted_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.mutedUserId] })]);

/* ───────────── EVENTS (013) ───────────── */

/** Seminars, talks, club meetups from KSE mailings. `audience: 'user'` = a personal invite, seen only by `userId`. */
export const events = pgTable('events', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 300 }).notNull(),
  startsAt: timestamp('starts_at').notNull(),
  location: varchar('location', { length: 200 }),
  description: text('description'),
  programs: varchar('programs', { length: 10 }).array().default(sql`'{}'`).notNull(),
  registrationUrl: text('registration_url'),
  audience: varchar('audience', { length: 10 }).$type<'all' | 'user' | 'slack'>().default('all').notNull(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  sourceKey: varchar('source_key', { length: 100 }).notNull().unique(),
  // 016: from a private Slack channel (audience 'slack') — seen by whoever sees that channel
  slackChannelId: varchar('slack_channel_id', { length: 20 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/* ───────────── COURSE LINKS (014) ───────────── */

/** Per course, shared by everyone: its Slack channel (from Slack notification emails) and office hours. */
export const courseLinks = pgTable('course_links', {
  courseCode: varchar('course_code', { length: 20 }).primaryKey(),
  slackTeam: varchar('slack_team', { length: 100 }),
  slackChannelId: varchar('slack_channel_id', { length: 20 }),
  slackChannelName: varchar('slack_channel_name', { length: 100 }),
  officeHours: text('office_hours'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/* ───────────── SLACK DIGESTS (016) ───────────── */

export type SlackChannelStatus = 'pending' | 'active' | 'hidden';
export type SlackSummaryStatus = 'draft' | 'published' | 'rejected';
export type SlackItem = {
  kind: 'deadline' | 'change' | 'announcement' | 'event' | 'other';
  text: string;
  dueAt?: string;
  permalink: string;
};
export type SlackEvent = { title: string; startsAt: string; place?: string; permalink: string };

/**
 * A channel the reader account is in. A private one is tied to a course (+ section) or a cohort
 * (programme + entry year), from its name or by the owner in the admin; until then it's `pending` and nobody sees it.
 * Summaries of an active channel go out on their own unless the owner turned `auto_publish` off.
 */
export const slackChannels = pgTable('slack_channels', {
  channelId: varchar('channel_id', { length: 20 }).primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  team: varchar('team', { length: 100 }),
  isPrivate: boolean('is_private').default(false).notNull(),
  status: varchar('status', { length: 10 }).$type<SlackChannelStatus>().default('pending').notNull(),
  courseCode: varchar('course_code', { length: 20 }),
  section: varchar('section', { length: 20 }),
  program: varchar('program', { length: 10 }),
  cohortYear: integer('cohort_year'),
  lastTs: varchar('last_ts', { length: 20 }),
  defaultOn: boolean('default_on').default(false).notNull(),
  // 017: on by default — summaries go out without review; the owner can switch a channel to drafts
  autoPublish: boolean('auto_publish').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

/** What Claude's task wrote about a channel for one stretch of time; drafts wait for the owner's review. */
export const slackSummaries = pgTable('slack_summaries', {
  id: serial('id').primaryKey(),
  channelId: varchar('channel_id', { length: 20 }).notNull().references(() => slackChannels.channelId, { onDelete: 'cascade' }),
  fromTs: varchar('from_ts', { length: 20 }).notNull(),
  toTs: varchar('to_ts', { length: 20 }).notNull(),
  summary: text('summary').notNull(),
  items: jsonb('items').$type<SlackItem[]>().default([]).notNull(),
  // Go to `events` only on publish, so a draft can't show up in «Події»
  events: jsonb('events').$type<SlackEvent[]>().default([]).notNull(),
  status: varchar('status', { length: 10 }).$type<SlackSummaryStatus>().default('draft').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  publishedAt: timestamp('published_at'),
  // 017: published by the owner from the admin (not automatically) — sends the digest soon after
  reviewed: boolean('reviewed').default(false).notNull(),
}, (table) => [
  uniqueIndex('slack_summaries_channel_to_idx').on(table.channelId, table.toTs),
  index('slack_summaries_status_idx').on(table.status, table.publishedAt),
]);

/** A student's own choice; no row = the default (own private channel on, open channel per `default_on`). */
export const userSlackSubscriptions = pgTable('user_slack_subscriptions', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  channelId: varchar('channel_id', { length: 20 }).notNull().references(() => slackChannels.channelId, { onDelete: 'cascade' }),
  on: boolean('on').notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.channelId] })]);

export const slackDeliveries = pgTable('slack_deliveries', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  summaryId: integer('summary_id').notNull().references(() => slackSummaries.id, { onDelete: 'cascade' }),
  deliveredAt: timestamp('delivered_at').defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.summaryId] })]);

/** Channels a student got Slack notification emails from — proof they're in it. */
export const userSlackChannels = pgTable('user_slack_channels', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  channelId: varchar('channel_id', { length: 20 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [primaryKey({ columns: [table.userId, table.channelId] })]);
