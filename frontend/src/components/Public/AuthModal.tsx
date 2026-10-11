import React, { useState } from 'react';
import { X, Shield, Lock, User, ArrowRight, CheckCircle2, Eye } from 'lucide-react';
import { guardian } from '../../api/guardian';
import { saveSession, type Session } from '../../api/session';
import { describeError } from '../../api/client';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: Session;
  onSignedIn: (session: Session) => void;
}

/**
 * Operator sign-in. The backend protects every mutation with OPERATOR_TOKEN;
 * the token is verified against /api/auth/whoami and kept in this tab only.
 */
export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, session, onSignedIn }) => {
  const [name, setName] = useState(session.actor);
  const [token, setToken] = useState(session.token ?? '');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Enter your name; it is recorded on every approval and activation.');
      return;
    }
    setIsLoading(true);
    const previous = { ...session };
    try {
      saveSession({ actor: name.trim(), token: token.trim() || null });
      const who = await guardian.whoami();
      if (who.authRequired && who.role !== 'operator') {
        saveSession(previous);
        setError(token.trim() ? 'The backend rejected this token. Use the OPERATOR_TOKEN configured in Hackwave/Backend/.env.' : 'An operator token is required for write access. You can still continue read-only.');
        return;
      }
      onSignedIn({ actor: name.trim(), token: token.trim() || null });
    } catch (err) {
      saveSession(previous);
      setError(describeError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const readOnly = () => {
    const s = { actor: name.trim() || 'viewer', token: null };
    saveSession(s);
    onSignedIn(s);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden relative" onClick={(e) => e.stopPropagation()}>
        <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 p-6 text-white relative">
          <button onClick={onClose} className="absolute top-5 right-5 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors text-white" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-8 h-8 rounded-lg bg-white/20 backdrop-blur-md flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <span className="text-base font-bold tracking-tight">API Guardian</span>
          </div>
          <h2 className="text-xl font-bold">Operator sign-in</h2>
          <p className="text-xs text-blue-100/90 mt-1">Your name goes on the audit trail. The operator token unlocks registrations, approvals and adapter promotion.</p>
        </div>

        <div className="p-6">
          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="auth-name">Your name</label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input id="auth-name" type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Alex Rivera" className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1" htmlFor="auth-token">Operator token (OPERATOR_TOKEN)</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input id="auth-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="paste the backend operator token" autoComplete="off" className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" />
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Stored in this browser tab only (sessionStorage), sent as a bearer header, never written to disk or code.</p>
            </div>
            {error && <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-2.5" role="alert">{error}</p>}
            <button type="submit" disabled={isLoading} className="w-full mt-2 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 shadow-md shadow-blue-500/20 transition-all disabled:opacity-60">
              {isLoading ? <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <><span>Sign in</span><ArrowRight className="w-4 h-4" /></>}
            </button>
            <button type="button" onClick={readOnly} className="w-full py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center justify-center gap-1.5">
              <Eye className="w-3.5 h-3.5" /> Continue read-only
            </button>
          </form>
          <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-center gap-1.5 text-xs text-slate-500">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            <span>Token verified against the backend before any write is allowed</span>
          </div>
        </div>
      </div>
    </div>
  );
};
