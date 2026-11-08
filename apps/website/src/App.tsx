import { useEffect, useState } from "react";
import { createClient, type Session } from "@supabase/supabase-js";
import {
  ArrowRight, ArrowUpRight, Check, Code2,
  Command, Copy, Github, GitBranch, Laptop, LockKeyhole, Menu, Server,
  ShieldCheck, Smartphone, Terminal, X, Zap,
} from "lucide-react";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;
type AiUsage = { used: number; limit: number; remaining: number; resetsAt?: string };
type Place = {
  id: string; place_name: string; platform: string; architecture: string;
  gulz_version: string; active_provider: string | null; active_model: string | null;
  provider_status: string; status: string; last_seen_at: string;
};

type Platform = "termux" | "linux" | "macos" | "windows" | "vps";
const installCommand = "curl -fsSL https://gulz.gaxity.com.ng/install | bash";
const platforms: { id: Platform; name: string; detail: string; command: string; note: string }[] = [
  { id: "termux", name: "Android · Termux", detail: "Run GULZ on your phone", command: "pkg update && pkg install curl git nodejs-lts\ncurl -fsSL https://gulz.gaxity.com.ng/install | bash", note: "Install Termux from F-Droid or the official GitHub releases first. The current CLI runs inside Termux; it is not a native Android app." },
  { id: "linux", name: "Linux", detail: "Ubuntu, Debian and more", command: "curl -fsSL https://gulz.gaxity.com.ng/install | bash", note: "Requires Node.js 20.19+ and Git. Run as your normal user, not with sudo." },
  { id: "macos", name: "macOS", detail: "Apple Silicon and Intel", command: "curl -fsSL https://gulz.gaxity.com.ng/install | bash", note: "Requires Node.js 20.19+ and Git. Native signed desktop packages are not published yet." },
  { id: "windows", name: "Windows", detail: "PowerShell / WSL", command: "wsl --install\n# Then, inside your Linux distribution:\ncurl -fsSL https://gulz.gaxity.com.ng/install | bash", note: "The branded Bash installer runs inside WSL. A native Windows installer is not published yet." },
  { id: "vps", name: "VPS / Linux server", detail: "Install on your own server", command: "curl -fsSL https://gulz.gaxity.com.ng/install | bash", note: "Install as a non-root user. Pair the VPS from your local GULZ session after verifying its SSH host key." },
];

