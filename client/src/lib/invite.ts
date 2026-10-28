import { api, track } from '../api/client';
import { tg } from './telegram';
import { tr } from './i18n';

/**
 * "Запросити в KSE Hub": Telegram's share sheet with my invite link. Whoever joins through it
 * becomes my friend after onboarding, and I get "Данило вже в KSE Hub".
 */
export async function inviteFriend() {
  const { link } = await api.get<{ link: string }>('/friends/invite');
  const text = tr('Розклад, дедлайни з Moodle і кімнати KSE в одному місці. Заходь — будемо друзями в KSE Hub.',
    'KSE schedule, Moodle deadlines and rooms in one place. Join me on KSE Hub.');
  const share = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
  track('invite.sent');
  const app = tg();
  if (app) app.openTelegramLink(share);
  else window.open(share, '_blank');
}
