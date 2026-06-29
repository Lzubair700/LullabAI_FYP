import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/Register.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default function Register() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    fullname: '',
    email: '',
    password: '',
    confirmPassword: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
    setError('');
  };

  const validateForm = () => {
    if (!formData.fullname || !formData.email || !formData.password) {
      setError('Please fill all fields.');
      return false;
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match.');
      return false;
    }

    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return false;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      setError('Please enter a valid email address.');
      return false;
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/api/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fullname: formData.fullname,
          email: formData.email,
          password: formData.password,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        alert('✅ Registration successful! Please login.');
        navigate('/sign-in');
      } else {
        setError(data.message || 'Registration failed. Please try again.');
      }
    } catch (err) {
      setError('Network error. Please check if the server is running.');
      console.error('Registration error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="register-container">
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

      <div className="register-box">
        <h2>Create Account</h2>
        
        {error && <div className="error-message">{error}</div>}
        
        <form id="registerForm" onSubmit={handleSubmit}>
          <div className="mb-3">
            <input
              type="text"
              name="fullname"
              className="form-control"
              placeholder="Full Name"
              value={formData.fullname}
              onChange={handleChange}
              required
            />
          </div>
          
          <div className="mb-3">
            <input
              type="email"
              name="email"
              className="form-control"
              placeholder="Username or Email"
              value={formData.email}
              onChange={handleChange}
              required
            />
          </div>
          
          <div className="mb-3 position-relative">
            <input
              type={showPassword ? 'text' : 'password'}
              name="password"
              className="form-control"
              placeholder="Create New Password"
              value={formData.password}
              onChange={handleChange}
              required
            />
            <i
              className={`fa ${showPassword ? 'fa-eye-slash' : 'fa-eye'} password-toggle`}
              onClick={() => setShowPassword(!showPassword)}
            />
          </div>

          <div className="mb-3 position-relative">
            <input
              type={showConfirmPassword ? 'text' : 'password'}
              name="confirmPassword"
              className="form-control"
              placeholder="Confirm Password"
              value={formData.confirmPassword}
              onChange={handleChange}
              required
            />
            <i
              className={`fa ${showConfirmPassword ? 'fa-eye-slash' : 'fa-eye'} password-toggle`}
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
            />
          </div>

          <button 
            type="submit" 
            className="register-btn"
            disabled={loading}
          >
            {loading ? 'Registering...' : 'Register'}
          </button>
        </form>

        <div className="footer-text">
          Already have an account? <a href="#" onClick={(e) => { e.preventDefault(); navigate('/sign-in'); }}>Login</a>
        </div>
      </div>
    </div>
  );
}
