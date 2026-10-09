import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import Markdown from 'react-markdown'
import type { Role, Usage } from '../api'

export interface ChatMessage {
  role: Role
  content: string
  usage?: Usage
}

interface ChatWindowProps {
  messages: ChatMessage[]
  loading: boolean
  draft: string
  onDraftChange: (value: string) => void
  onSend: () => void
  onAddNote: () => void
  onStop: () => void
  models: string[]
  model: string
  onModelChange: (model: string) => void
}

type Mode = 'message' | 'note'

export default function ChatWindow({
  messages,
  loading,
  draft,
  onDraftChange,
  onSend,
  onAddNote,
  onStop,
  models,
  model,
  onModelChange,
}: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<Mode>('message')

  // Keep the latest message in view (no smooth animation while text is streaming in).
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: loading ? 'auto' : 'smooth' })
  }, [messages, loading])

  function submit() {
    if (loading || !draft.trim()) return
    if (mode === 'note') onAddNote()
    else onSend()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter inserts a new line.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <section className="chat">
      <div className="messages">
        {messages.length === 0 && !loading && (
          <p className="muted center">Pose ta première question à Study Buddy.</p>
        )}
        {messages.map((m, i) => {
          if (m.role === 'system-notification') {
            return (
              <div key={i} className="notification">
                {m.content}
              </div>
            )
          }
          if (m.role === 'note') {
            return (
              <div key={i} className="bubble note">
                <span className="note-label">Note personnelle, jamais envoyée à l'IA</span>
                {m.content}
              </div>
            )
          }
          return (
            <div key={i} className={`bubble ${m.role}${m.content ? '' : ' typing'}`}>
              {/* The LLM answers in Markdown; user messages are shown as typed. */}
              {m.role === 'assistant' ? (
                m.content ? <Markdown>{m.content}</Markdown> : '…'
              ) : (
                m.content
              )}
              {m.usage?.total_tokens != null && (
                <div className="usage">
                  {m.usage.total_tokens} tokens ({m.usage.prompt_tokens ?? '?'} envoyés +{' '}
                  {m.usage.completion_tokens ?? '?'} générés)
                </div>
              )}
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="composer-tools">
          <div className="mode-toggle" role="group" aria-label="Type de message">
            <button
              type="button"
              className={mode === 'message' ? 'active' : ''}
              onClick={() => setMode('message')}
              disabled={loading}
            >
              Question
            </button>
            <button
              type="button"
              className={mode === 'note' ? 'active' : ''}
              onClick={() => setMode('note')}
              disabled={loading}
            >
              Note perso
            </button>
          </div>
          <label className="model-picker">
            <span className="muted">Modèle</span>
            <select
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              disabled={loading || models.length === 0}
            >
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="composer-row">
          <textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={mode === 'note' ? 'Écris une note pour toi…' : 'Écris ton message…'}
            rows={2}
            disabled={loading}
            autoFocus
          />
          {loading ? (
            <button type="button" className="stop" onClick={onStop}>
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!draft.trim() || (mode === 'message' && !model)}>
              {mode === 'note' ? 'Ajouter la note' : 'Envoyer'}
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
