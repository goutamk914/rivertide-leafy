import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { errorMessage, invoke } from '../../../lib/ipc';
import { navigate } from '../../../lib/router';
import { Button, cx, toast } from '../../../ui/components';
import { useCalm } from '../../app-context';
import { useIpcQuery, useNow } from '../../hooks/useIpc';
import { Page, PageError, type PageComponentProps } from '../../shell/Page';
import { useSettings } from '../../state/settings-store';
import { ChatSessions } from './ChatSessions';
import { ChatThread } from './ChatThread';
import { Composer } from './Composer';
import { useChat } from './useChat';
import './chat.css';

export const SAFETY_NOTE = 'Leafy isn’t a doctor. Check medical decisions with your care team.';

export function ChatPage({ route }: PageComponentProps) {
  const calm = useCalm();
  const now = useNow();
  const settings = useSettings();
  const sessions = useIpcQuery(() => invoke('chat:list', undefined), [], ['chats']);
  const currentId = route.section ?? sessions.data?.[0]?.id ?? null;
  const chat = useChat(currentId);
  const [creating, setCreating] = useState(false);
  const [firstMessage, setFirstMessage] = useState<string | null>(null);

  const create = async (): Promise<string | null> => {
    setCreating(true);
    try {
      const session = await invoke('chat:create', undefined);
      navigate(`/chat/${session.id}`);
      return session.id;
    } catch (error) {
      toast.error(`A new chat couldn’t be started. ${errorMessage(error)}`);
      return null;
    } finally {
      setCreating(false);
    }
  };

  // A message typed before any chat existed is sent once its new chat has loaded.
  useEffect(() => {
    if (!firstMessage || !currentId || chat.session?.id !== currentId) return;
    setFirstMessage(null);
    void chat.send(firstMessage);
  }, [firstMessage, currentId, chat]);

  const send = async (text: string): Promise<boolean> => {
    if (currentId) return chat.send(text);
    const id = await create();
    if (id) setFirstMessage(text);
    return id !== null;
  };

  const busy = chat.stream !== null && chat.stream.status !== 'error';
  return (
    <Page
      title="Chat"
      layout="split"
      actions={calm ? <Button icon={Plus} loading={creating} onClick={() => void create()}>New chat</Button> : undefined}
    >
      {sessions.error ? <PageError message={sessions.error} onRetry={sessions.reload} /> : (
        <div className={cx('chat', calm && 'chat--calm')}>
          {calm ? null : (
            <ChatSessions
              sessions={sessions.data}
              currentId={currentId}
              creating={creating}
              now={now}
              onCreate={() => void create()}
              onDeleted={(id) => id === currentId && navigate('/chat', { replace: true })}
            />
          )}
          <section className="chat-main" aria-label={chat.session?.title ?? 'Conversation'}>
            {chat.error ? <div style={{ padding: 24 }}><PageError message={chat.error} onRetry={chat.reload} /></div> : (
              <ChatThread
                messages={chat.session?.messages}
                loading={chat.loading && currentId !== null}
                stream={chat.stream}
                lastReply={chat.lastReply}
                onStarter={(text) => void send(text)}
                onRetry={chat.retry}
              />
            )}
            <div className="chat-composer-wrap">
              <Composer onSend={send} busy={busy || creating || sessions.loading} useFn={settings.hotkeys.useFn} />
              <p className="chat-safety">{SAFETY_NOTE}</p>
            </div>
          </section>
        </div>
      )}
    </Page>
  );
}
