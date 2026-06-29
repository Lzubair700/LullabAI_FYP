import { useUser } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import '../styles/Intro.css';

export default function Intro() {
  const navigate = useNavigate();
  const { isSignedIn } = useUser();

  useEffect(() => {
    if (isSignedIn) {
      navigate('/prompt');
    }
  }, [isSignedIn, navigate]);

  return (
      <div className="prompt-container">
      <div className="page-brand prompt-logo" aria-label="LullabAI">
        <span className="page-brand-main">LULLAB</span>
        <span className="page-brand-ai">AI</span>
      </div>

        <div className="main">
          <div className="left">
            <h1 className="hero-title">
              <span className="hero-line hero-line-1">Create Magical</span>
              <span className="hero-line hero-line-2">Bedtime Stories</span>
            </h1>

            <div className="cards">
              <div className="info-card">
                <div className="icon-wrap icon-wrap-search" aria-hidden="true">
                  <i className="fa-solid fa-magnifying-glass" />
                  <i className="fa-solid fa-star icon-star" />
                </div>
                <div className="card-text">
                  <div className="card-title">Choose the Moral</div>
                  <div className="card-subtitle">Select the lesson you want</div>
                </div>
              </div>

              <div className="info-card">
                <div className="icon-wrap icon-wrap-rocket" aria-hidden="true">
                  <i className="fa-solid fa-rocket" />
                </div>
                <div className="card-text">
                  <div className="card-title">Select Age &amp; Duration</div>
                  <div className="card-subtitle">Choose the age group and story length</div>
                </div>
              </div>

              <div className="info-card">
                <div className="icon-wrap icon-wrap-book" aria-hidden="true">
                  <i className="fa-solid fa-book-open" />
                  <i className="fa-solid fa-star icon-star icon-star-book" />
                </div>
                <div className="card-text">
                  <div className="card-title">Enjoy the Story</div>
                  <div className="card-subtitle">Receive and read a unique, enchanting tale.</div>
                </div>
              </div>
            </div>
          </div>

          <div className="right">
            <img src="/1.png" alt="Story illustration" className="hero-graphic" />
          </div>
        </div>
      </div>
  );
}
