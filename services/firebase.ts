import { initializeApp, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getAnalytics, Analytics, logEvent, isSupported } from 'firebase/analytics';

// Configuration Firebase via variables d'environnement (sécurisé)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || ''
};

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let analytics: Analytics | null = null;

try {
  // Initialize Firebase
  app = initializeApp(firebaseConfig);
  
  // Initialize Firestore
  db = getFirestore(app);
  console.log("Firebase initialized successfully");
  
  // Initialize Analytics (only in browser environment)
  isSupported().then((supported) => {
    if (supported && app) {
      analytics = getAnalytics(app);
      console.log("Firebase Analytics initialized");
    }
  });
} catch (error) {
  console.error("CRITICAL: Firebase initialization failed.", error);
  db = null;
}

// Analytics helper functions
export const trackEvent = (eventName: string, params?: Record<string, any>) => {
  if (analytics) {
    logEvent(analytics, eventName, params);
  }
};

export const trackPageView = (pageName: string) => {
  trackEvent('page_view', { page_title: pageName });
};

export const trackPremiumSignup = (email: string) => {
  trackEvent('premium_signup', { method: 'email' });
};

export const trackMarketView = (marketId: string, marketTitle: string) => {
  trackEvent('view_market', { market_id: marketId, market_title: marketTitle });
};

export const trackBetClick = (marketId: string, marketTitle: string) => {
  trackEvent('bet_click', { market_id: marketId, market_title: marketTitle });
};

export { db, analytics };