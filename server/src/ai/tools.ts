import type OpenAI from 'openai';

export const toolDefinitions: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_available_rooms',
      description: 'Find available rooms (Skype Rooms or Silent Boxes) for a given time range. Returns list of rooms with availability status.',
      parameters: {
        type: 'object',
        properties: {
          start_time: {
            type: 'string',
            description: 'Start time in ISO 8601 format. Defaults to now if not specified.',
          },
          end_time: {
            type: 'string',
            description: 'End time in ISO 8601 format. Defaults to 1 hour after start_time.',
          },
          room_type: {
            type: 'string',
            enum: ['skype_room', 'silent_box'],
            description: 'Filter by room type. Omit to search all types.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'book_room',
      description: 'Book a specific room for a time range. Maximum 3 hours per day per student. Checks for conflicts and quota.',
      parameters: {
        type: 'object',
        properties: {
          room_id: {
            type: 'number',
            description: 'The ID of the room to book.',
          },
          start_time: {
            type: 'string',
            description: 'Booking start time in ISO 8601 format.',
          },
          end_time: {
            type: 'string',
            description: 'Booking end time in ISO 8601 format.',
          },
        },
        required: ['room_id', 'start_time', 'end_time'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'hot_book_room',
      description: 'Instantly book a room for the next 30 minutes starting now.',
      parameters: {
        type: 'object',
        properties: {
          room_id: {
            type: 'number',
            description: 'The ID of the room to book instantly.',
          },
        },
        required: ['room_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_deadlines',
      description: 'Get the student\'s upcoming Moodle deadlines (assignments and quizzes), sorted by due date.',
      parameters: {
        type: 'object',
        properties: {
          include_completed: {
            type: 'boolean',
            description: 'Whether to include already completed assignments. Default: false.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_booking_quota',
      description: 'Check how many booking hours the student has remaining today (max 3h/day).',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_opportunities',
      description: 'Search internships, jobs, grants, and research opportunities. Can filter by student eligibility and domain.',
      parameters: {
        type: 'object',
        properties: {
          eligibility: {
            type: 'string',
            enum: ['grant', 'contract', 'all'],
            description: 'Filter by student eligibility type.',
          },
          domain: {
            type: 'string',
            description: 'Filter by domain (e.g., Tech, Economics, Consulting, Policy).',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_my_bookings',
      description: 'Get the student\'s currently active room bookings.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
];
