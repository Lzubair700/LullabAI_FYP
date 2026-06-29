import { useNavigate } from 'react-router-dom';
import { SignUpButton } from '@clerk/clerk-react';
import '../styles/SignUpOptions.css';

export default function SignUpOptions() {
  const navigate = useNavigate();

  return (
    <div className="signup-options-container">
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

      <div className="signup-box">
        <SignUpButton mode="modal">
          <button className="signup-btn">
            <span>Sign up with Gmail</span>
            <img 
              src="https://upload.wikimedia.org/wikipedia/commons/4/4e/Gmail_Icon.png" 
              alt="Gmail" 
            />
          </button>
        </SignUpButton>

        <SignUpButton mode="modal">
          <button className="signup-btn">
            <span>Sign up with iOS</span>
            <i className="fab fa-apple"></i>
          </button>
        </SignUpButton>

        <button 
          className="signup-btn" 
          onClick={() => navigate('/register')}
        >
          <span>Sign up with Email</span>
          <i className="fas fa-envelope"></i>
        </button>
      </div>
    </div>
  );
}




