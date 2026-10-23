import type OpenAI from 'openai';

export const toolDefinitions: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_my_deadlines',
      description: 'Get the student\'s upcoming Moodle deadlines (assignments and quizzes), sorted by due date.',
      parameters: {
        type: 'object',
        properties: {
          days: {
            type: 'number',
            description: 'How many days ahead to look. Default: 14.',
          },
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
      name: 'search_my_emails',
      description: 'Search summaries of the student\'s recent emails (KSE mail, Slack and Moodle notifications) from the last 30 days.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Words to look for in the subject or summary. Omit to get the latest emails.',
          },
          source: {
            type: 'string',
            enum: ['gmail', 'slack', 'moodle'],
            description: 'Only emails from this source.',
          },
        },
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
];
