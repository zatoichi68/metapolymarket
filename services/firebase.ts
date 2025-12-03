import { initializeApp } from 'firebase/app';
import { getFirestore, Firestore, collection, addDoc } from 'firebase/firestore';

// ⚠️ IMPORTANT: Replace this with YOUR OWN Firebase project configuration.
// Without a valid project that you own, write operations will fail with "Insufficient Permissions" or "Project Not Found".
// The configuration below is a placeholder/example.
const firebaseConfig = {
  apiKey: "AIzaSyBfJwBTc8XTNm4QmZaOmnMvNogueWxtcWY", // Replace with your API Key
  authDomain: "metapolymarket.firebaseapp.com",       // Replace with your Auth Domain
  projectId: "metapolymarket",                        // Replace with your Project ID
  storageBucket: "metapolymarket.firebasestorage.app",
  messagingSenderId: "140799832958",
  appId: "1:140799832958:web:c8e3821cfcea758182392f",
  measurementId: "G-GHW82RVCL0"
};

let db: Firestore | null = null;
let initError: any = null;

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
  initError = error;
  db = null;
}

/**
 * Helper to test if write permissions work
 */
export const testFirestoreWrite = async () => {
  if (!db) {
    const msg = initError ? String(initError) : "Unknown initialization error (check console)";
    return { 
        success: false, 
        error: `Database instance is null. Init Error: ${msg}` 
    };
  }
  try {
    const docRef = await addDoc(collection(db, "_connection_tests"), {
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      status: "ok"
    });
    console.log("Test Write Success, ID:", docRef.id);
    return { success: true, id: docRef.id };
  } catch (e: any) {
    console.error("Test Write Failed:", e);
    // Common errors: "Missing or insufficient permissions", "Project not found"
    return { success: false, error: e.message || String(e) };
  }
};

export { db };