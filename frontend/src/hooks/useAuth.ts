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

  // restore login
  useEffect(() => {
    const storedLogin = localStorage.getItem("rf_login");
    if (!storedLogin) return;

    fetch(`http://localhost:4000/api/auth/status/${storedLogin}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated) {
          setLogin(storedLogin);
          setIsAuthenticated(true);
        } else {
          localStorage.removeItem("rf_login");
        }
      })
      .catch(() => {});
  }, []);

  async function startGitHubLogin() {
    const res = await fetch("http://localhost:4000/api/auth/device/start", {
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
      const res = await fetch("http://localhost:4000/api/auth/device/poll", {
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
