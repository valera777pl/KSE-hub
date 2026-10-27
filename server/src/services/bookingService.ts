import { db, queryClient } from '../db/connection.js';
import { bookings, rooms } from '../db/schema.js';
import { eq, and, gte, lte, lt, gt, sql, ne } from 'drizzle-orm';
import { AppError } from '../middleware/errorHandler.js';
import { getDayBounds, diffInHours } from '../utils/dateUtils.js';

const MAX_DAILY_HOURS = 3;

/** Earliest moment at or after `from` when a slot of `durationMs` fits between these (sorted) bookings. */
export function freeFrom(taken: { startTime: Date; endTime: Date }[], from: Date, durationMs: number): string {
  let t = from.getTime();
  for (const b of taken) {
    if (b.startTime.getTime() < t + durationMs && b.endTime.getTime() > t) t = b.endTime.getTime();
  }
  return new Date(t).toISOString();
}
const HOT_BOOKING_MINUTES = 30;

const formatHours = (h: number) => {
  const min = Math.max(0, Math.round(h * 60));
  return min < 60 ? `${min} хв` : min % 60 ? `${Math.floor(min / 60)} год ${min % 60} хв` : `${min / 60} год`;
};

export class BookingService {
  /**
   * Atomic room booking with optimistic concurrency control.
   * Uses SELECT FOR UPDATE to prevent double-booking race conditions.
   */
  static async createBooking(
    userId: number,
    roomId: number,
    startTime: Date,
    endTime: Date
  ) {
    // postgres.js can't serialize Date in these raw queries. Columns are
    // `timestamp` (UTC wall time, same as drizzle writes), so pass ISO strings.
    const startIso = startTime.toISOString();
    const endIso = endTime.toISOString();

    // Use raw SQL transaction for row-level locking
    const result = await queryClient.begin(async (tx) => {
      // 1. Check daily quota
      const { start: dayStart, end: dayEnd } = getDayBounds(startTime);
      const [quotaResult] = await tx`
        SELECT COALESCE(SUM(
          EXTRACT(EPOCH FROM (end_time - start_time)) / 3600
        ), 0)::float AS total_hours
        FROM bookings
        WHERE user_id = ${userId}
          AND start_time >= ${dayStart.toISOString()}
          AND start_time <= ${dayEnd.toISOString()}
          AND status = 'active'
      `;

      const currentHours = quotaResult.total_hours as number;
      const requestedHours = diffInHours(startTime, endTime);

      if (currentHours + requestedHours > MAX_DAILY_HOURS) {
        throw new AppError(
          `Денна квота — ${MAX_DAILY_HOURS} год. Сьогодні лишилось ${formatHours(MAX_DAILY_HOURS - currentHours)}, ` +
          `а ти просиш ${formatHours(requestedHours)}`,
          409
        );
      }

      // 2. Lock the room row to prevent concurrent booking
      const [room] = await tx`
        SELECT * FROM rooms WHERE id = ${roomId} FOR UPDATE
      `;
      if (!room) {
        throw new AppError('Такої кімнати немає', 404);
      }

      // 3. Check for overlapping bookings
      const [overlap] = await tx`
        SELECT COUNT(*)::int AS cnt FROM bookings
        WHERE room_id = ${roomId}
          AND status = 'active'
          AND start_time < ${endIso}
          AND end_time > ${startIso}
      `;

      if (overlap.cnt > 0) {
        throw new AppError('Цей час уже хтось забронював. Обери інший або іншу кімнату', 409);
      }

      // 4. One room at a time per student
      const [own] = await tx`
        SELECT COUNT(*)::int AS cnt FROM bookings
        WHERE user_id = ${userId}
          AND status = 'active'
          AND start_time < ${endIso}
          AND end_time > ${startIso}
      `;
      if (own.cnt > 0) {
        throw new AppError('На цей час у тебе вже є бронь', 409);
      }

      // 5. Insert booking
      const [booking] = await tx`
        INSERT INTO bookings (room_id, user_id, start_time, end_time, status)
        VALUES (${roomId}, ${userId}, ${startIso}, ${endIso}, 'active')
        RETURNING *
      `;

      return { booking, room };
    });

    return result;
  }

