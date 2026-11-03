import { useState } from "react";
import {
  ArrowRight, ArrowUpRight, Bot, Check, Command,
  Download, Laptop, Menu, Monitor, Server, ShieldCheck, Smartphone, Terminal, Code2, AppWindow,
  X, Zap,
} from "lucide-react";

type Platform = "termux" | "linux" | "macos" | "windows" | "vps";

const platforms: { id: Platform; name: string; detail: string; icon: typeof Terminal; methods: string[]; steps: string[]; commands: string[]; note: string }[] = [{"id":"termux","name":"Android / Termux","detail":"Android phones and tablets","icon": Smartphone,"methods":["Termux source build (developer preview)","Android app package (planned)"],"steps":["Install the current Termux app from a supported source.","Update packages and install Node.js LTS plus Git.","Clone the GULZ repository and install workspace dependencies.","Build and link the CLI locally, then verify the command."],"commands":["pkg update && pkg upgrade -y","pkg install nodejs-lts git","git clone https://github.com/kellysteve/gulz.git","cd gulz","npm install","npm run install:local","gulz --help"],"note":"Use a recent Termux release. The Android-native app installer is planned; this source workflow is the developer preview."},{"id":"linux","name":"Linux","detail":"Ubuntu, Debian and other distributions","icon": Terminal,"methods":["CLI source build (developer preview)","Native packages (planned)"],"steps":["Install Node.js 20.19 or newer and Git using your distribution's trusted package source.","Clone the public GULZ repository.","Install workspace dependencies and build the CLI.","Verify the CLI and run its local diagnostic."],"commands":["git clone https://github.com/kellysteve/gulz.git","cd gulz","npm install","npm run install:local","gulz --version","gulz doctor"],"note":"The source workflow is for testing and contributors. Signed .deb, .rpm, AppImage and other native packages are not published."},{"id":"macos","name":"macOS","detail":"Apple Silicon and Intel Macs","icon": Command,"methods":["CLI source build (developer preview)","Signed desktop app (planned)","Homebrew package (planned)"],"steps":["Install Node.js 20.19 or newer and Git (Homebrew is one option).","Clone the GULZ repository in Terminal.","Install dependencies and build/link the CLI.","Verify the command in a new terminal session."],"commands":["brew install node git","git clone https://github.com/kellysteve/gulz.git","cd gulz","npm install","npm run install:local","gulz --help"],"note":"The macOS desktop app and signed Apple Silicon / Intel installers are planned, not available for download."},{"id":"windows","name":"Windows","detail":"Windows 10 and 11","icon": Monitor,"methods":["PowerShell source build (developer preview)","WinGet package (planned)","Desktop installer (planned)"],"steps":["Install Node.js 20.19 or newer and Git for Windows.","Open a new PowerShell window and clone the repository.","Install workspace dependencies and build/link the CLI.","Verify the command in PowerShell."],"commands":["winget install OpenJS.NodeJS.LTS","winget install Git.Git","git clone https://github.com/kellysteve/gulz.git","cd gulz","npm install","npm run install:local","gulz --help"],"note":"Run the package-manager commands in PowerShell, then open a new terminal so PATH updates apply. Windows desktop installers are planned."},{"id":"vps","name":"VPS / Remote servers","detail":"Ubuntu, Debian and SSH-connected hosts","icon": Server,"methods":["SSH + Linux source build (developer preview)","Server package (planned)"],"steps":["Connect to the server using your own SSH account.","Install Node.js 20.19 or newer and Git.","Clone and build GULZ as your normal user; avoid running it as root.","Verify the CLI locally on the server."],"commands":["ssh your-user@your-server","git clone https://github.com/kellysteve/gulz.git","cd gulz","npm install","npm run install:local","gulz doctor"],"note":"GULZ does not connect to or configure a server automatically yet. The current CLI runs on the machine where you install it."}];

