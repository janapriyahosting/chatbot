import { create } from "zustand";

type AuthState = {
  token: string | null;
  user: { email: string; display_name: string; role: string } | null;
  setAuth: (token: string, user: AuthState["user"]) => void;
  clear: () => void;
};

const TOKEN_KEY = "cb_admin_token";
const USER_KEY = "cb_admin_user";

export const useAuth = create<AuthState>((set) => ({
  token: localStorage.getItem(TOKEN_KEY),
  user: (() => {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  })(),
  setAuth: (token, user) => {
    localStorage.setItem(TOKEN_KEY, token);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    set({ token, user });
  },
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    set({ token: null, user: null });
  },
}));