function App() {
  const [platform, setPlatform] = useState<Platform>("termux");
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [pairingCode, setPairingCode] = useState("");
  const [dashboardError, setDashboardError] = useState("");
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!session) { setPlaces([]); return; }
    let cancelled = false;
    setLoadingPlaces(true);
    void fetch("/api/places", { headers: { Authorization: "Bearer " + session.access_token } })
      .then(async (response) => {
        const payload = await response.json() as { places?: Place[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Could not load Places.");
        if (!cancelled) setPlaces(payload.places ?? []);
      })
      .catch((error: unknown) => { if (!cancelled) setDashboardError(error instanceof Error ? error.message : "Could not load Places."); })
      .finally(() => { if (!cancelled) setLoadingPlaces(false); });
    return () => { cancelled = true; };
  }, [session]);
  useEffect(() => {
    if (!session) { setUsage(null); return; }
    let cancelled = false;
    void fetch("/api/ai/usage", { headers: { Authorization: "Bearer " + session.access_token } })
      .then(async (response) => {
        const payload = await response.json() as AiUsage & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Could not load AI usage.");
        if (!cancelled) setUsage(payload);
      })
      .catch(() => { if (!cancelled) setUsage(null); });
    return () => { cancelled = true; };
  }, [session]);
  const signInWithGithub = async () => {
    if (!supabase) { setDashboardError("Website sign-in is not configured yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to the website build, then enable GitHub in Supabase Authentication."); return; }
    const { error } = await supabase.auth.signInWithOAuth({ provider: "github", options: { redirectTo: window.location.origin + "/dashboard" } });
    if (error) setDashboardError(error.message);
  };
  const createPairingCode = async () => {
    if (!session) return;
    setDashboardError("");
    const response = await fetch("/api/places/pair/start", { method: "POST", headers: { Authorization: "Bearer " + session.access_token } });
    const payload = await response.json() as { code?: string; error?: string };
    if (!response.ok || !payload.code) { setDashboardError(payload.error || "Could not create a pairing code."); return; }
    setPairingCode(payload.code);
  };
  const disconnectPlace = async (id: string) => {
    if (!session || !window.confirm("Disconnect this Place? Its local files will not be changed.")) return;
    const response = await fetch("/api/places/revoke", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token }, body: JSON.stringify({ id }) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) { setDashboardError(payload.error || "Could not disconnect Place."); return; }
    setPlaces((current) => current.filter((place) => place.id !== id));
  };

  const active = platforms.find((item) => item.id === platform)!;
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy this command:", value);
    }
  };

  if (window.location.pathname === "/dashboard") {
    return (
      <div className="dashboard-shell">
        <header className="dashboard-topbar">
          <a className="brand" href="/"><span className="brand-mark">G</span><span>gulz</span></a>
          <div className="dashboard-actions">
            <a href="/">Website</a>
            {session && <button onClick={() => void supabase?.auth.signOut()}>Sign out</button>}
          </div>
        </header>
        <main className="dashboard-main">
          <div className="dashboard-heading"><div><div className="eyebrow">GULZ CONTROL ROOM</div><h1>Your Places</h1><p>Manage the GULZ installations connected to your account.</p></div></div>
          {!session ? (
            <section className="dashboard-login">
              <Github size={30}/><h2>Sign in to GULZ</h2>
              <p>Use your GitHub account to manage Places. GitHub repository access is not requested for account sign-in.</p>
              <button className="button button-primary" onClick={() => void signInWithGithub()}><Github size={17}/> Continue with GitHub</button>
              {!supabase && <small>Sign-in setup required: configure the Supabase website URL and anon key, and enable the GitHub provider in Supabase Authentication.</small>}
            </section>
          ) : (
            <>
              {usage && <section className="usage-card"><div><b>GULZ AI daily allowance</b><small>Resets daily · usage shared across your account Places</small></div><strong>{usage.remaining} <span>of {usage.limit} requests left</span></strong><div className="usage-track"><i style={{ width: ((usage.used / Math.max(1, usage.limit)) * 100) + "%" }}/></div></section>}
              <section className="account-strip"><div><b>{session.user.user_metadata?.user_name || session.user.user_metadata?.preferred_username || session.user.email || "GitHub account"}</b><small>Signed in with GitHub via Supabase Auth</small></div><span>Account connected</span></section>
              <section className="places-toolbar"><div><h2>Connected installations</h2><p>Each Place is one GULZ installation on a device or server.</p></div><button className="button button-primary" onClick={() => void createPairingCode()}>Connect a Place</button></section>
              {pairingCode && <section className="pairing-panel"><div><b>Enter this code in your GULZ installer or terminal</b><p>It expires in 10 minutes and can only be used once.</p></div><strong>{pairingCode}</strong><button onClick={() => void navigator.clipboard.writeText(pairingCode)}>Copy code</button></section>}
              {dashboardError && <p className="dashboard-error">{dashboardError}</p>}
              {loadingPlaces ? <p>Loading your Places…</p> : places.length === 0 ? <section className="empty-places"><Laptop size={28}/><h3>No Places connected yet</h3><p>Connect GULZ from Termux, your computer or a VPS to see it here.</p></section> : (
                <section className="places-grid">{places.map((place) => <article className="place-card" key={place.id}>
                  <div className="place-card-top"><div><h3>{place.place_name}</h3><small>{place.platform} · {place.architecture}</small></div><span className={place.status === "online" ? "place-online" : "place-offline"}>{place.status}</span></div>
                  <div className="place-details"><span>GULZ version</span><b>{place.gulz_version}</b><span>AI provider</span><b>{place.active_provider || "Not reported"}</b><span>Active model</span><b>{place.active_model || "Not reported"}</b><span>Provider status</span><b>{place.provider_status || "Unknown"}</b><span>Last seen</span><b>{new Date(place.last_seen_at).toLocaleString()}</b></div>
                  <button className="disconnect-button" onClick={() => void disconnectPlace(place.id)}>Disconnect Place</button>
                </article>)}</section>
              )}
              <p className="dashboard-privacy"><LockKeyhole size={14}/> Provider API keys and project files stay on their Places. This dashboard displays connection metadata only.</p>
            </>
          )}
          {dashboardError && !session && <p className="dashboard-error">{dashboardError}</p>}
        </main>
      </div>
    );
  }
  return (
    <div className="site-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="GULZ home"><span className="brand-mark">G</span><span>gulz</span><span className="brand-beta">OPEN SOURCE</span></a>
        <button className="mobile-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle navigation">{menuOpen ? <X/> : <Menu/>}</button>
        <nav className={menuOpen ? "nav nav-open" : "nav"}>
          <a href="#agent" onClick={() => setMenuOpen(false)}>Agent</a>
          <a href="#workspaces" onClick={() => setMenuOpen(false)}>Workspaces</a>
          <a href="#providers" onClick={() => setMenuOpen(false)}>Models</a>
          <a href="#install" onClick={() => setMenuOpen(false)}>Install</a>
        </nav>
        {session ? <a className="github-link" href="/dashboard"><Github size={16}/> Dashboard <ArrowUpRight size={14}/></a> : <a className="github-link" href="/dashboard"><Github size={16}/> Sign in <ArrowUpRight size={14}/></a>}
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><span className="status-dot"/> OPEN-SOURCE CODING AGENT</div>
            <h1>Your terminal.<br/><span>Your code.</span><br/>Your agent.</h1>
            <p className="hero-lead">An AI coding agent that understands your project, edits files, runs commands, fixes errors and helps ship real software. Use it on your phone, computer or VPS.</p>
            <div className="hero-actions">
              <a className="button button-primary" href="#install"><Terminal size={17}/> Install GULZ <ArrowRight size={16}/></a>
              <a className="button button-secondary" href="https://github.com/kellysteve/gulz" target="_blank" rel="noreferrer"><Github size={17}/> Explore source</a>
            </div>
            <div className="hero-meta"><span><Check size={14}/> Apache 2.0</span><span><Check size={14}/> Bring your own model</span><span><Check size={14}/> Local-first</span></div>
          </div>
          <div className="agent-window">
            <div className="window-top"><div className="window-controls"><i/><i/><i/></div><span>my-project · gulz</span><span className="window-status"><span/> AGENT READY</span></div>
            <div className="window-content">
              <div className="terminal-dim">~/projects/my-project</div>
              <div className="terminal-user"><span>›</span> Find and fix the bug in my checkout flow. Run the tests afterwards.</div>
              <div className="agent-step"><span className="step-icon"><Command size={14}/></span><div><b>Inspecting project</b><small>Reading package.json, src/ and test files</small></div><Check size={15} className="step-check"/></div>
              <div className="agent-step"><span className="step-icon"><Code2 size={14}/></span><div><b>Tracing checkout logic</b><small>Found a quantity validation edge case</small></div><Check size={15} className="step-check"/></div>
              <div className="agent-step active-step"><span className="step-icon"><Terminal size={14}/></span><div><b>Preparing a code change</b><small>Review the diff before applying it</small></div><span className="step-pending">REVIEW</span></div>
              <div className="terminal-result"><span className="result-mark">✓</span><div><b>Verify the fix</b><small>Run the test suite and report what passed.</small></div></div>
              <div className="window-bottom"><span><LockKeyhole size={13}/> YOU CONTROL EXECUTION</span><span>SUPERVISED AGENT</span></div>
            </div>
          </div>
        </section>

        <div className="proof-strip"><span><Zap size={16}/> Understands real projects</span><span><GitBranch size={16}/> Git-native workflows</span><span><ShieldCheck size={16}/> Approvals for risky actions</span><span><Smartphone size={16}/> Termux-ready</span></div>

        <section className="section" id="agent">
          <div className="section-heading"><div className="eyebrow">MORE THAN CHAT</div><h2>An agent that works inside your project.</h2><p>GULZ is designed around the coding loop: understand the codebase, make a focused change, run it, learn from the result and keep going.</p></div>
          <div className="capability-grid">
            <article><span className="feature-icon"><Code2/></span><h3>Read and change code</h3><p>Explore project structure, trace how files connect, create and edit code, and review diffs with backups.</p></article>
            <article><span className="feature-icon"><Terminal/></span><h3>Run and verify</h3><p>Execute approved development commands, run tests and builds, inspect failures and iterate on fixes.</p></article>
            <article><span className="feature-icon"><GitBranch/></span><h3>Git-aware workflow</h3><p>Work with branches, commits and repository history. GitHub account linking and pull-request workflows are being built.</p></article>
            <article><span className="feature-icon"><Server/></span><h3>Local and remote</h3><p>Work in local folders or pair a VPS over SSH. Keep credentials on the machine that owns them.</p></article>
            <article><span className="feature-icon"><Zap/></span><h3>Build and deploy</h3><p>Help configure APIs, websites and services on your own infrastructure, with explicit checks before risky changes.</p></article>
            <article><span className="feature-icon"><ShieldCheck/></span><h3>Human in control</h3><p>Read-only inspection can be automatic. File changes, installs and sensitive operations require your approval.</p></article>
          </div>
        </section>

        <section className="workspace-section" id="workspaces">
          <div className="section-heading"><div className="eyebrow">LOCAL-FIRST · GITHUB-READY</div><h2>Install it where your code lives.</h2><p>Clone a repository, enter its folder and start GULZ. The agent reads and edits the local project; Git handles branches, commits and pushes. GitHub sign-in is a separate optional step for hosted AI access.</p></div>
          <div className="workspace-grid">
            <article className="workspace-card"><div className="workspace-top"><Terminal/><span className="status-label">CORE WORKFLOW</span></div><h3>Local folders</h3><p>Run GULZ from a project directory on Termux, Linux or macOS. Your files stay on your device.</p><code>cd my-project && gulz</code></article>
            <article className="workspace-card"><div className="workspace-top"><Github/><span className="status-label">GIT-NATIVE</span></div><h3>GitHub repositories</h3><p>Install GULZ inside a cloned repository and it works on that project locally. Sign in to GitHub for hosted GULZ AI access, and use your existing Git credentials to push branches and open pull requests.</p><code>git clone · cd project · gulz</code></article>
            <article className="workspace-card"><div className="workspace-top"><Server/><span className="status-label">EARLY SSH SUPPORT</span></div><h3>Your VPS</h3><p>Pair a server using OpenSSH and work inside an explicitly selected remote project folder.</p><code>gulz remote add production …</code></article>
          </div>
        </section>

        <section className="section provider-section" id="providers">
          <div className="section-heading"><div className="eyebrow">MODEL FREEDOM</div><h2>Bring the model you trust.</h2><p>GULZ stays provider-independent. The agent tools and approval system belong to GULZ, not to one model vendor.</p></div>
          <div className="provider-grid">
            <article><span className="provider-symbol">G</span><h3>GULZ AI</h3><p>Hosted GULZ AI through a request-limited Worker proxy. It becomes available when the upstream model and Supabase Worker secrets are configured.</p><span className="provider-state">DEPLOYMENT SETUP REQUIRED</span></article>
            <article><span className="provider-symbol"><Command/></span><h3>Your API key</h3><p>Configure a supported provider or OpenAI-compatible endpoint using your own credentials.</p><span className="provider-state ready">CLI CONFIGURATION AVAILABLE</span></article>
            <article><span className="provider-symbol"><Laptop/></span><h3>Local models</h3><p>Use local model servers such as Ollama or other compatible endpoints when configured.</p><span className="provider-state">COMPATIBILITY DEPENDS ON PROVIDER</span></article>
          </div>
          <p className="gateway-note"><LockKeyhole size={15}/> The hosted gateway will keep provider secrets server-side. No shared provider key will be embedded in this open-source CLI.</p>
        </section>

        <section className="install-section" id="install">
          <div className="install-heading"><div><div className="eyebrow">GET STARTED</div><h2>Install once. Start building.</h2><p>Choose where you want to run GULZ. The branded installer route is served by the GULZ website after the updated Worker is deployed and the domain is connected.</p></div><div className="install-badge"><ShieldCheck size={16}/> Open source · Apache 2.0</div></div>
          <div className="install-command"><div className="command-label"><span><span className="status-dot"/> RECOMMENDED INSTALL COMMAND</span><button onClick={() => copy(installCommand)}><Copy size={14}/>{copied ? "Copied" : "Copy"}</button></div><code>{installCommand}</code></div>
          <div className="platform-picker" role="tablist" aria-label="Choose installation platform">
            {platforms.map((item) => <button key={item.id} role="tab" aria-selected={platform === item.id} onClick={() => setPlatform(item.id)}>{item.name}</button>)}
          </div>
          <div className="platform-detail" role="tabpanel"><div><b>{active.name}</b><p>{active.detail}. {active.note}</p></div><button className="copy-platform" onClick={() => copy(active.command)}><Copy size={14}/> Copy commands</button><pre>{active.command}</pre></div>
          <p className="install-footnote">Always review an install script before running it. Source installer supports Termux, Linux, macOS and Linux VPS. Windows uses WSL. Signed native packages are not published yet.</p>
        </section>

        <section className="closing-cta"><div><div className="eyebrow">BUILT BY GAXITY</div><h2>Make the computer do the work.</h2><p>GULZ is open source. Inspect it, improve it, and build with it.</p></div><a className="button button-primary" href="https://github.com/kellysteve/gulz" target="_blank" rel="noreferrer">View GULZ on GitHub <ArrowUpRight size={16}/></a></section>
      </main>
      <footer><a className="brand" href="#"><span className="brand-mark">G</span><span>gulz</span></a><span>Goals. Executed.</span><span>A Gaxity product · Apache 2.0</span></footer>
    </div>
  );
}
export default App;