function App() {
  const [selected, setSelected] = useState<Platform>("termux");
  const [menuOpen, setMenuOpen] = useState(false);
  const active = platforms.find((item) => item.id === selected)!;

  return (
    <div className="site-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="GULZ home"><span className="brand-mark">G</span><span>GULZ</span></a>
        <nav className={menuOpen ? "nav nav-open" : "nav"}>
          <a href="#capabilities" onClick={() => setMenuOpen(false)}>Capabilities</a>
          <a href="#how-it-works" onClick={() => setMenuOpen(false)}>How it works</a>
          <a href="#install" onClick={() => setMenuOpen(false)}>Installation</a>
          <a href="#desktop" onClick={() => setMenuOpen(false)}>Desktop app</a>
          <a href="#security" onClick={() => setMenuOpen(false)}>Security</a>
        </nav>
        <a className="nav-cta" href="#install">Get started <ArrowUpRight size={15}/></a>
        <button className="menu-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu">{menuOpen ? <X/> : <Menu/>}</button>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><span className="pulse-dot"/> A NEW WAY TO GET WORK DONE</div>
            <h1>Stop managing tasks.<br/><span>Start executing goals.</span></h1>
            <p className="hero-description">Meet GULZ — an AI-assisted machine operations platform that turns what you want done into a plan, real actions and verified results.</p>
            <div className="hero-actions"><a className="button button-primary" href="#install">Explore installation <ArrowRight size={17}/></a><a className="button button-quiet" href="#how-it-works">See how it works</a></div>
            <div className="hero-note"><ShieldCheck size={15}/> You stay in control. Sensitive actions need your approval.</div>
          </div>
          <div className="terminal-card" aria-label="Illustrative GULZ terminal preview">
            <div className="terminal-head"><div className="window-dots"><i/><i/><i/></div><span>gulz — interactive session</span><span className="terminal-live">PREVIEW</span></div>
            <div className="terminal-body">
              <div className="terminal-prompt"><b>❯</b> gulz</div>
              <div className="terminal-title">Good evening. I'm GULZ.</div>
              <div className="terminal-muted">Tell me what you want to accomplish.</div>
              <div className="terminal-input">› Prepare my server for deployment<span className="cursor"/></div>
              <div className="terminal-line"><span className="ok"><Check size={13}/></span> Goal understood</div>
              <div className="terminal-line"><span className="ok"><Check size={13}/></span> Environment inspection planned</div>
              <div className="terminal-line"><span className="wait">◌</span> Awaiting execution approval</div>
              <div className="terminal-footer"><span><Bot size={13}/> GULZ AI</span><span>SUPERVISED MODE</span></div>
            </div>
          </div>
        </section>

        <section className="trust-strip"><span><Zap size={16}/> Goal-oriented execution</span><span><ShieldCheck size={16}/> Permission-aware by design</span><span><Terminal size={16}/> Local + remote environments</span></section>

        <section className="section" id="capabilities">
          <div className="section-kicker">BUILT FOR REAL WORK</div><h2>One interface. Many environments.</h2><p className="section-lead">From your phone's terminal to a remote VPS, GULZ is being designed to work where your projects and systems already live.</p>
          <div className="feature-grid">
            <article className="feature-card"><div className="feature-icon"><Command/></div><h3>Machine operations</h3><p>Inspect systems, manage files, run processes and work with development environments through authorized tools.</p></article>
            <article className="feature-card"><div className="feature-icon"><Bot/></div><h3>AI goal execution</h3><p>Turn an outcome into clear steps, coordinate real tools and verify what happened instead of pretending.</p></article>
            <article className="feature-card"><div className="feature-icon"><Server/></div><h3>Remote management</h3><p>Work with SSH-connected servers and VPS environments while keeping access scoped to your permissions.</p></article>
          </div>
        </section>

        <section className="section process-section" id="how-it-works">
          <div className="section-kicker">HOW GULZ WORKS</div><h2>From intention to verified outcome.</h2>
          <div className="process-grid">
            <div><span className="process-number">01</span><h3>Describe the goal</h3><p>Tell GULZ what you want to accomplish in plain language.</p></div>
            <div><span className="process-number">02</span><h3>Review the plan</h3><p>GULZ inspects the authorized environment and prepares an actionable plan.</p></div>
            <div><span className="process-number">03</span><h3>Approve sensitive work</h3><p>High-impact and destructive operations wait for your explicit approval.</p></div>
            <div><span className="process-number">04</span><h3>Verify the result</h3><p>Actions are checked and progress is saved so work can recover after interruptions.</p></div>
          </div>
        </section>

        <section className="install-section" id="install">
          <div className="section-kicker">INSTALLATION CENTRE</div><h2>Your device. Your way to install.</h2><p className="section-lead">Choose your environment to see the installation methods and a guided setup.</p>
          <div className="install-layout">
            <div className="platform-list" role="tablist" aria-label="Choose your platform">
              {platforms.map((platform) => { const Icon = platform.icon; return <button key={platform.id} role="tab" aria-selected={selected === platform.id} className={selected === platform.id ? "platform-option selected" : "platform-option"} onClick={() => setSelected(platform.id)}><Icon size={19}/><span><b>{platform.name}</b><small>{platform.detail}</small></span><ArrowRight size={15}/></button>; })}
            </div>
            <div className="install-detail" role="tabpanel">
              <div className="install-detail-top"><div><span className="available-label">INSTALLATION GUIDE</span><h3>{active.name}</h3><p>{active.detail}</p></div><Download size={23}/></div>
              <h4>Distribution status</h4><div className="method-list">{active.methods.map((method) => <span key={method}><Check size={14}/>{method}</span>)}</div>
              <h4>Developer preview commands</h4><pre className="install-code"><code>{active.commands.join("\n")}</code></pre><p className="install-note">{active.note}</p>
              <h4>Step-by-step setup</h4><ol className="steps-list">{active.steps.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol>
              <div className="release-notice"><ShieldCheck size={17}/><p><b>These are source-build instructions, not a stable installer.</b><br/>The CLI is in early development. Native packages and signed downloads will only be listed after platform builds and security checks pass.</p></div>
            </div>
          </div>
        </section>

        <section className="section cli-reference" id="commands">
          <div className="section-kicker">CLI QUICK REFERENCE</div><h2>What the developer-preview CLI can do today.</h2>
          <p className="section-lead">The current command line is intentionally small. File changes and diagnostic commands ask for typed approval. It is not an unrestricted shell or an AI agent yet.</p>
          <div className="command-grid">
            <article><h3><Terminal size={17}/> Start and inspect</h3><pre><code>{"gulz --help\ngulz doctor\ngulz init\ngulz goals"}</code></pre></article>
            <article><h3><Code2 size={17}/> Goals and files</h3><pre><code>{'gulz goal create "Prepare my project"\ngulz inspect .\ngulz read README.md\ngulz write notes.txt'}</code></pre></article>
            <article><h3><ShieldCheck size={17}/> Approved diagnostics</h3><pre><code>{"gulz run node --version\ngulz run git status --short\ngulz restore <backup> <target>"}</code></pre></article>
          </div>
          <div className="release-notice"><ShieldCheck size={17}/><p><b>Safety boundary:</b><br/>Only a fixed list of read-only diagnostic commands is accepted. GULZ does not yet support arbitrary shell commands, package installs, deletes, remote SSH execution or unattended AI-driven machine changes.</p></div>
        </section>

        <section className="section desktop-section" id="desktop">
          <div className="section-kicker">DESKTOP EXPERIENCE</div><h2>A native workspace is on the roadmap.</h2>
          <p className="section-lead">The planned desktop app will bring the GULZ task workspace, approvals, execution activity and local project access together in one focused interface.</p>
          <div className="desktop-grid">
            <article><AppWindow/><h3>Windows</h3><p>Desktop installer and signed updates planned.</p><span>Planned</span></article>
            <article><Laptop/><h3>macOS</h3><p>Apple Silicon and Intel builds planned.</p><span>Planned</span></article>
            <article><Monitor/><h3>Linux</h3><p>Desktop packages for supported distributions planned.</p><span>Planned</span></article>
          </div>
          <p className="desktop-footnote">The desktop application has not been released. The current developer preview is a Node.js CLI; no desktop download is available yet.</p>
        </section>
        <section className="security-section" id="security">
          <div className="security-icon"><ShieldCheck size={28}/></div><div><div className="section-kicker">CONTROL IS NOT OPTIONAL</div><h2>Autonomy, with boundaries.</h2><p>GULZ is being built around least-privilege access, clear approvals, transparent activity logs and verified outcomes. Your credentials stay yours. Sensitive actions do not happen silently.</p></div>
        </section>

        <section className="final-cta"><div><div className="section-kicker">THE BEGINNING</div><h2>Make progress, not just plans.</h2><p>GULZ is in active development. Platform downloads will appear here after they are built, tested and ready.</p></div><a className="button button-primary" href="#install">Explore installation <ArrowUpRight size={16}/></a></section>
      </main>
      <footer><a className="brand" href="#"><span className="brand-mark">G</span><span>GULZ</span></a><span>Goals. Executed.</span><span>A Gaxity product · © 2026</span></footer>
    </div>
  );
}

export default App;