  /**
   * Hot Booking: Instantly book the next 30 minutes.
   */
  static async hotBook(userId: number, roomId: number) {
    const now = new Date();
    const endTime = new Date(now.getTime() + HOT_BOOKING_MINUTES * 60 * 1000);
    return this.createBooking(userId, roomId, now, endTime);
  }

  /**
   * Cancel an active booking.
   */
  static async cancelBooking(bookingId: number, userId: number) {
    const [booking] = await db
      .update(bookings)
      .set({ status: 'cancelled' })
      .where(
        and(
          eq(bookings.id, bookingId),
          eq(bookings.userId, userId),
          eq(bookings.status, 'active')
        )
      )
      .returning();

    if (!booking) {
      throw new AppError('Бронь не знайдено або її вже скасовано', 404);
    }

    return booking;
  }

  /**
   * Get available rooms for a given time range.
   */
  static async getAvailableRooms(startTime: Date, endTime: Date, roomType?: string) {
    const allRooms = roomType
      ? await db.select().from(rooms).where(eq(rooms.type, roomType as any))
      : await db.select().from(rooms);

    // Active bookings that touch the window or the rest of that day: enough to say both
    // "busy" and from when the room is free again for the same length
    const { end: dayEnd } = getDayBounds(startTime);
    const dayBookings = await db
      .select({ roomId: bookings.roomId, startTime: bookings.startTime, endTime: bookings.endTime })
      .from(bookings)
      .where(and(eq(bookings.status, 'active'), lt(bookings.startTime, dayEnd), gt(bookings.endTime, startTime)))
      .orderBy(bookings.startTime);

    return allRooms.map((room) => {
      const own = dayBookings.filter((b) => b.roomId === room.id);
      const available = !own.some((b) => b.startTime < endTime && b.endTime > startTime);
      return { ...room, available, freeFrom: available ? null : freeFrom(own, startTime, endTime.getTime() - startTime.getTime()) };
    });
  }

  /**
   * Get room schedule for a given day.
   */
  static async getRoomSchedule(roomId: number, date: Date) {
    const { start, end } = getDayBounds(date);
    const dayBookings = await db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.roomId, roomId),
          eq(bookings.status, 'active'),
          gte(bookings.startTime, start),
          lte(bookings.startTime, end)
        )
      );

    const room = await db.select().from(rooms).where(eq(rooms.id, roomId)).limit(1);
    return { room: room[0], bookings: dayBookings };
  }

  /**
   * Get user's active bookings.
   */
  static async getUserBookings(userId: number) {
    return db
      .select({
        booking: bookings,
        room: rooms,
      })
      .from(bookings)
      .innerJoin(rooms, eq(bookings.roomId, rooms.id))
      .where(
        and(
          eq(bookings.userId, userId),
          eq(bookings.status, 'active'),
          gt(bookings.endTime, new Date())
        )
      )
      .orderBy(bookings.startTime);
  }

  /**
   * Get remaining daily quota in hours.
   */
  static async getRemainingQuota(userId: number, date: Date = new Date()) {
    const { start, end } = getDayBounds(date);
    const [result] = await db
      .select({
        totalHours: sql<number>`COALESCE(SUM(
          EXTRACT(EPOCH FROM (${bookings.endTime} - ${bookings.startTime})) / 3600
        ), 0)::float`,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.userId, userId),
          eq(bookings.status, 'active'),
          gte(bookings.startTime, start),
          lte(bookings.startTime, end)
        )
      );

    return {
      used: result.totalHours,
      remaining: MAX_DAILY_HOURS - result.totalHours,
      max: MAX_DAILY_HOURS,
    };
  }

  /**
   * Get all rooms.
   */
  static async getAllRooms() {
    return db.select().from(rooms);
  }
}
