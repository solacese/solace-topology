import { FormEvent, useState } from "react";
import { LockKeyhole, Network } from "lucide-react";

interface LoginPanelProps {
  onLogin: (password: string) => Promise<void>;
}

export function LoginPanel({ onLogin }: LoginPanelProps) {
  const [password, setPassword] = useState("admin");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await onLogin(password);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-panel" aria-label="Sign in">
        <div className="brand-mark">
          <Network size={30} />
          <span>Solace Topology</span>
        </div>
        <h1>Automotive event mesh map</h1>
        <p>Live Solace broker topology, application provenance, and throughput in one graph.</p>
        <form onSubmit={submit}>
          <label htmlFor="password">Admin password</label>
          <div className="password-row">
            <LockKeyhole size={18} />
            <input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </div>
          {error ? <div className="form-error">{error}</div> : null}
          <button type="submit" disabled={loading}>
            {loading ? "Connecting..." : "Open topology"}
          </button>
        </form>
      </section>
    </main>
  );
}
