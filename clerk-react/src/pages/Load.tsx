import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import '../styles/Load.css';

export default function Load() {
  const location = useLocation();
  const navigate = useNavigate();
  const { moral, duration, age } = location.state || {};

  useEffect(() => {
    if (!moral || !duration || !age) {
      navigate('/prompt');
      return;
    }

    // Add small delay to show loading animation
    const timer = setTimeout(() => {
      navigate('/story', { state: { moral, duration, age } });
    }, 3000); // 3 seconds delay

    return () => clearTimeout(timer);
  }, [moral, duration, age, navigate]);

  return (
    <div className="load-container">
      <div className="page-brand" aria-label="LullabAI">
        <span className="page-brand-main">LULLAB</span>
        <span className="page-brand-ai">AI</span>
      </div>

      <button
        className="feedback-btn"
        onClick={() => navigate('/feedback')}
      >
        <i className="fas fa-comment-dots"></i> Feedback
      </button>

      <img src="/load.gif" className="book-animation" alt="Story Loading" />

      <div className="loader">
        <div className="dot"></div>
        <div className="dot"></div>
        <div className="dot"></div>
        <div className="dot"></div>
      </div>

      <p className="loading-text">Loading your bedtime story...</p>
    </div>
  );
}
