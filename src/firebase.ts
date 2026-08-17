import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Safe Firestore initialization with fallback
export const db = (() => {
  try {
    if (firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)') {
      return getFirestore(app, firebaseConfig.firestoreDatabaseId);
    }
    return getFirestore(app);
  } catch (e) {
    console.warn('Custom database ID fallback to default Firestore:', e);
    return getFirestore(app);
  }
})();

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const loginWithGoogle = async () => {
  const result = await signInWithPopup(auth, googleProvider);
  
  // Non-blocking Firestore user metadata sync
  if (result.user) {
    try {
      const userRef = doc(db, 'users', result.user.uid);
      await setDoc(userRef, {
        uid: result.user.uid,
        email: result.user.email,
        lastLogin: new Date().toISOString()
      }, { merge: true });
    } catch (err) {
      console.warn('Optional Firestore profile sync note:', err);
    }
  }

  return result.user;
};

export const logout = () => signOut(auth);

