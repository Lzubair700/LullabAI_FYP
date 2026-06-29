import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { SignInButton, SignUpButton, useUser } from '@clerk/clerk-react';
import '../styles/Login.css';

export default function Login() {
  const navigate = useNavigate();
  const { isSignedIn } = useUser();

  useEffect(() => {
    if (isSignedIn) navigate('/prompt');
  }, [isSignedIn, navigate]);

  return (
    <div className="login-page">
      <header>
        <button className="btn-feedback" onClick={() => navigate('/feedback')}>
          <i className="fas fa-comment-dots"></i> Feedback
        </button>
      </header>

      <div className="page-brand" aria-label="LullabAI">
        <span className="page-brand-main">LULLAB</span>
        <span className="page-brand-ai">AI</span>
      </div>

      <div className="login-container">
        <h2>Welcome</h2>

        {/* LOGIN with Clerk */}
        <SignInButton mode="modal" forceRedirectUrl="/prompt">
          <button type="button" className="btn btn-login w-100 mt-2">
            <i className="fas fa-solid fa-user"></i> Login
          </button>
        </SignInButton>

        <div className="divider-or">OR</div>

        <p className="signup-link">Don’t have an account?</p>

        {/* SIGN UP with Clerk (with Gmail option) */}
        <SignUpButton mode="modal" forceRedirectUrl="/prompt">
          <button type="button" className="btn btn-login w-100 mt-2">
            <i className="fas fa-solid fa-envelope"></i> Sign up with Gmail
          </button>
        </SignUpButton>
      </div>
    </div>
  );
}
