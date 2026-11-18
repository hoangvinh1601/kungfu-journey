import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from './api.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }){
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [ready, setReady] = useState(false);

  const loadProfile = useCallback(async s => {
    if(!s){ setProfile(null); return; }
    // the profile row is created by a database trigger; retry briefly right after sign-up
    for(let i = 0; i < 5; i++){
      const p = await api.getProfile(s.user.id).catch(() => null);
      if(p){ setProfile(p); return; }
      await new Promise(r => setTimeout(r, 600));
    }
    setProfile(null);
  }, []);

  useEffect(() => {
    let alive = true;
    api.getSession().then(async s => { if(!alive) return; setSession(s); await loadProfile(s); setReady(true); });
    const off = api.onAuth(async s => { setSession(s); await loadProfile(s); });
    return () => { alive = false; off && off(); };
  }, [loadProfile]);

  const value = {
    session, profile, ready, me: session?.user?.id || null,
    isMaster: !!profile?.master_verified, isAdmin: profile?.role === 'admin',
    refreshProfile: () => loadProfile(session),
    setProfile,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
