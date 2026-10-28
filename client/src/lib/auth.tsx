import { createContext, useContext, useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient, getQueryFn } from "./queryClient";

type User = {
  id: number;
  email: string;
  role: string;
  displayName: string;
  teamId: number | null;
  isActive?: boolean;
};

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  sessionError: boolean;
  retrySession: () => void;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string, registrationCode: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading, isError, refetch } = useQuery<User | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const previousUser = useRef<User | null | undefined>(undefined);
  useEffect(() => {
    const previous = previousUser.current;
    const current = user ?? null;
    const accessChanged = previous?.id != null && (
      !current ||
      current.id !== previous.id ||
      current.role !== previous.role ||
      current.isActive === false
    );
    if (accessChanged) {
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "/api/auth/me" });
    }
    previousUser.current = current;
  }, [user]);

  const login = useCallback(async (email: string, password: string) => {
    await apiRequest("POST", "/api/auth/login", { email, password });
    await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
  }, []);

  const register = useCallback(async (email: string, password: string, displayName: string, registrationCode: string) => {
    await apiRequest("POST", "/api/auth/register", { email, password, displayName, registrationCode });
    await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
  }, []);

  const logout = useCallback(async () => {
    await apiRequest("POST", "/api/auth/logout");
    queryClient.clear();
    queryClient.setQueryData(["/api/auth/me"], null);
  }, []);

  return (
    <AuthContext.Provider value={{ user: user?.isActive === false ? null : user ?? null, isLoading,
      sessionError: isError && user === undefined, retrySession: () => { void refetch(); }, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
