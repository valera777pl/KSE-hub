import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChatMessage } from '../../../types';
import { api } from '../../../api/client';

export function CopilotPage() {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: t('copilot.welcome'),
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      // @ts-ignore
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred('light');

      const response = await api.post<{ content: string; toolCalls: any[] }>('/copilot/chat', {
        message: userMsg.content,
      });

      const assistantMsg: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: response.content || t('copilot.error'),
        toolCalls: response.toolCalls,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: `❌ ${err.message || t('copilot.error')}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickAction = (text: string) => {
    setInput(text);
    setTimeout(() => {
      setInput(text);
      sendMessage();
    }, 100);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const renderMarkdown = (text: string) => {
    // Simple markdown rendering
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br/>');
  };

  return (
    <div className="chat-container">
      {/* Quick Actions (shown when few messages) */}
      {messages.length <= 1 && (
        <div className="chat-quick-actions">
          {Object.entries(t('copilot.quickActions', { returnObjects: true }) as Record<string, string>).map(
            ([key, label]) => (
              <button
                key={key}
                className="quick-action-btn"
                onClick={() => {
                  const prompts: Record<string, string> = {
                    bookRoom: 'Забронюй мені silent box на найближчу годину',
                    deadlines: 'Покажи мої найближчі дедлайни',
                    freeRooms: 'Які кімнати зараз вільні?',
                    opportunities: 'Знайди стажування для мене',
                  };
                  handleQuickAction(prompts[key] || label);
                }}
              >
                {label}
              </button>
            )
          )}
        </div>
      )}

      {/* Messages */}
      <div className="chat-messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-bubble chat-bubble--${msg.role}`}>
            {msg.role === 'assistant' ? (
              <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
            ) : (
              msg.content
            )}
          </div>
        ))}

        {loading && (
          <div className="chat-bubble chat-bubble--assistant">
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <span className="skeleton" style={{ width: '8px', height: '8px', borderRadius: '50%', animationDelay: '0s' }} />
              <span className="skeleton" style={{ width: '8px', height: '8px', borderRadius: '50%', animationDelay: '0.2s' }} />
              <span className="skeleton" style={{ width: '8px', height: '8px', borderRadius: '50%', animationDelay: '0.4s' }} />
              <span className="text-sm text-hint" style={{ marginLeft: '8px' }}>{t('copilot.thinking')}</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="chat-input-area">
        <textarea
          ref={inputRef}
          className="chat-input"
          placeholder={t('copilot.placeholder')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
        />
        <button
          className="chat-send-btn"
          onClick={sendMessage}
          disabled={!input.trim() || loading}
        >
          ↑
        </button>
      </div>
    </div>
  );
}
