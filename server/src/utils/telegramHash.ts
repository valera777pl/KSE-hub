import { createHmac } from 'crypto';

/**
 * Validates Telegram WebApp initData using HMAC-SHA256.
 * @see https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateTelegramInitData(
  initData: string,
  botToken: string
): { valid: boolean; user: TelegramUser | null } {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return { valid: false, user: null };

    // Remove hash from params and sort alphabetically
    params.delete('hash');
    const entries = Array.from(params.entries());
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

    // HMAC-SHA256: secret_key = HMAC_SHA256(bot_token, "WebAppData")
    const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computedHash = createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (computedHash !== hash) {
      return { valid: false, user: null };
    }

    // Check auth_date is not too old (5 minutes tolerance)
    const authDate = params.get('auth_date');
    if (authDate) {
      const authTimestamp = parseInt(authDate, 10);
      const now = Math.floor(Date.now() / 1000);
      if (now - authTimestamp > 300) {
        return { valid: false, user: null };
      }
    }

    // Parse user data
    const userStr = params.get('user');
    if (!userStr) return { valid: false, user: null };

    const user: TelegramUser = JSON.parse(userStr);
    return { valid: true, user };
  } catch {
    return { valid: false, user: null };
  }
}

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  is_premium?: boolean;
}
