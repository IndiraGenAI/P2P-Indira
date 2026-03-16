import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { apiPost, setToken, type ApiError } from '../api';

const LOGIN_TIME_KEY = 'p2p_login_time';

interface LoginProps {
  onLogin: (user: User) => void;
}

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [expiredMessage, setExpiredMessage] = useState(false);
  const [concurrentLimit, setConcurrentLimit] = useState(false);
  const [countdownSeconds, setCountdownSeconds] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('expired') === 'true') setExpiredMessage(true);
  }, []);

  useEffect(() => {
    if (countdownSeconds <= 0) return;
    const t = setInterval(() => {
      setCountdownSeconds((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [countdownSeconds]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setExpiredMessage(false);
    try {
      const data = await apiPost<{ token: string; user: User }>('login', { email, password });
      setToken(data.token);
      sessionStorage.setItem(LOGIN_TIME_KEY, Date.now().toString());
      onLogin(data.user);
    } catch (e) {
      if (e instanceof Error && (e as ApiError).code === 'CONCURRENT_LIMIT') {
        setConcurrentLimit(true);
        setCountdownSeconds(600);
      } else {
        setError(e instanceof Error ? e.message : 'Password is wrong, please type again.');
      }
    }
  };

  useEffect(() => {
    if (countdownSeconds === 0 && concurrentLimit) {
      setConcurrentLimit(false);
    }
  }, [countdownSeconds, concurrentLimit]);

  const countdownActive = countdownSeconds > 0;
  const mm = Math.floor(countdownSeconds / 60);
  const ss = countdownSeconds % 60;
  const countdownStr = `${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
      <div className="w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-500">
        <div className="p-10">
          <div className="text-center mb-10">
            <div className="w-20 h-20 bg-indigo-600 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-indigo-200">
              <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tight">Elite P2P Admin</h2>
            <p className="text-slate-400 text-xs font-black uppercase tracking-widest mt-2">Enterprise Governance Portal</p>
          </div>

          {expiredMessage && (
            <div className="mb-6 bg-indigo-50 border border-indigo-100 text-indigo-700 px-4 py-3 rounded-xl text-xs font-bold">
              Your session has expired. Please log in again.
            </div>
          )}

          {concurrentLimit && (
            <div className="mb-6 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-xl text-xs font-bold space-y-2">
              <p>Concurrent user limit reached. Only 200 users can be logged in at a time.</p>
              {countdownActive && (
                <p className="font-mono">You can retry in: {countdownStr}</p>
              )}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Email Address</label>
              <input 
                type="email" 
                required
                className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-800 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all"
                placeholder="admin@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Password</label>
              <input 
                type="password" 
                required
                className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-800 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-100 text-rose-600 px-4 py-3 rounded-xl text-xs font-bold animate-in shake duration-300">
                {error}
              </div>
            )}

            <button 
              type="submit"
              disabled={countdownActive}
              className="w-full py-5 bg-indigo-600 text-white font-black text-xs uppercase tracking-[0.3em] rounded-2xl hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Sign In to Dashboard
            </button>
          </form>

          <div className="mt-10 pt-10 border-t border-slate-50 text-center">
            <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">
              Secure Access Only • v1.0.4
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
