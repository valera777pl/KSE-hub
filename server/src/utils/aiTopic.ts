/**
 * What a Copilot question was about, for the admin dashboard, without a second model call:
 * the tools the model chose say it best, keywords catch questions answered without tools.
 * Only the topic is stored, never the question.
 */
export type AiTopic = 'schedule' | 'deadlines' | 'rooms' | 'mail' | 'kse' | 'startups' | 'opportunities' | 'reminders' | 'other';

const BY_TOOL: Record<string, AiTopic> = {
  get_my_schedule: 'schedule',
  compare_schedule: 'schedule',
  find_free_classmates: 'schedule',
  get_my_deadlines: 'deadlines',
  get_available_rooms: 'rooms',
  book_room: 'rooms',
  hot_book_room: 'rooms',
  get_booking_quota: 'rooms',
  get_my_bookings: 'rooms',
  search_my_emails: 'mail',
  search_kse_info: 'kse',
  search_startups: 'startups',
  search_opportunities: 'opportunities',
  create_reminder: 'reminders',
};

const BY_WORD: [AiTopic, RegExp][] = [
  ['rooms', /кімнат|забронюй|брон|room|book/i],
  ['deadlines', /дедлайн|здати|завдан|квіз|moodle|deadline|assignment|due/i],
  ['schedule', /пар[аиуі]\b|розклад|завтра в мене|schedule|class/i],
  ['mail', /лист|пошт|mail|email/i],
  ['startups', /стартап|команд|startup/i],
  ['opportunities', /стажуван|ваканс|internship|job/i],
  ['kse', /kse|ксе|грант|оплат|вступ|обмін|програм|офіс|grant|tuition/i],
];

export function aiTopic(tools: string[], message: string): AiTopic {
  for (const name of tools) if (BY_TOOL[name]) return BY_TOOL[name];
  for (const [topic, re] of BY_WORD) if (re.test(message)) return topic;
  return 'other';
}
