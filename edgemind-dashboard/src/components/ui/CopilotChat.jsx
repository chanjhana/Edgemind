import { useState, useRef, useEffect } from 'react'

export default function CopilotChat() {
  const [isOpen, setIsOpen] = useState(false)
  const [showHistoryPanel, setShowHistoryPanel] = useState(false)
  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem('edgemind_copilot_chat')
      return saved ? JSON.parse(saved) : [
        {
          role: 'assistant',
          content: "Hello! I am your EdgeMind AI Copilot. How can I assist you today?"
        }
      ]
    } catch {
      return [
        {
          role: 'assistant',
          content: "Hello! I am your EdgeMind AI Copilot. How can I assist you today?"
        }
      ]
    }
  })
  const [archives, setArchives] = useState(() => {
    try {
      const saved = localStorage.getItem('edgemind_copilot_chat_archives')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef(null)

  // Persist messages to localStorage on every update
  useEffect(() => {
    try {
      localStorage.setItem('edgemind_copilot_chat', JSON.stringify(messages))
    } catch (err) {
      // Fail silently if storage quota exceeded or in private mode
    }
  }, [messages])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  async function handleSend(text) {
    if (!text.trim() || loading) return

    const newMessages = [...messages, { role: 'user', content: text }]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    // Build history matching the backend expectation (excluding system prompts)
    const history = newMessages
      .slice(1) // skip the initial system greeting
      .map(msg => ({ role: msg.role, content: msg.content }))

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history })
      })

      if (!res.ok) {
        throw new Error('Server responded with an error')
      }

      const data = await res.json()
      setMessages(prev => [...prev, { role: 'assistant', content: data.response }])
    } catch (err) {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: `Sorry, I couldn't reach the Copilot backend service: ${err.message}` }
      ])
    } finally {
      setLoading(false)
    }
  }

  function handleClear() {
    // Only archive if there is at least one user message
    const hasUserMessage = messages.some(msg => msg.role === 'user')
    if (hasUserMessage) {
      const firstUserMsg = messages.find(msg => msg.role === 'user')?.content || 'Saved Chat'
      const title = firstUserMsg.length > 28 ? firstUserMsg.substring(0, 28) + '...' : firstUserMsg
      const timestamp = new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      const newArchive = {
        id: Date.now().toString(),
        title,
        timestamp,
        messages
      }
      const updatedArchives = [newArchive, ...archives]
      setArchives(updatedArchives)
      try {
        localStorage.setItem('edgemind_copilot_chat_archives', JSON.stringify(updatedArchives))
      } catch {}
    }

    const defaultMessages = [
      {
        role: 'assistant',
        content: "Hello! I am your EdgeMind AI Copilot. How can I assist you today?"
      }
    ]
    setMessages(defaultMessages)
    try {
      localStorage.setItem('edgemind_copilot_chat', JSON.stringify(defaultMessages))
    } catch {}
  }

  function handleLoadArchive(archive) {
    setMessages(archive.messages)
    setShowHistoryPanel(false)
    try {
      localStorage.setItem('edgemind_copilot_chat', JSON.stringify(archive.messages))
    } catch {}
  }

  function handleDeleteArchive(id) {
    const updatedArchives = archives.filter(a => a.id !== id)
    setArchives(updatedArchives)
    try {
      localStorage.setItem('edgemind_copilot_chat_archives', JSON.stringify(updatedArchives))
    } catch {}
  }

  const renderMessageContent = (content) => {
    if (!content) return null

    const lines = content.split('\n')
    return lines.map((line, lineIdx) => {
      let isBullet = false
      let lineText = line

      if (line.trim().startsWith('* ') || line.trim().startsWith('- ')) {
        isBullet = true
        lineText = line.trim().substring(2)
      }

      let headingLevel = 0
      if (line.trim().startsWith('### ')) {
        headingLevel = 3
        lineText = line.trim().substring(4)
      } else if (line.trim().startsWith('## ')) {
        headingLevel = 2
        lineText = line.trim().substring(3)
      } else if (line.trim().startsWith('# ')) {
        headingLevel = 1
        lineText = line.trim().substring(2)
      }

      const parts = []
      const regex = /(\*\*.*?\*\*|`.*?`)/g
      const matches = lineText.match(regex)

      if (matches) {
        let lastIndex = 0
        lineText.replace(regex, (match, p1, offset) => {
          if (offset > lastIndex) {
            parts.push(lineText.substring(lastIndex, offset))
          }
          if (match.startsWith('**') && match.endsWith('**')) {
            parts.push(
              <strong key={offset} style={{ fontWeight: '700', color: 'inherit' }}>
                {match.slice(2, -2)}
              </strong>
            )
          } else if (match.startsWith('`') && match.endsWith('`')) {
            parts.push(
              <code key={offset} style={{
                fontFamily: 'monospace',
                backgroundColor: 'rgba(0, 0, 0, 0.05)',
                padding: '2px 4px',
                borderRadius: '4px',
                fontSize: '11px',
                border: '1px solid rgba(0, 0, 0, 0.1)',
                color: 'var(--color-danger-text)'
              }}>
                {match.slice(1, -1)}
              </code>
            )
          }
          lastIndex = offset + match.length
          return match
        })
        if (lastIndex < lineText.length) {
          parts.push(lineText.substring(lastIndex))
        }
      } else {
        parts.push(lineText)
      }

      if (headingLevel > 0) {
        const headingStyle = {
          fontWeight: '700',
          marginTop: '10px',
          marginBottom: '4px',
          fontSize: headingLevel === 1 ? '14px' : headingLevel === 2 ? '13px' : '12px',
          lineHeight: '1.4'
        }
        if (headingLevel === 1) return <h4 key={lineIdx} style={headingStyle}>{parts}</h4>
        if (headingLevel === 2) return <h5 key={lineIdx} style={headingStyle}>{parts}</h5>
        return <h6 key={lineIdx} style={headingStyle}>{parts}</h6>
      }

      if (isBullet) {
        return (
          <div key={lineIdx} style={{ display: 'flex', gap: '6px', margin: '4px 0 4px 8px' }}>
            <span style={{ color: 'var(--color-danger)', fontWeight: 'bold' }}>•</span>
            <span style={{ flex: 1 }}>{parts}</span>
          </div>
        )
      }

      return (
        <p key={lineIdx} style={{ margin: '0 0 6px 0', minHeight: '1.2em' }}>
          {parts}
        </p>
      )
    })
  }

  const customStyles = `
    @keyframes slideUp {
      from { transform: translateY(20px) scale(0.95); opacity: 0; }
      to { transform: translateY(0) scale(1); opacity: 1; }
    }
    @keyframes pulseRing {
      0% { box-shadow: 0 0 0 0 rgba(255, 0, 15, 0.4); }
      70% { box-shadow: 0 0 0 10px rgba(255, 0, 15, 0); }
      100% { box-shadow: 0 0 0 0 rgba(255, 0, 15, 0); }
    }
    @keyframes pulseDot {
      0%, 100% { transform: scale(0.7); opacity: 0.5; }
      50% { transform: scale(1.1); opacity: 1; }
    }
    .chat-panel-animate {
      animation: slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    .pulse-avatar {
      animation: pulseRing 2.5s infinite;
    }
    .typing-dot {
      animation: pulseDot 1.4s infinite ease-in-out;
    }
    .suggestion-chip {
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .suggestion-chip:hover {
      background: var(--color-danger-tint) !important;
      border-color: var(--color-danger) !important;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(255, 0, 15, 0.06);
    }
    .chat-send-btn {
      transition: all 0.2s;
    }
    .chat-send-btn:hover:not(:disabled) {
      background: var(--color-danger-border) !important;
      transform: scale(1.05);
    }
    .chat-header-btn {
      transition: all 0.15s;
    }
    .chat-header-btn:hover {
      background: rgba(255, 255, 255, 0.15) !important;
      color: #fff !important;
    }
    .chat-header-btn-close:hover {
      background: rgba(255, 0, 15, 0.2) !important;
      color: var(--color-danger) !important;
    }
  `

  return (
    <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, fontFamily: 'var(--font-family)' }}>
      <style>{customStyles}</style>

      {/* Floating Chat Bubble Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="pulse-avatar"
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: 'var(--color-danger)',
          color: '#fff',
          border: 'none',
          boxShadow: '0 4px 16px rgba(255, 0, 15, 0.3)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s ease-in-out',
        }}
        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05)'}
        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
        title="Ask Copilot"
      >
        {isOpen ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        )}
      </button>

      {/* Expanded Chat Overlay Panel */}
      {isOpen && (
        <div 
          className="chat-panel-animate"
          style={{
            position: 'absolute',
            bottom: 72,
            right: 0,
            width: 380,
            height: 560,
            background: 'var(--color-bg-card)',
            border: '1.5px solid var(--color-border-card)',
            borderRadius: 16,
            boxShadow: '0 12px 40px rgba(0,0,0,0.15)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            willChange: 'transform, opacity',
          }}
        >
          {/* Header Panel */}
          <div style={{
            background: '#1a1a1a',
            borderBottom: '1px solid var(--color-border-card)',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            color: '#fff'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* Bot Avatar Icon */}
              <div style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: 'var(--color-danger)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff'
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                  <line x1="12" y1="19" x2="12" y2="22"></line>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>EdgeMind Copilot</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                  <span className="animate-blink" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-success)', display: 'inline-block' }} />
                  <span style={{ fontSize: 10, color: '#aaa', fontWeight: 500 }}>Online</span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {/* History Toggle Button */}
              <button
                onClick={() => setShowHistoryPanel(!showHistoryPanel)}
                className="chat-header-btn"
                title="View history"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  background: showHistoryPanel ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
                  border: 'none',
                  color: '#bbb',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
              </button>

              {/* Clear Chat Button */}
              <button
                onClick={handleClear}
                className="chat-header-btn"
                title="Clear conversation"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  background: 'transparent',
                  border: 'none',
                  color: '#bbb',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18"></path>
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                </svg>
              </button>

              {/* Close Button */}
              <button
                onClick={() => setIsOpen(false)}
                className="chat-header-btn chat-header-btn-close"
                title="Close panel"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  background: 'transparent',
                  border: 'none',
                  color: '#bbb',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>          {showHistoryPanel ? (
            /* History Panel View */
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              padding: 16,
              background: 'var(--color-bg-card)',
              overflowY: 'auto'
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--color-text-primary)' }}>
                <span>Saved Conversations</span>
                <button
                  onClick={() => setShowHistoryPanel(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--color-danger)',
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: 600,
                    outline: 'none',
                    padding: 0
                  }}
                >
                  Back to Chat
                </button>
              </div>

              {archives.length === 0 ? (
                <div style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--color-text-tertiary)',
                  fontSize: 12,
                  textAlign: 'center',
                  padding: 24,
                  gap: 8
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                  </svg>
                  <span>No saved conversations.</span>
                  <span style={{ fontSize: 10, opacity: 0.8 }}>Clear an active session to archive it.</span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {archives.map((archive) => (
                    <div
                      key={archive.id}
                      style={{
                        border: '1px solid var(--color-border-card)',
                        borderRadius: 10,
                        padding: 12,
                        background: 'var(--color-bg-input)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12
                      }}
                    >
                      <div
                        onClick={() => handleLoadArchive(archive)}
                        style={{ flex: 1, cursor: 'pointer', overflow: 'hidden' }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {archive.title}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                          {archive.timestamp}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteArchive(archive.id)}
                        className="chat-header-btn-close"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--color-text-tertiary)',
                          cursor: 'pointer',
                          width: 24,
                          height: 24,
                          borderRadius: 6,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                        title="Delete archive"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"></polyline>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Messages Area */}
              <div
                ref={scrollRef}
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 16,
                }}
              >
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                      maxWidth: '88%',
                      flexDirection: msg.role === 'user' ? 'row-reverse' : 'row'
                    }}
                  >
                    {/* Avatar dot for bot messages */}
                    {msg.role !== 'user' && (
                      <div style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        background: 'var(--color-bg-input)',
                        border: '1px solid var(--color-border-card)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--color-danger)',
                        flexShrink: 0
                      }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="11" width="18" height="10" rx="2"></rect>
                          <circle cx="12" cy="5" r="2"></circle>
                          <path d="M12 7v4"></path>
                          <line x1="8" y1="16" x2="8" y2="16"></line>
                          <line x1="16" y1="16" x2="16" y2="16"></line>
                        </svg>
                      </div>
                    )}

                    {/* Message Bubble */}
                    <div
                      style={{
                        background: msg.role === 'user' ? 'var(--color-danger)' : 'var(--color-bg-card)',
                        color: msg.role === 'user' ? '#fff' : 'var(--color-text-secondary)',
                        border: msg.role === 'user' ? 'none' : '1px solid var(--color-border-card)',
                        padding: '10px 14px',
                        borderRadius: msg.role === 'user' ? '16px 16px 0 16px' : '0 16px 16px 16px',
                        fontSize: 12.5,
                        lineHeight: '1.5',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                      }}
                    >
                      {renderMessageContent(msg.content)}
                    </div>
                  </div>
                ))}

                {loading && (
                  <div style={{ display: 'flex', gap: 10, alignSelf: 'flex-start' }}>
                    <div style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: 'var(--color-bg-input)',
                      border: '1px solid var(--color-border-card)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--color-danger)',
                      flexShrink: 0
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="11" width="18" height="10" rx="2"></rect>
                        <circle cx="12" cy="5" r="2"></circle>
                        <path d="M12 7v4"></path>
                      </svg>
                    </div>
                    <div style={{
                      background: 'var(--color-bg-card)',
                      border: '1px solid var(--color-border-card)',
                      padding: '12px 16px',
                      borderRadius: '0 16px 16px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                    }}>
                      <span className="typing-dot" style={{ width: 5, height: 5, background: 'var(--color-text-tertiary)', borderRadius: '50%' }} />
                      <span className="typing-dot" style={{ width: 5, height: 5, background: 'var(--color-text-tertiary)', borderRadius: '50%', animationDelay: '0.2s' }} />
                      <span className="typing-dot" style={{ width: 5, height: 5, background: 'var(--color-text-tertiary)', borderRadius: '50%', animationDelay: '0.4s' }} />
                    </div>
                  </div>
                )}
              </div>

              {/* Footer Input Bar */}
              <div style={{
                padding: '12px 16px 16px 16px',
                borderTop: '1px solid var(--color-border-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'var(--color-bg-card)'
              }}>
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSend(input) }}
                  placeholder="Ask Copilot..."
                  disabled={loading}
                  style={{
                    flex: 1,
                    background: 'var(--color-bg-input)',
                    border: '1px solid var(--color-border-secondary)',
                    borderRadius: 20,
                    padding: '10px 16px',
                    fontSize: 12,
                    color: 'var(--color-text-primary)',
                    outline: 'none',
                    transition: 'border-color 0.15s',
                  }}
                  onFocus={e => e.currentTarget.style.borderColor = 'var(--color-danger)'}
                  onBlur={e => e.currentTarget.style.borderColor = 'var(--color-border-secondary)'}
                />
                <button
                  onClick={() => handleSend(input)}
                  disabled={loading || !input.trim()}
                  className="chat-send-btn"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: 'var(--color-danger)',
                    color: '#fff',
                    border: 'none',
                    cursor: (loading || !input.trim()) ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: (loading || !input.trim()) ? 0.4 : 1,
                    boxShadow: '0 2px 8px rgba(255, 0, 15, 0.2)',
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"></line>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                  </svg>
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

