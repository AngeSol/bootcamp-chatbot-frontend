// Thin typed wrappers around the FastAPI backend (proxied under /api by Vite).

export type Role = 'user' | 'assistant' | 'system-notification' | 'note'

export interface ConversationSummary {
  id: number
  created_at: string
  preview: string | null
}

export interface Message {
  seq: number
  role: Role
  content: string
  created_at: string
}

export interface Usage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

export interface ModelsResult {
  models: string[]
  default: string
}

// FastAPI errors look like {"detail": "..."}.
async function errorFrom(response: Response): Promise<Error> {
  const body = await response.json().catch(() => null)
  const detail = typeof body?.detail === 'string' ? body.detail : null
  return new Error(detail ?? `Erreur ${response.status}`)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
  } catch {
    throw new Error('Impossible de joindre le serveur.')
  }
  if (!response.ok) throw await errorFrom(response)
  return response.json() as Promise<T>
}

export function listConversations(): Promise<ConversationSummary[]> {
  return request('/conversations')
}

export async function createConversation(): Promise<number> {
  const { conversation_id } = await request<{ conversation_id: number }>('/conversations', {
    method: 'POST',
  })
  return conversation_id
}

export function getMessages(conversationId: number): Promise<Message[]> {
  return request(`/conversations/${conversationId}/messages`)
}

export function listModels(): Promise<ModelsResult> {
  return request('/models')
}

// A note is stored like any message but never sent to the LLM.
export function addNote(conversationId: number, content: string): Promise<Message> {
  return request(`/conversations/${conversationId}/notes`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  })
}

export interface StreamResult {
  notification: string | null // set when the backend also stored a system-notification
  usage: Usage | null
}

// Streams the answer: one JSON event per line, read with fetch + response.body.getReader().
// (EventSource can't do POST.) Resolves once the backend confirmed the turn is saved.
export async function streamChat(
  conversationId: number,
  message: string,
  model: string,
  signal: AbortSignal,
  onDelta: (text: string) => void,
): Promise<StreamResult> {
  let response: Response
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: conversationId, message, model }),
      signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new Error('Impossible de joindre le serveur.')
  }
  if (!response.ok) throw await errorFrom(response)
  if (!response.body) throw new Error('Le navigateur ne supporte pas le streaming.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result: StreamResult | null = null

  function handleLine(line: string) {
    if (!line.trim()) return
    const evt = JSON.parse(line)
    if (evt.type === 'delta') onDelta(evt.content)
    else if (evt.type === 'done') result = { notification: evt.notification ?? null, usage: evt.usage ?? null }
    else if (evt.type === 'error') throw new Error(evt.detail)
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? '' // keep the incomplete last line for the next chunk
    lines.forEach(handleLine)
  }
  handleLine(buffer)

  // No "done" event: the connection was cut, the backend saved nothing.
  if (!result) throw new Error('La réponse a été interrompue.')
  return result
}
