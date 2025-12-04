import { initializeApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';

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

let db: Firestore | null = null;

try {
  // Initialize Firebase
  // If imports are correct, this object creation is synchronous and should succeed.
  const app = initializeApp(firebaseConfig);
  
  // Initialize Firestore
  // This is where version mismatches usually cause a crash ("Service firestore is not available").
  db = getFirestore(app);
  console.log("Firebase initialized successfully");
} catch (error) {
  // Fallback to Live Mode (no caching)
  console.error("CRITICAL: Firebase initialization failed.", error);
  db = null;
}

export { db };