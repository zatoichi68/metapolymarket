// src/components/PremiumAccessModal.tsx
import React, { useState } from 'react';
import { X, Mail, Check, Loader2, Lock } from 'lucide-react';

interface PremiumAccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const PremiumAccessModal: React.FC<PremiumAccessModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Referral code from URL (e.g., ?ref=METAPMLT)
  const referralCode = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get('ref') || params.get('referral');
      return ref || undefined;
    } catch {
      return undefined;
    }
  })();

  // Retrieve Project ID from env vars (same as firebase.ts)
  const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID || 'demo-project';
  
  // Cloud Run URLs for Firebase Functions v2 (project hash: krtdefxoka)
  const CLOUD_RUN_URLS: Record<string, string> = {
    sendPremiumVerificationCode: 'https://sendpremiumverificationcode-krtdefxoka-uc.a.run.app',
    validatePremiumCode: 'https://validatepremiumcode-krtdefxoka-uc.a.run.app',
    checkPremiumStatus: 'https://checkpremiumstatus-krtdefxoka-uc.a.run.app',
  };
  
  // Helper to determine API URL dynamically
  const getApiUrl = (funcName: string) => {
      // Force production URLs for now to allow local testing against real backend
      return CLOUD_RUN_URLS[funcName] || `https://us-central1-${PROJECT_ID}.cloudfunctions.net/${funcName}`; 
  };

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const url = getApiUrl('sendPremiumVerificationCode');
      console.log('Attempting to fetch URL:', url); // Debug log

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, referralCode }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send code');
      }

      if (data.alreadyVerified) {
        // Automatically grant access if already verified
        onSuccess();
        onClose();
      } else {
        setStep('code');
      }
    } catch (err: any) {
        console.error(err);
        setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const url = getApiUrl('validatePremiumCode');
      console.log('Attempting to fetch URL:', url); // Debug log
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, referralCode }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Invalid code');
      }

      onSuccess();
      
      // Store email for re-verification
      localStorage.setItem('metapolymarket_email', email);
      
      onClose();
    } catch (err: any) {
      setError(err.message || 'Invalid code. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="absolute inset-0 bg-black/90 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="relative p-6 bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-b border-slate-800">
            <button 
                onClick={onClose} 
                className="absolute right-4 top-4 text-slate-500 hover:text-white transition-colors"
            >
                <X size={24} />
            </button>
            <div className="flex items-center gap-3 mb-2">
                <div className="bg-amber-500/20 p-2 rounded-lg">
                    <Lock className="text-amber-500" size={24} />
                </div>
                <h2 className="text-xl font-bold text-white">Unlock Premium Access</h2>
            </div>
            <p className="text-amber-200/80 text-sm font-medium">
                Free for a limited time!
            </p>
        </div>

        <div className="p-6">
            {step === 'email' ? (
                <div className="space-y-4">
                    <p className="text-slate-400 text-sm">
                        Get instant access to <strong>Hourly Updates</strong> and exclusive AI insights. 
                        Enter your email to verify your free account.
                    </p>

                    <form onSubmit={handleSendCode} className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                Email Address
                            </label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                <input
                                    type="email"
                                    required
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="you@example.com"
                                    className="w-full bg-slate-800 border border-slate-700 text-white pl-10 pr-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all placeholder-slate-600"
                                />
                            </div>
                        </div>

                        {error && (
                            <p className="text-red-400 text-sm bg-red-400/10 p-2 rounded border border-red-400/20">
                                {error}
                            </p>
                        )}

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-bold py-3 rounded-lg transition-all shadow-lg shadow-amber-900/20 flex items-center justify-center gap-2"
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="animate-spin" size={18} />
                                    Sending Code...
                                </>
                            ) : (
                                <>
                                    Send Verification Code
                                </>
                            )}
                        </button>
                    </form>
                </div>
            ) : (
                <div className="space-y-4">
                    <p className="text-slate-400 text-sm">
                        We sent a verification code to <strong>{email}</strong>.
                        Please check your inbox (and spam folder).
                    </p>

                    <form onSubmit={handleVerifyCode} className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                Verification Code
                            </label>
                            <div className="relative">
                                <Check className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                                <input
                                    type="text"
                                    required
                                    value={code}
                                    onChange={(e) => setCode(e.target.value)}
                                    placeholder="123456"
                                    className="w-full bg-slate-800 border border-slate-700 text-white pl-10 pr-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all placeholder-slate-600 tracking-widest text-lg"
                                />
                            </div>
                        </div>

                        {error && (
                            <p className="text-red-400 text-sm bg-red-400/10 p-2 rounded border border-red-400/20">
                                {error}
                            </p>
                        )}

                        <div className="flex gap-3">
                            <button
                                type="button"
                                onClick={() => setStep('email')}
                                className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold py-3 rounded-lg transition-colors"
                            >
                                Back
                            </button>
                            <button
                                type="submit"
                                disabled={isLoading}
                                className="flex-[2] bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-bold py-3 rounded-lg transition-all shadow-lg shadow-green-900/20 flex items-center justify-center gap-2"
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 className="animate-spin" size={18} />
                                        Verifying...
                                    </>
                                ) : (
                                    <>
                                        Verify & Unlock
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
      </div>
    </div>
  );
};
