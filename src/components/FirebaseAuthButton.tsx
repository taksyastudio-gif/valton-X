import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import { LogIn, LogOut } from 'lucide-react';
import { useEffect, useState, type FC } from 'react';

import {
  firebaseAuth,
  googleProvider,
  isFirebaseConfigured,
} from '../lib/firebase';

const getAuthErrorMessage = (error: unknown): string => {
  const code =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
      ? error.code
      : '';

  if (code === 'auth/popup-closed-by-user') {
    return '';
  }

  if (code === 'auth/popup-blocked') {
    return 'Your browser blocked the sign-in popup. Allow popups and try again.';
  }

  if (code === 'auth/unauthorized-domain') {
    return 'This website is not authorized in Firebase Authentication.';
  }

  return 'Authentication could not be completed. Please try again.';
};

export const FirebaseAuthButton: FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!firebaseAuth) {
      return undefined;
    }

    const unsubscribe = onAuthStateChanged(firebaseAuth, setUser);

    void getRedirectResult(firebaseAuth).catch((authError: unknown) => {
      setError(getAuthErrorMessage(authError));
    });

    return unsubscribe;
  }, []);

  const handleAuth = async (): Promise<void> => {
    if (!firebaseAuth) {
      return;
    }

    setIsBusy(true);
    setError('');

    try {
      if (user) {
        await signOut(firebaseAuth);
      } else {
        await signInWithRedirect(firebaseAuth, googleProvider);
      }
    } catch (authError) {
      setError(getAuthErrorMessage(authError));
    } finally {
      setIsBusy(false);
    }
  };

  if (!isFirebaseConfigured) {
    return null;
  }

  const label = user
    ? user.displayName ?? user.email ?? 'Account'
    : 'Sign in';

  return (
    <div className="relative">
      <button
        aria-label={user ? 'Sign out of Valton X' : 'Sign in with Google'}
        className="secondary-action flex max-w-40 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium sm:px-3"
        disabled={isBusy}
        onClick={() => void handleAuth()}
        title={user ? 'Sign out' : 'Sign in with Google'}
        type="button"
      >
        {user ? (
          <LogOut aria-hidden="true" size={13} />
        ) : (
          <LogIn aria-hidden="true" size={13} />
        )}
        <span className="max-w-24 truncate sm:max-w-32">
          {isBusy ? 'Working...' : label}
        </span>
      </button>

      {error ? (
        <p
          aria-live="polite"
          className="absolute right-0 top-full z-40 mt-2 w-64 rounded-md border border-red-500/40 bg-surface p-2 text-[11px] text-red-300 shadow-lg"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
};

export default FirebaseAuthButton;
