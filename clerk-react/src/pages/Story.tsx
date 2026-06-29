import { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import '../styles/Story.css';

// ── Types ──────────────────────────────────────────────────────────────────
type AgentPhase = 'idle' | 'generating-story' | 'generating-video' | 'done' | 'error';

interface AgentMessage {
  role: 'user' | 'agent';
  text: string;
}

// ── Component ──────────────────────────────────────────────────────────────
export default function Story() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const { moral, duration, age } = location.state || {};

  // ── Story / Video state
  const [story,          setStory]          = useState('');
  const [storyMoral,     setStoryMoral]     = useState(moral || '');
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState('');
  const [videoUrl,       setVideoUrl]       = useState<string | null>(null);
  const [videoGenerating,setVideoGenerating]= useState(false);
  const [videoError,     setVideoError]     = useState('');
  const [currentStoryId, setCurrentStoryId] = useState<string | null>(null);

  // ── Agent state
  const [agentOpen,      setAgentOpen]      = useState(false);
  const [agentInput,     setAgentInput]     = useState('');
  const [agentPhase,     setAgentPhase]     = useState<AgentPhase>('idle');
  const [agentError,     setAgentError]     = useState('');
  const [agentMessages,  setAgentMessages]  = useState<AgentMessage[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Scroll chat to bottom whenever messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agentMessages, agentPhase]);

  // ── Initial story fetch ────────────────────────────────────────────────
  useEffect(() => {
    if (!moral || !duration || !age) {
      navigate('/prompt');
      return;
    }

    let isMounted = true;
    const timeoutId = setTimeout(async () => {
      if (!isMounted) return;
      try {
        setLoading(true);
        setError('');

        const response = await fetch(
          `/api/get-story?moral=${encodeURIComponent(moral)}&duration=${duration}&age=${age}`
        );

        if (!response.ok) {
          let errorText = 'Failed to fetch story';
          try {
            const body = await response.text();
            try { const p = JSON.parse(body); if (p?.error) errorText = p.error; } catch { /* raw */ }
          } catch { /* ignore */ }
          throw new Error(errorText);
        }

        const data = await response.json();
        const storyText = typeof data.story === 'object' ? data.story.content : data.story;
        setStory(storyText || '');

        if (data.moral) setStoryMoral(data.moral);
        else if (typeof data.story === 'object' && data.story.moral) setStoryMoral(data.story.moral);

        const rootId   = data.storyId || data.story_id;
        const nestedId = typeof data.story === 'object' ? (data.story.storyId || data.story.story_id) : null;
        const id       = rootId || nestedId;

        if (id) {
          setCurrentStoryId(id);
          generateVideo(id);
        } else {
          setError(`No video ID returned. Server response: ${JSON.stringify(data)}`);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }, 100);

    return () => { isMounted = false; clearTimeout(timeoutId); };
  }, [moral, duration, age, navigate]);

  // ── Generate video ─────────────────────────────────────────────────────
  const generateVideo = async (storyId: string) => {
    setVideoGenerating(true);
    setVideoError('');
    setVideoUrl(null);
    try {
      const res = await fetch('/api/generate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId }),
      });
      if (!res.ok) throw new Error('Failed to generate video');
      const data = await res.json();
      if (data.success && data.videoUrl) {
        setVideoUrl(data.videoUrl);
        setCurrentStoryId(storyId);
      } else {
        throw new Error(data.error || 'Video generation failed');
      }
    } catch (err: any) {
      setVideoError(err.message || 'Error generating video');
    } finally {
      setVideoGenerating(false);
    }
  };

  // ── Agent: submit personalization ──────────────────────────────────────
  const handleAgentSubmit = async () => {
    const trimmed = agentInput.trim();
    if (!trimmed || agentPhase !== 'idle') return;

    // Add user message to chat history
    setAgentMessages(prev => [...prev, { role: 'user', text: trimmed }]);
    setAgentInput('');
    setAgentError('');

    // ── Phase 1: Regenerate Story
    setAgentPhase('generating-story');
    setAgentMessages(prev => [...prev, { role: 'agent', text: '✨ Got it! Writing your personalized story...' }]);

    try {
      const storyRes = await fetch('/api/agent-personalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userRequest: trimmed,
          moral,
          age,
          duration,
        }),
      });

      if (!storyRes.ok) {
        const errData = await storyRes.json().catch(() => ({}));
        throw new Error(errData.error || 'Story personalization failed');
      }

      const storyData = await storyRes.json();
      const newStory   = storyData.story;
      const newStoryId = storyData.newStoryId;

      setStory(newStory);
      setAgentMessages(prev => [
        ...prev.slice(0, -1), // remove typing indicator
        { role: 'agent', text: '📖 New story written! Now generating your new video...' },
      ]);

      // ── Phase 2: Regenerate Video
      setAgentPhase('generating-video');
      setVideoUrl(null);
      setVideoGenerating(true);

      const videoRes = await fetch('/api/generate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storyId: newStoryId }),
      });

      if (!videoRes.ok) throw new Error('Video generation failed');
      const videoData = await videoRes.json();

      if (videoData.success && videoData.videoUrl) {
        setVideoUrl(videoData.videoUrl);
        setCurrentStoryId(newStoryId);
        setAgentMessages(prev => [
          ...prev,
          { role: 'agent', text: '🎬 Done! Your personalized video is ready below.' },
        ]);
        setAgentPhase('done');
      } else {
        throw new Error(videoData.error || 'Video URL missing');
      }
    } catch (err: any) {
      const msg = err.message || 'Something went wrong';
      setAgentError(msg);
      setAgentMessages(prev => [
        ...prev,
        { role: 'agent', text: `❌ ${msg}. Please try again.` },
      ]);
      setAgentPhase('error');
    } finally {
      setVideoGenerating(false);
      // After done/error, reset to idle so user can try again
      setTimeout(() => setAgentPhase('idle'), 1500);
    }
  };

  const handleAgentKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAgentSubmit();
    }
  };

  const isAgentBusy = agentPhase === 'generating-story' || agentPhase === 'generating-video';

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="story-page">
      {/* Brand */}
      <div className="page-brand" aria-label="LullabAI">
        <span className="page-brand-main">LULLAB</span>
        <span className="page-brand-ai">AI</span>
      </div>

      {/* Feedback button */}
      <button className="feedback-btn" onClick={() => navigate('/feedback')}>
        <i className="fas fa-comment-dots"></i> Feedback
      </button>

      {/* ── Story Card ────────────────────────────────────────── */}
      <div className="story-card">
        {storyMoral && <div className="story-moral">Moral: {storyMoral}</div>}

        {loading && <div className="loading-text">Loading your story...</div>}

        {error && !loading && (
          <div className="error-message">
            {error}
            <button onClick={() => navigate('/prompt')} className="retry-btn">Try Again</button>
          </div>
        )}

        {!loading && !error && (
          <div className="video-section">
            {/* Video generating spinner */}
            {videoGenerating && (
              <div className="video-loading">
                <i className="fas fa-spinner fa-spin"></i>
                <p>Generating your cinematic video...</p>
                <p className="video-loading-sub">Drawing scenes &amp; voiceovers — about 15–20 seconds.</p>
              </div>
            )}

            {/* Video error */}
            {videoError && (
              <div className="video-error-msg">
                <i className="fas fa-exclamation-triangle"></i> {videoError}
              </div>
            )}

            {/* Video player */}
            {videoUrl && (
              <div className="video-container">
                <video
                  controls
                  src={videoUrl}
                  autoPlay
                  className="story-video"
                  key={videoUrl}          /* remount when URL changes */
                />
                <a
                  href={videoUrl}
                  download
                  className="download-btn"
                >
                  <i className="fas fa-download"></i> Download Video
                </a>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── AI Agent Panel (only shown after video is ready) ────── */}
      {videoUrl && !loading && !error && (
        <div className="agent-wrapper">
          {/* Toggle button */}
          <button
            className={`agent-toggle-btn ${agentOpen ? 'agent-toggle-open' : ''}`}
            onClick={() => setAgentOpen(o => !o)}
            aria-expanded={agentOpen}
          >
            <span className="agent-toggle-icon">
              {agentOpen ? '✕' : '✨'}
            </span>
            <span className="agent-toggle-label">
              {agentOpen ? 'Close AI Agent' : 'Personalise with AI'}
            </span>
          </button>

          {/* Expandable panel */}
          {agentOpen && (
            <div className="agent-panel">
              {/* Header */}
              <div className="agent-header">
                <div className="agent-avatar">🤖</div>
                <div>
                  <div className="agent-title">LullabAI Story Agent</div>
                  <div className="agent-subtitle">
                    Tell me how you'd like to change the story — I'll rewrite it and generate a new video for you.
                  </div>
                </div>
              </div>

              {/* Chat history */}
              {agentMessages.length > 0 && (
                <div className="agent-chat">
                  {agentMessages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`agent-bubble ${msg.role === 'user' ? 'agent-bubble-user' : 'agent-bubble-agent'}`}
                    >
                      {msg.text}
                    </div>
                  ))}

                  {/* Typing indicator while busy */}
                  {isAgentBusy && (
                    <div className="agent-bubble agent-bubble-agent agent-typing">
                      <span></span><span></span><span></span>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              )}

              {/* Phase status bar */}
              {isAgentBusy && (
                <div className="agent-status-bar">
                  <div className={`agent-status-step ${agentPhase === 'generating-story' ? 'active' : agentPhase === 'generating-video' ? 'done-step' : ''}`}>
                    <i className="fas fa-pen-nib"></i> Writing story
                  </div>
                  <div className="agent-status-arrow">→</div>
                  <div className={`agent-status-step ${agentPhase === 'generating-video' ? 'active' : ''}`}>
                    <i className="fas fa-film"></i> Generating video
                  </div>
                </div>
              )}

              {/* Agent error */}
              {agentError && agentPhase === 'error' && (
                <div className="agent-error">{agentError}</div>
              )}

              {/* Input area */}
              <div className="agent-input-row">
                <textarea
                  className="agent-textarea"
                  rows={2}
                  placeholder='e.g. "Add a dragon and make it more adventurous" or "Set it in space"'
                  value={agentInput}
                  onChange={e => setAgentInput(e.target.value)}
                  onKeyDown={handleAgentKeyDown}
                  disabled={isAgentBusy}
                />
                <button
                  className="agent-send-btn"
                  onClick={handleAgentSubmit}
                  disabled={isAgentBusy || !agentInput.trim()}
                  title="Send"
                >
                  {isAgentBusy
                    ? <i className="fas fa-spinner fa-spin"></i>
                    : <i className="fas fa-paper-plane"></i>
                  }
                </button>
              </div>

              <p className="agent-hint">
                Press <kbd>Enter</kbd> to send &nbsp;·&nbsp; <kbd>Shift+Enter</kbd> for new line
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Back button ───────────────────────────────────────── */}
      <div className="story-actions">
        {!loading && !error && (
          <button className="btn" onClick={() => navigate('/prompt')}>
            Back to Prompt
          </button>
        )}
      </div>
    </div>
  );
}
