import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { SignedIn, SignedOut, SignInButton, UserButton } from '@clerk/clerk-react';
import Intro from './pages/Intro';
import Prompt from './pages/Prompt';
import Load from './pages/Load';
import Feedback from './pages/Feedback';
import Story from './pages/Story';
import SignInPage from './pages/SignIn';
import SignUpPage from './pages/SignUp';
import Login from './pages/Login';
import Register from './pages/Register';
import SignUpOptions from './pages/SignUpOptions';
import './App.css';

export default function App() {
  return (
    <BrowserRouter>
      <header className="app-header">
        <SignedOut>
          <SignInButton mode="modal">
            <button className="header-btn">
              <i className="fa-solid fa-user"></i> Sign In
            </button>
          </SignInButton>
        </SignedOut>
        <SignedIn>
          <UserButton />
        </SignedIn>
      </header>
      
      <Routes>
        <Route path="/" element={<Intro />} />
        <Route path="/prompt" element={<Prompt />} />
        <Route path="/load" element={<Load />} />
        <Route path="/story" element={<Story />} />
        <Route path="/feedback" element={<Feedback />} />
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/sign-up" element={<SignUpPage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/sign-up-options" element={<SignUpOptions />} />
      </Routes>
    </BrowserRouter>
  );
}
