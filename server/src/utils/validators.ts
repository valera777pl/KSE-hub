import { z } from 'zod';

/* ───── Booking Validators ───── */

export const createBookingSchema = z.object({
  roomId: z.number().int().positive(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
}).refine(
  (data) => new Date(data.endTime) > new Date(data.startTime),
  { message: 'End time must be after start time' }
).refine(
  (data) => {
    const diff = (new Date(data.endTime).getTime() - new Date(data.startTime).getTime()) / (1000 * 60);
    return diff >= 15 && diff <= 180;
  },
  { message: 'Booking must be between 15 minutes and 3 hours' }
);

export const hotBookingSchema = z.object({
  roomId: z.number().int().positive(),
});

/* ───── User Profile Validators ───── */

export const updateProfileSchema = z.object({
  fullName: z.string().min(1).max(255).optional(),
  faculty: z.string().max(255).optional(),
  year: z.number().int().min(1).max(6).optional(),
  studentType: z.enum(['grant', 'contract']).optional(),
  languagePref: z.enum(['uk', 'en']).optional(),
  moodleToken: z.string().optional(),
  calendarUrl: z.string().optional().or(z.literal('')),
});

/* ───── Venture Profile Validators ───── */

export const ventureProfileSchema = z.object({
  title: z.string().min(1).max(255),
  bio: z.string().max(2000).optional(),
  skills: z.array(z.string()).max(20).optional(),
  lookingFor: z.array(z.string()).max(10).optional(),
  githubUrl: z.string().url().optional().or(z.literal('')),
  portfolioUrl: z.string().url().optional().or(z.literal('')),
});

export const ventureProjectSchema = z.object({
  title: z.string().min(1).max(255),
  pitch: z.string().max(2000).optional(),
  problem: z.string().max(2000).optional(),
  targetMvp: z.string().max(2000).optional(),
  requiredRoles: z.array(z.string()).max(10).optional(),
  commitmentLevel: z.string().max(100).optional(),
});

/* ───── Swipe Validators ───── */

export const swipeSchema = z.object({
  targetId: z.number().int().positive(),
  targetType: z.enum(['profile', 'project']),
  isLike: z.boolean(),
});

/* ───── Opportunity Filters ───── */

export const opportunityFilterSchema = z.object({
  eligibility: z.enum(['grant', 'contract', 'all']).optional(),
  category: z.enum(['internship', 'job', 'grant', 'research']).optional(),
  domain: z.string().optional(),
  search: z.string().optional(),
});

/* ───── Copilot ───── */

export const chatMessageSchema = z.object({
  message: z.string().min(1).max(2000),
});
