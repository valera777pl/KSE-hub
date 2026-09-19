import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBookingStore } from '../../../stores/bookingStore';
import type { Room } from '../../../types';

export function RoomsPage() {
  const { t } = useTranslation();
  const {
    rooms, myBookings, quota,
    fetchRooms, fetchMyBookings, fetchQuota, fetchAvailableRooms,
    createBooking, hotBook, cancelBooking,
  } = useBookingStore();

  const [view, setView] = useState<'bookTime' | 'bookRoom' | 'hotBook'>('bookTime');
  const [selectedType, setSelectedType] = useState<string>('');
  const [availableRooms, setAvailableRooms] = useState<Room[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<{ start: string; end: string } | null>(null);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    fetchRooms();
    fetchMyBookings();
    fetchQuota();
  }, []);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
    try {
      // @ts-ignore
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred(type === 'success' ? 'success' : 'error');
    } catch {}
  };

  const handleBookTime = async () => {
    if (!selectedSlot) return;
    setBookingLoading(true);
    try {
      const avail = await fetchAvailableRooms(selectedSlot.start, selectedSlot.end, selectedType || undefined);
      setAvailableRooms(avail);
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setBookingLoading(false);
    }
  };

  const handleBook = async (roomId: number) => {
    if (!selectedSlot) return;
    setBookingLoading(true);
    try {
      await createBooking(roomId, selectedSlot.start, selectedSlot.end);
      showToast('success', t('rooms.bookingSuccess'));
      setSelectedSlot(null);
      setAvailableRooms([]);
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setBookingLoading(false);
    }
  };

  const handleHotBook = async (roomId: number) => {
    setBookingLoading(true);
    try {
      await hotBook(roomId);
      showToast('success', t('rooms.bookingSuccess'));
    } catch (err: any) {
      showToast('error', err.message);
    } finally {
      setBookingLoading(false);
    }
  };

  const handleCancel = async (bookingId: number) => {
    try {
      await cancelBooking(bookingId);
      showToast('success', 'Booking cancelled');
    } catch (err: any) {
      showToast('error', err.message);
    }
  };

  // Generate time slots for today
  const generateTimeSlots = () => {
    const slots: { label: string; start: string; end: string }[] = [];
    const now = new Date();
    const currentHour = now.getHours();

    for (let h = Math.max(8, currentHour); h < 22; h++) {
      for (const m of [0, 30]) {
        if (h === currentHour && m <= now.getMinutes()) continue;
        const start = new Date();
        start.setHours(h, m, 0, 0);
        const end = new Date(start.getTime() + 60 * 60 * 1000); // 1 hour slots
        slots.push({
          label: `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`,
          start: start.toISOString(),
          end: end.toISOString(),
        });
      }
    }
    return slots;
  };

  const quotaPercent = quota ? (quota.used / quota.max) * 100 : 0;

  return (
    <div className="page">
      {/* Toast */}
      {toast && (
        <div className="toast-container">
          <div className={`toast toast--${toast.type}`}>
            <span>{toast.type === 'success' ? '✓' : '✕'}</span>
            <span className="toast__message">{toast.message}</span>
          </div>
        </div>
      )}

      <h1 className="section-header__title" style={{ marginBottom: '16px' }}>{t('rooms.title')}</h1>

      {/* Quota Bar */}
      {quota && (
        <div className="card mb-lg" style={{ padding: '12px 16px' }}>
          <div className="flex justify-between items-center mb-sm">
            <span className="text-sm font-semibold">{t('rooms.quota')}</span>
            <span className="text-sm text-hint">
              {t('rooms.quotaRemaining', {
                remaining: quota.remaining.toFixed(1),
                max: quota.max,
              })}
            </span>
          </div>
          <div className="quota-bar">
            <div
              className={`quota-bar__fill ${
                quotaPercent > 80 ? 'quota-bar__fill--warning' : ''
              } ${quotaPercent >= 100 ? 'quota-bar__fill--full' : ''}`}
              style={{ width: `${Math.min(100, quotaPercent)}%` }}
            />
          </div>
        </div>
      )}

      {/* View Tabs */}
      <div className="tabs">
        {(['bookTime', 'bookRoom', 'hotBook'] as const).map((v) => (
          <button
            key={v}
            className={`tab ${view === v ? 'tab--active' : ''}`}
            onClick={() => setView(v)}
          >
            {t(`rooms.${v}`)}
          </button>
        ))}
      </div>

      {/* Book Time View */}
      {view === 'bookTime' && (
        <div>
          {/* Type Filter */}
          <div className="filter-chips">
            <button
              className={`filter-chip ${!selectedType ? 'filter-chip--active' : ''}`}
              onClick={() => setSelectedType('')}
            >
              {t('careers.all')}
            </button>
            <button
              className={`filter-chip ${selectedType === 'skype_room' ? 'filter-chip--active' : ''}`}
              onClick={() => setSelectedType('skype_room')}
            >
              📹 {t('rooms.skypeRoom')}
            </button>
            <button
              className={`filter-chip ${selectedType === 'silent_box' ? 'filter-chip--active' : ''}`}
              onClick={() => setSelectedType('silent_box')}
            >
              🔇 {t('rooms.silentBox')}
            </button>
          </div>

          {/* Time Slots */}
          <h3 className="text-sm font-semibold mb-sm">{t('rooms.selectTime')}</h3>
          <div className="time-slots">
            {generateTimeSlots().map((slot) => (
              <button
                key={slot.start}
                className={`time-slot time-slot--available ${
                  selectedSlot?.start === slot.start ? 'time-slot--selected' : ''
                }`}
                onClick={() => setSelectedSlot({ start: slot.start, end: slot.end })}
              >
                {slot.label}
              </button>
            ))}
          </div>

          {selectedSlot && (
            <button
              className="btn btn--primary btn--full mt-lg"
              onClick={handleBookTime}
              disabled={bookingLoading}
            >
              {bookingLoading ? '...' : `🔍 ${t('rooms.selectRoom')}`}
            </button>
          )}

          {/* Available Rooms */}
          {availableRooms.length > 0 && (
            <div className="room-grid mt-lg">
              {availableRooms.map((room) => (
                <div key={room.id} className="room-card">
                  <div className={`room-card__icon room-card__icon--${room.type === 'skype_room' ? 'skype' : 'silent'}`}>
                    {room.type === 'skype_room' ? '📹' : '🔇'}
                  </div>
                  <div className="room-card__info">
                    <div className="room-card__name">{room.name}</div>
                    <div className="room-card__meta">
                      <span>👤 {room.capacity}</span>
                      {room.hasDesk && <span>🪑 {t('rooms.hasDesk')}</span>}
                      {room.hasPower && <span>🔌 {t('rooms.hasPower')}</span>}
                    </div>
                  </div>
                  {room.available ? (
                    <button
                      className="btn btn--primary btn--small"
                      onClick={() => handleBook(room.id)}
                      disabled={bookingLoading}
                    >
                      {t('rooms.bookRoom')}
                    </button>
                  ) : (
                    <span className="room-card__status room-card__status--busy">
                      <span className="status-dot status-dot--busy" /> {t('rooms.busy')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Book Room View */}
      {view === 'bookRoom' && (
        <div className="room-grid">
          {rooms.map((room) => (
            <div key={room.id} className="room-card" style={{ cursor: 'default' }}>
              <div className={`room-card__icon room-card__icon--${room.type === 'skype_room' ? 'skype' : 'silent'}`}>
                {room.type === 'skype_room' ? '📹' : '🔇'}
              </div>
              <div className="room-card__info">
                <div className="room-card__name">{room.name}</div>
                <div className="room-card__meta">
                  <span>👤 {room.capacity}</span>
                  {room.floor && <span>{t('rooms.floor', { floor: room.floor })}</span>}
                </div>
              </div>
              <span className="room-card__status room-card__status--available">
                <span className="status-dot status-dot--available" />
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Hot Book View */}
      {view === 'hotBook' && (
        <div>
          <div className="card card--gradient mb-lg" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>⚡</div>
            <div style={{ fontSize: '18px', fontWeight: 700, marginBottom: '4px' }}>
              {t('rooms.hotBook')}
            </div>
            <div style={{ fontSize: '13px', opacity: 0.85 }}>{t('rooms.hotBookDesc')}</div>
          </div>

          <div className="room-grid">
            {rooms.map((room) => (
              <button
                key={room.id}
                className="hot-book-btn"
                onClick={() => handleHotBook(room.id)}
                disabled={bookingLoading}
                style={{ marginBottom: '8px' }}
              >
                {room.type === 'skype_room' ? '📹' : '🔇'} {room.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* My Bookings */}
      <div className="mt-lg">
        <h3 className="section-header__title mb-md">{t('rooms.myBookings')}</h3>
        {myBookings.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px' }}>
            <div className="empty-state__icon">📅</div>
            <div className="empty-state__title">{t('rooms.noBookings')}</div>
            <div className="empty-state__text">{t('rooms.noBookingsDesc')}</div>
          </div>
        ) : (
          myBookings.map(({ booking, room }) => (
            <div key={booking.id} className="card mb-sm" style={{ padding: '12px 16px' }}>
              <div className="flex justify-between items-center">
                <div>
                  <div className="font-semibold">{room.name}</div>
                  <div className="text-sm text-hint">
                    {new Date(booking.startTime).toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' })}
                    {' — '}
                    {new Date(booking.endTime).toLocaleTimeString('uk', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <button
                  className="btn btn--danger btn--small"
                  onClick={() => handleCancel(booking.id)}
                >
                  {t('rooms.cancel')}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
