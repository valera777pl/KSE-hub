import { Hono } from 'hono';
import { BookingService } from '../services/bookingService.js';
import { createBookingSchema, hotBookingSchema } from '../utils/validators.js';

const roomRoutes = new Hono();

// GET /rooms — List all rooms
roomRoutes.get('/', async (c) => {
  const rooms = await BookingService.getAllRooms();
  return c.json({ rooms });
});

// GET /rooms/available?start=...&end=...&type=...
roomRoutes.get('/available', async (c) => {
  const start = c.req.query('start') || new Date().toISOString();
  const end = c.req.query('end') || new Date(Date.now() + 3600000).toISOString();
  const type = c.req.query('type');

  const rooms = await BookingService.getAvailableRooms(
    new Date(start),
    new Date(end),
    type
  );
  return c.json({ rooms });
});

// GET /rooms/:id/schedule?date=...
roomRoutes.get('/:id/schedule', async (c) => {
  const roomId = parseInt(c.req.param('id'));
  const dateStr = c.req.query('date') || new Date().toISOString();
  const schedule = await BookingService.getRoomSchedule(roomId, new Date(dateStr));
  return c.json(schedule);
});

// POST /rooms/book — Create a booking
roomRoutes.post('/book', async (c) => {
  const body = await c.req.json();
  const data = createBookingSchema.parse(body);
  const user = c.get('dbUser');

  const result = await BookingService.createBooking(
    user.id,
    data.roomId,
    new Date(data.startTime),
    new Date(data.endTime)
  );

  return c.json(result, 201);
});

// POST /rooms/hot-book — Instant 30-minute booking
roomRoutes.post('/hot-book', async (c) => {
  const body = await c.req.json();
  const data = hotBookingSchema.parse(body);
  const user = c.get('dbUser');

  const result = await BookingService.hotBook(user.id, data.roomId);
  return c.json(result, 201);
});

// GET /rooms/my-bookings — User's active bookings
roomRoutes.get('/my-bookings', async (c) => {
  const user = c.get('dbUser');
  const bookings = await BookingService.getUserBookings(user.id);
  return c.json({ bookings });
});

// GET /rooms/quota — Remaining daily quota
roomRoutes.get('/quota', async (c) => {
  const user = c.get('dbUser');
  const quota = await BookingService.getRemainingQuota(user.id);
  return c.json(quota);
});

// DELETE /rooms/bookings/:id — Cancel booking
roomRoutes.delete('/bookings/:id', async (c) => {
  const bookingId = parseInt(c.req.param('id'));
  const user = c.get('dbUser');
  const booking = await BookingService.cancelBooking(bookingId, user.id);
  return c.json({ booking });
});

export { roomRoutes };
