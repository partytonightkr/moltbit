// Privy auth layer.
// If VITE_PRIVY_APP_ID is set, real Privy embedded wallets + login are used.
// If not (local dev without keys), a lightweight mock keeps the UI working.
import React, { createContext, useContext, useState } from 'react';
import { PrivyProvider, usePrivy, useWallets } from '@privy-io/react-auth';

const APP_ID = import.meta.env.VITE_PRIVY_APP_ID;

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export const shortAddr = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '');

// --- Real Privy → normalized auth context ---
function PrivyBridge({ children }) {
  const { ready, authenticated, user, login, logout, exportWallet } = usePrivy();
  const { wallets } = useWallets();
  const embedded = wallets.find((w) => w.walletClientType === 'privy') || wallets[0];
  const value = {
    ready,
    authenticated,
    login,
    logout,
    exportWallet,
    wallet: embedded || null,
    address: embedded?.address || user?.wallet?.address || null,
    email: user?.email?.address || user?.google?.email || user?.apple?.email || null,
    mock: false,
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

// --- Mock (no App ID yet) so the app still runs in dev ---
function MockProvider({ children }) {
  const [authed, setAuthed] = useState(() => localStorage.getItem('moltbit_loggedin') === '1');
  const value = {
    ready: true,
    authenticated: authed,
    login: () => { setAuthed(true); localStorage.setItem('moltbit_loggedin', '1'); },
    logout: () => { setAuthed(false); localStorage.removeItem('moltbit_loggedin'); },
    exportWallet: () => alert('Set VITE_PRIVY_APP_ID to enable real key export.'),
    wallet: null,
    address: authed ? '0x7a3F00000000000000000000000000000000aQ91' : null,
    email: authed ? 'demo@moltbit.xyz' : null,
    mock: true,
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function AuthProvider({ children }) {
  if (!APP_ID) return <MockProvider>{children}</MockProvider>;
  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        loginMethods: ['email', 'google', 'apple', 'wallet'],
        embeddedWallets: { createOnLogin: 'users-without-wallets' },
        appearance: {
          theme: 'dark',
          accentColor: '#c2f73f',
          showWalletLoginFirst: false,
        },
      }}
    >
      <PrivyBridge>{children}</PrivyBridge>
    </PrivyProvider>
  );
}
