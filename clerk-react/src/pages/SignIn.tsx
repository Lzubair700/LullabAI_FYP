import { SignIn } from '@clerk/clerk-react';
import '../styles/Auth.css';

export default function SignInPage() {
  return (
    <div className="auth-container">
      <div className="page-brand" aria-label="LullabAI">
        <span className="page-brand-main">LULLAB</span>
        <span className="page-brand-ai">AI</span>
      </div>
      <SignIn 
        appearance={{
          elements: {
            rootBox: "clerk-sign-in",
            card: "clerk-card"
          }
        }}
      />
    </div>
  );
}


