import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { get, post, getToken, setToken, setUnauthorizedHandler } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!getToken()) { setReady(true); return; }
    get('/auth/me')
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setReady(true));
  }, [logout]);

  const login = async (email, password) => {
    const { token, user: u } = await post('/auth/login', { email, password });
    setToken(token);
    setUser(u);
    return u;
  };

  const isStaff = user?.role === 'admin' || user?.role === 'operator';
  return (
    <AuthContext.Provider value={{ user, ready, login, logout, isStaff, isAdmin: user?.role === 'admin' }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
