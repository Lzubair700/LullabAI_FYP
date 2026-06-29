import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/Feedback.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function Feedback() {
  const navigate = useNavigate();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (rating === 0) {
      setError('Please select a rating.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/api/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rating, comment }),
      });

      const data = await response.json();

      if (response.ok) {
        alert('✅ Thank you for your feedback!');
        setRating(0);
        setComment('');
      } else {
        setError(data.message || 'Failed to submit feedback.');
      }
    } catch (err) {
      setError('Network error. Please try again.');
      console.error('Feedback submission error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="feedback-container">
      <div className="page-brand" aria-label="LullabAI">
        <span className="page-brand-main">LULLAB</span>
        <span className="page-brand-ai">AI</span>
      </div>

      <div className="feedback-box">
        <h2>Feedback Form</h2>
        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleSubmit}>
          <textarea
            rows={5}
            placeholder="Any suggestions or comments..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />

          <h5 className="mt-4 mb-2">How was your experience?</h5>
          <div className="stars">
            {[1, 2, 3, 4, 5].map((star) => (
              <i
                key={star}
                className={`fa-solid fa-star ${star <= rating ? 'active' : ''}`}
                onClick={() => setRating(star)}
              />
            ))}
          </div>

          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? 'Submitting...' : 'Submit Feedback'}
          </button>
        </form>

        <a href="#" onClick={(e) => { e.preventDefault(); navigate('/'); }} className="back-link">
          ← Back to Home
        </a>
      </div>
    </div>
  );
}

