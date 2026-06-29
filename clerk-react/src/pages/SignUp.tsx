import { SignUp } from '@clerk/clerk-react';
import '../styles/Auth.css';

export default function SignUpPage() {
  return (
    <div className="auth-container">
      <div className="page-brand" aria-label="LullabAI">
        <span className="page-brand-main">LULLAB</span>
        <span className="page-brand-ai">AI</span>
      </div>
      <SignUp 
        appearance={{
          elements: {
            rootBox: "clerk-sign-up",
            card: "clerk-card"
          }
        }}
      />
    </div>
  );
}


