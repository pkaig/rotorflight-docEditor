import { useEffect, useState } from "react";

type User = {
  login: string;
  name: string;
  avatar_url: string;
};

type AuthStep = "idle" | "waiting" | "polling";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authStep, setAuthStep] = useState<AuthStep>("idle");
  const [login, setLogin] = useState<string | null>(null);
  const [userCode, setUserCode] = useState("");
  const [verificationUri, setVerificationUri] = useState("");

  // Restore login from the session cookie, not a client-asserted username —
  // the backend derives identity from req.session.login for every request,
  // so this just asks "who (if anyone) does my own session belong to?"
  // rather than "is <name-I-remembered-locally> authenticated?", which
  // would let anyone impersonate any GitHub username that had ever signed
  // in by simply writing that name into their own localStorage.
  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated && data.login) {
          setLogin(data.login);
          localStorage.setItem("rf_login", data.login);
          setIsAuthenticated(true);
        } else {
          localStorage.removeItem("rf_login");
        }
      })
      .catch(() => {});
  }, []);

  async function startGitHubLogin() {
    const res = await fetch("/api/auth/device/start", {
      method: "POST",
    });
    const data = await res.json();

    setUserCode(data.user_code);
    setVerificationUri(data.verification_uri);
    setAuthStep("polling");

    pollForAuth(data.device_code, data.interval);
  }

  async function pollForAuth(deviceCode: string, interval: number) {
    const poll = async () => {
      const res = await fetch("/api/auth/device/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_code: deviceCode }),
      });

      const data = await res.json();

      if (data.status === "ok" && data.login) {
        setLogin(data.login);
        localStorage.setItem("rf_login", data.login);
        setIsAuthenticated(true);
        setAuthStep("idle");
        return;
      }

      if (data.error === "authorization_pending") {
        setTimeout(poll, interval * 1000);
        return;
      }

      if (data.error === "slow_down") {
        setTimeout(poll, (interval + 2) * 1000);
        return;
      }
    };

    poll();
  }

  // fetch user profile when authenticated
  useEffect(() => {
    if (!login) return;

    fetch(`https://api.github.com/users/${login}`)
      .then((res) => res.json())
      .then((data) => {
        if (data && data.login) {
          setUser({
            login: data.login,
            name: data.name,
            avatar_url: data.avatar_url,
          });
        }
      })
      .catch(() => {});
  }, [login]);

  return {
    user,
    login,
    isAuthenticated,
    authStep,
    userCode,
    verificationUri,
    startGitHubLogin,
  };
}
