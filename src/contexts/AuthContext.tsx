import React, { createContext, useContext, useEffect, useState } from 'react';

interface AuthContextType {
  user: { uid: string; displayName: string; email: string; photoURL: string | null; isGuest: boolean } | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({ user: null, loading: true });

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Local-only mode: provide a guest user
    setUser({
      uid: 'local-guest',
      displayName: 'Local Guest',
      email: 'guest@local',
      photoURL: null,
      isGuest: true
    });
    setLoading(false);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
};
