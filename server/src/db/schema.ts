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
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

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
export const notificationTypeEnum = pgEnum('notification_type', [
  'deadline', 'match', 'booking_expiry', 'system',
]);

/* ───────────── USERS ───────────── */

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
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  uniqueIndex('users_telegram_id_idx').on(table.telegramId),
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
  slackMessageId: varchar('slack_message_id', { length: 100 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('opportunities_deadline_idx').on(table.deadline),
  index('opportunities_eligibility_idx').on(table.eligibility),
]);

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
