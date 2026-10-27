import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { ArrowUp } from 'lucide-react';
import { api } from '../../api/client';
import { tr } from '../../lib/i18n';
import { haptic, tg } from '../../lib/telegram';

const BOT_CHAT = 'https://t.me/ksehub_bot';

type Turn = { q: string; a: string | null; error?: boolean };

/**
 * "Запитати Copilot" inside a class, deadline or opportunity: the question goes to the same
 * assistant as the bot chat, with what the student is looking at attached, so they never retype it.
 */
export function AskPanel({ about, context, starters, onBack }: { about: string; context: string; starters: string[]; onBack: () => void }) {
  const [text, setText] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const busy = turns.some((t) => t.a === null && !t.error);
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [turns]);

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    haptic.tap();
    setText('');
    setTurns((t) => [...t, { q: question, a: null }]);
    try {
      const r = await api.post<{ content: string }>('/copilot/chat', { message: `${tr('Контекст', 'Context')}: ${context}\n\n${question}` });
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a: r.content } : x)));
    } catch (e) {
      haptic.error();
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a: (e as Error).message, error: true } : x)));
    }
  };

  const openChat = () => {
    const app = tg();
    if (app) app.openTelegramLink(BOT_CHAT); else window.open(BOT_CHAT, '_blank');
  };

  return (
    <div className="ask">
      <button className="ask__about press" onClick={onBack}>{tr('Про', 'About')}: <b>{about}</b></button>

      <div className="ask__thread">
        {turns.length === 0 && (
          <div className="ask__starters">
            {starters.map((s) => <button key={s} className="press" onClick={() => ask(s)}>{s}</button>)}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i}>
            <div className="ask__q">{t.q}</div>
            {t.a === null
              ? <div className="ask__a ask__a--wait" aria-live="polite"><span className="skel" style={{ height: 12, width: '70%' }} /><span className="skel" style={{ height: 12, width: '45%' }} /></div>
              : <div className={`ask__a${t.error ? ' ask__a--error' : ''}`} aria-live="polite">{t.error ? t.a : <Markdown>{t.a}</Markdown>}</div>}
          </div>
        ))}
        <div ref={end} />
      </div>

      <form className="composer" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
        <textarea ref={input} rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder={tr('Запитай про це…', 'Ask about this…')}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(text); } }} aria-label={tr('Питання', 'Question')} />
        <button type="submit" className="composer__send" disabled={!text.trim() || busy} aria-label={tr('Надіслати', 'Send')}><ArrowUp strokeWidth={2.25} /></button>
      </form>
      <p className="note" style={{ textAlign: 'center' }}>
        {tr('Уся розмова — і в чаті з ботом.', 'The whole conversation is in the bot chat too.')}{' '}
        <button className="link-btn" style={{ padding: 0, fontSize: 13 }} onClick={openChat}>{tr('Відкрити чат', 'Open chat')}</button>
      </p>
    </div>
  );
}
