import { useEffect, useRef, useState } from 'react'
import './App.css'
import {
  addNote,
  createConversation,
  getMessages,
  listConversations,
  listModels,
  streamChat,
  type ConversationSummary,
  type Message,
} from './api'
import ChatWindow, { type ChatMessage } from './components/ChatWindow'
import Sidebar from './components/Sidebar'

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Une erreur est survenue.'
}

function toChat({ role, content }: Message): ChatMessage {
  return { role, content }
}

export default function App() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [model, setModel] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  // On startup, load the history and open the most recent conversation.
  useEffect(() => {
    listConversations()
      .then((list) => {
        setConversations(list)
        if (list.length > 0) setActiveId(list[0].id)
      })
      .catch((err) => setError(errorMessage(err)))
  }, [])

  // The allowed models come from the backend, never hardcoded here.
  useEffect(() => {
    listModels()
      .then(({ models, default: defaultModel }) => {
        setModels(models)
        setModel(defaultModel)
      })
      .catch((err) => setError(errorMessage(err)))
  }, [])

  // Load the messages whenever another conversation is opened.
  useEffect(() => {
    if (activeId === null) return
    let cancelled = false
    getMessages(activeId)
      .then((list) => {
        if (!cancelled) setMessages(list.map(toChat))
      })
      .catch((err) => !cancelled && setError(errorMessage(err)))
    return () => {
      cancelled = true
    }
  }, [activeId])

  function selectConversation(id: number) {
    if (loading || id === activeId) return
    setError(null)
    setDraft('')
    setMessages([])
    setActiveId(id)
  }

  async function handleNew() {
    if (loading) return
    setError(null)
    try {
      const id = await createConversation()
      setConversations((list) => [
        { id, created_at: new Date().toISOString(), preview: null },
        ...list,
      ])
      setDraft('')
      setMessages([])
      setActiveId(id)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function handleSend() {
    if (activeId === null || !model) return
    const text = draft.trim()
    if (!text) return
    const conversationId = activeId
    const countBefore = messages.length // what the backend holds before this turn
    const hadUserMessage = messages.some((m) => m.role === 'user')
    const controller = new AbortController()
    abortRef.current = controller

    setError(null)
    setDraft('')
    // Optimistic user message + an empty assistant bubble that fills up as the stream arrives.
    setMessages((list) => [...list, { role: 'user', content: text }, { role: 'assistant', content: '' }])
    setLoading(true)
    try {
      const { notification, usage } = await streamChat(
        conversationId,
        text,
        model,
        controller.signal,
        (chunk) =>
          setMessages((list) => {
            const copy = list.slice()
            const last = copy[copy.length - 1]
            copy[copy.length - 1] = { ...last, content: last.content + chunk }
            return copy
          }),
      )
      setMessages((list) => {
        const copy = list.slice()
        copy[copy.length - 1] = { ...copy[copy.length - 1], usage: usage ?? undefined }
        if (notification) copy.push({ role: 'system-notification', content: notification })
        return copy
      })
      // The first user message becomes the conversation's preview in the sidebar.
      if (!hadUserMessage) listConversations().then(setConversations).catch(() => {})
    } catch (err) {
      // Stop button (abort) or failure: the backend only saves a complete turn, so resync with it.
      const aborted = err instanceof DOMException && err.name === 'AbortError'
      if (!aborted) setError(errorMessage(err))
      try {
        const fresh = await getMessages(conversationId)
        setMessages(fresh.map(toChat))
        // Nothing was saved: give the text back so the user can resubmit it.
        if (fresh.length === countBefore) setDraft(text)
      } catch (syncErr) {
        setError(errorMessage(syncErr))
      }
    } finally {
      abortRef.current = null
      setLoading(false)
    }
  }

  function handleStop() {
    abortRef.current?.abort()
  }

  async function handleAddNote() {
    if (activeId === null) return
    const text = draft.trim()
    if (!text) return
    setError(null)
    try {
      const note = await addNote(activeId, text)
      setMessages((list) => [...list, toChat(note)])
      setDraft('')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={selectConversation}
        onNew={handleNew}
      />
      <main className="main">
        {error && (
          <div className="error" role="alert">
            {error}
            <button onClick={() => setError(null)} aria-label="Fermer">
              ×
            </button>
          </div>
        )}
        {activeId === null ? (
          <div className="empty">
            <p>Aucune conversation ouverte.</p>
            <button className="new-button" onClick={handleNew}>
              + Nouvelle conversation
            </button>
          </div>
        ) : (
          <ChatWindow
            messages={messages}
            loading={loading}
            draft={draft}
            onDraftChange={setDraft}
            onSend={handleSend}
            onAddNote={handleAddNote}
            onStop={handleStop}
            models={models}
            model={model}
            onModelChange={setModel}
          />
        )}
      </main>
    </div>
  )
}
