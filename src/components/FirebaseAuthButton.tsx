import {
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from 'firebase/auth';
import { LogIn, LogOut, UserRound } from 'lucide-react';
import { useEffect, useState, type FC } from 'react';

import {
  configureFirebasePersistence,
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

  if (code === 'auth/operation-not-allowed') {
    return 'Google sign-in is not enabled in Firebase Authentication.';
  }

  if (code === 'auth/invalid-api-key') {
    return 'Firebase rejected the API key. Check the Vercel production value.';
  }

  if (code === 'auth/configuration-not-found') {
    return 'Firebase Auth configuration is missing or invalid.';
  }

  return code
    ? `Authentication failed (${code}). Check the Firebase and Vercel configuration.`
    : 'Authentication could not be completed. Please try again.';
};

export const FirebaseAuthButton: FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!firebaseAuth) {
      return undefined;
    }

    let isMounted = true;
    let unsubscribe: (() => void) | undefined;

    void (async () => {
      try {
        await configureFirebasePersistence();
        if (!isMounted) {
          return;
        }

        unsubscribe = onAuthStateChanged(firebaseAuth, (nextUser) => {
          setUser(nextUser);
          setIsAuthReady(true);
        });

        await getRedirectResult(firebaseAuth);
        setIsAuthReady(true);
      } catch (authError: unknown) {
        if (isMounted) {
          setError(getAuthErrorMessage(authError));
          setIsAuthReady(true);
        }
      }
    })();

    return () => {
      isMounted = false;
      unsubscribe?.();
    };
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
        await configureFirebasePersistence();
        try {
          await signInWithPopup(firebaseAuth, googleProvider);
        } catch (authError: unknown) {
          const code =
            typeof authError === 'object' &&
            authError !== null &&
            'code' in authError &&
            typeof authError.code === 'string'
              ? authError.code
              : '';

          if (
            code !== 'auth/popup-blocked' &&
            code !== 'auth/popup-closed-by-user'
          ) {
            throw authError;
          }

          if (code === 'auth/popup-blocked') {
            await signInWithRedirect(firebaseAuth, googleProvider);
          }
        }
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

  return (
    <div className="relative">
      <button
        aria-label={
          user
            ? `Sign out of Valton X as ${user.displayName ?? user.email ?? 'Account'}`
            : 'Sign in with Google'
        }
        className="secondary-action flex max-w-48 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium sm:px-3"
        disabled={isBusy || !isAuthReady}
        onClick={() => void handleAuth()}
        title={
          user
            ? `Signed in as ${user.email ?? user.displayName ?? 'Account'}. Click to sign out.`
            : 'Sign in with Google'
        }
        type="button"
      >
        {user ? (
          user.photoURL ? (
            <img
              alt=""
              className="h-4 w-4 rounded-full object-cover"
              referrerPolicy="no-referrer"
              src={user.photoURL}
            />
          ) : (
            <UserRound aria-hidden="true" size={13} />
          )
        ) : (
          <LogIn aria-hidden="true" size={13} />
        )}
        <span className="max-w-24 truncate sm:max-w-32">
          {isBusy
            ? 'Working...'
            : user
              ? user.displayName ?? user.email ?? 'Profile'
              : 'Sign in'}
        </span>
        {user ? <LogOut aria-hidden="true" size={12} /> : null}
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
