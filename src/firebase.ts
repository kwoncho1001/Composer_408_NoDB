import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, Auth } from 'firebase/auth';
import { getFirestore, getDocFromServer, doc, Firestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;

const isFirebaseConfigured = firebaseConfig && 
  firebaseConfig.apiKey && 
  firebaseConfig.apiKey !== 'remixed-api-key' &&
  firebaseConfig.projectId &&
  firebaseConfig.projectId !== 'remixed-project-id';

if (isFirebaseConfigured) {
  try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
    auth = getAuth(app);
    
    // Validate Connection to Firestore
    const testConnection = async () => {
      if (!db) return;
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
        console.log("Firebase connection successful.");
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. The client is offline.");
        } else {
          // If we get a permission denied error, it means we successfully reached the server
          console.log("Firebase connection successful (reached server).");
        }
      }
    };
    testConnection();
  } catch (error) {
    console.error("Failed to initialize Firebase:", error);
  }
} else {
  console.warn("Firebase is not configured. Running in local-only mode.");
}

export { db, auth };

let isSigningIn = false;

export const signInWithGoogle = async () => {
  if (!auth) {
    console.error("Firebase Auth is not initialized.");
    return;
  }
  if (isSigningIn) return;
  isSigningIn = true;
  
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(auth, provider);
  } catch (error: any) {
    // Ignore cancelled-popup-request as it's often a side effect of rapid clicks or environment issues
    if (error.code !== 'auth/cancelled-popup-request' && error.code !== 'auth/popup-closed-by-user') {
      console.error("Error signing in with Google", error);
    }
  } finally {
    isSigningIn = false;
  }
};

export const logout = async () => {
  if (!auth) return;
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Error signing out", error);
  }
};
