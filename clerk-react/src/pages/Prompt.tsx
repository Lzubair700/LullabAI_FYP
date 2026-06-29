import { useState } from 'react';
import { useAuth, SignInButton } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
import '../styles/Prompt.css';

export default function Prompt() {
  const { isSignedIn } = useAuth();
  const navigate = useNavigate();
  const [moral, setMoral] = useState('');
  const [duration, setDuration] = useState<number | null>(null);
  const [age, setAge] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [moralLoading, setMoralLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const handleGenerate = () => {
    if (!moral || !duration || !age) {
      setError('Please enter a moral, select a duration, and choose an age!');
      return;
    }
    setError('');
    setLoading(true);

    // Pass data to Load page for story generation
    navigate('/load', { state: { moral, duration, age } });
  };

  if (!isSignedIn) {
    return (
      <div className="prompt-container">
        <div className="auth-message">
          <h2>Please sign in to create stories</h2>
          <SignInButton />
        </div>
      </div>
    );
  }
  return (
    <div className="prompt-container">
      <div className="page-brand prompt-logo" aria-label="LullabAI">
        <span className="page-brand-main">LULLAB</span>
        <span className="page-brand-ai">AI</span>
      </div>

      <button
        type="button"
        className="prompt-feedback-btn"
        onClick={() => navigate('/feedback')}
      >
        <i className="fas fa-comment-dots"></i> Feedback
      </button>

      {error && <div className="error-message">{error}</div>}

      <div className="prompt-panel">
        <section className="prompt-block">
          <h3>WHAT MORAL SHOULD THE STORY TEACH?</h3>
          <div className="moral-input-wrap">
          <input
            type="text"
            id="moral"
            placeholder="e.g., Sharing is caring, telling the truth..."
            value={moral}
            onChange={(e) => setMoral(e.target.value)}
          />
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="moral-icon-btn wand-btn"
                aria-label="Generate moral"
                onClick={async () => {
                  try {
                    setError('');
                    setMoralLoading(true);
                    setShowSuggestions(false);
                    const resp = await fetch('/api/generate-moral', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ age })
                    });
                    if (!resp.ok) throw new Error('Failed to fetch morals');
                    const data = await resp.json();
                    const morals = (data && Array.isArray(data.morals)) ? data.morals : (data && data.moral ? [data.moral] : []);
                    if (morals.length === 0) {
                      setError('No morals generated.');
                      setSuggestions([]);
                      setShowSuggestions(false);
                    } else {
                      setSuggestions(morals);
                      setShowSuggestions(true);
                    }
                  } catch (e) {
                    console.error('Moral generation error', e);
                    setError('Could not generate moral.');
                    setSuggestions([]);
                    setShowSuggestions(false);
                  } finally {
                    setMoralLoading(false);
                  }
                }}
              >
                <i className="fa-solid fa-wand-magic-sparkles" />
                {moralLoading && <span style={{ marginLeft: 8 }}>...</span>}
              </button>

              {showSuggestions && suggestions.length > 0 && (
                <div className="moral-suggestions" role="list">
                  {suggestions.map((s, idx) => (
                    <button
                      key={s + idx}
                      type="button"
                      className="moral-suggestion-item"
                      onClick={() => {
                        setMoral(s);
                        setShowSuggestions(false);
                        setSuggestions([]);
                      }}
                    >
                      {s}
                    </button>
                  ))}
                  <div className="moral-suggestions-footer">
                    <button type="button" className="moral-suggestion-close" onClick={() => { setShowSuggestions(false); setSuggestions([]); }}>Close</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="prompt-block">
          <h3>SELECT AGE</h3>
          <div className="age-track-wrap">
            <div className="age-track">
              <div className="age-progress" style={{ width: `${(((age ?? 2) - 2) / 6) * 100}%` }} />
              <div className="rocket-indicator" style={{ left: `${(((age ?? 2) - 2) / 6) * 100}%` }}>
                <i className="fa-solid fa-rocket" />
              </div>
            </div>
            <div className="age-labels">
              {[2, 3, 4, 5, 6, 7, 8].map((a) => (
                <button
                  key={a}
                  type="button"
                  className={`age-label-btn ${age === a ? 'active' : ''}`}
                  onClick={() => setAge(a)}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="prompt-block">
          <h3>TIME DURATION</h3>
          <div className="duration-grid">
            {[
              { sec: 20, emoji: '🐰', label: 'Short', meta: '(20 secs)' },
              { sec: 30, emoji: '🐶', label: 'Medium', meta: '(30 secs)' },
              { sec: 40, emoji: '🦉', label: 'Bedtime', meta: '(40 secs)' }
            ].map((item) => (
              <button
                type="button"
                key={item.sec}
                className={`duration-card ${duration === item.sec ? 'active' : ''}`}
                onClick={() => setDuration(item.sec)}
              >
                <span className="duration-emoji">{item.emoji}</span>
                <span className="duration-text">
                  <strong>{item.label}</strong> {item.meta}
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <button
        className="generate-btn"
        onClick={handleGenerate}
        disabled={loading}
      >
        {loading ? 'Loading...' : 'Generate Story'}
      </button>
    </div>
  );
}
