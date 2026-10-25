import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getToken, post, setToken } from "./api";
import type { User } from "./types";

interface AuthState {
  user: User | null;
  hasMove: boolean;
  loading: boolean;
  signIn: (token: string, user: User) => Promise<void>;
  signOut: () => void;
  refresh: () => Promise<void>;
  startDemo: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [hasMove, setHasMove] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await api<{ user: User; has_move: boolean }>("/auth/me");
      setUser(me.user);
      setHasMove(me.has_move);
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onUnauth = () => {
      setToken(null);
      setUser(null);
    };
    window.addEventListener("handoff:unauthorized", onUnauth);
    return () => window.removeEventListener("handoff:unauthorized", onUnauth);
  }, [refresh]);

  const signIn = useCallback(
    async (token: string, u: User) => {
      setToken(token);
      qc.clear();
      setUser(u);
      await refresh();
    },
    [qc, refresh],
  );

  const signOut = useCallback(() => {
    setToken(null);
    qc.clear();
    setUser(null);
    setHasMove(false);
  }, [qc]);

  const startDemo = useCallback(async () => {
    const r = await post<{ token: string; user: User }>("/demo/reset");
    await signIn(r.token, r.user);
  }, [signIn]);

  return (
    <Ctx.Provider value={{ user, hasMove, loading, signIn, signOut, refresh, startDemo }}>{children}</Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
