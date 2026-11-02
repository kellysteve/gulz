import { useState } from "react";
import {
  ArrowRight, ArrowUpRight, Bot, Check, Code2, Command,
  Download, Menu, Monitor, Server, ShieldCheck, Smartphone, Terminal,
  X, Zap,
} from "lucide-react";

type Platform = "termux" | "linux" | "macos" | "windows" | "vps" | "developer";

const platforms: { id: Platform; name: string; detail: string; icon: typeof Terminal; methods: string[]; steps: string[] }[] = [
  { id: "termux", name: "Android / Termux", detail: "Android phones and tablets", icon: Smartphone, methods: ["Termux package", "Standalone Android build"], steps: ["Install Termux from a supported source.", "Update Termux packages and install the required runtime.", "Install the verified GULZ Android package.", "Run gulz --version to verify the installation."] },
  { id: "linux", name: "Linux", detail: "Ubuntu, Debian and other distributions", icon: Terminal, methods: ["Standalone installer", "Package manager", "Portable binary"], steps: ["Choose the build matching your CPU architecture.", "Download the installer or package.", "Verify its published checksum and signature.", "Install for your user and verify with gulz --version."] },
  { id: "macos", name: "macOS", detail: "Apple Silicon and Intel Macs", icon: Command, methods: ["Homebrew", "Signed installer", "Standalone binary"], steps: ["Select Apple Silicon or Intel.", "Choose Homebrew or the standalone installer.", "Verify the downloaded release.", "Open a terminal and run gulz --version."] },
  { id: "windows", name: "Windows", detail: "Windows 10 and 11", icon: Monitor, methods: ["PowerShell installer", "WinGet", "Standalone executable"], steps: ["Choose the supported Windows architecture.", "Use PowerShell or your preferred package manager.", "Verify the installer before running it.", "Open a new PowerShell window and run gulz --version."] },
  { id: "vps", name: "VPS / Remote servers", detail: "Ubuntu, Debian and SSH-connected hosts", icon: Server, methods: ["SSH-assisted setup", "Linux installer", "Portable binary"], steps: ["Connect to your server using your own SSH account.", "Check the operating system and CPU architecture.", "Install GULZ as a non-root user where possible.", "Verify the installation and review its permissions."] },
  { id: "developer", name: "Developers", detail: "Node.js and development environments", icon: Code2, methods: ["npm package", "Project-local install"], steps: ["Install a supported Node.js LTS release.", "Install the published GULZ package when available.", "Run gulz --version to check the CLI.", "Read the developer documentation for integrations."] },
];

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
              <h4>Planned installation methods</h4><div className="method-list">{active.methods.map((method) => <span key={method}><Check size={14}/>{method}</span>)}</div>
              <h4>Step-by-step setup</h4><ol className="steps-list">{active.steps.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol>
              <div className="release-notice"><ShieldCheck size={17}/><p><b>Downloads are not published yet.</b><br/>We're building and testing platform-specific packages before providing live install commands. This guide currently describes the planned process.</p></div>
            </div>
          </div>
        </section>

        <section className="security-section" id="security">
          <div className="security-icon"><ShieldCheck size={28}/></div><div><div className="section-kicker">CONTROL IS NOT OPTIONAL</div><h2>Autonomy, with boundaries.</h2><p>GULZ is being built around least-privilege access, clear approvals, transparent activity logs and verified outcomes. Your credentials stay yours. Sensitive actions do not happen silently.</p></div>
        </section>

        <section className="final-cta"><div><div className="section-kicker">THE BEGINNING</div><h2>Make progress, not just plans.</h2><p>GULZ is in active development. Follow the project as its first capabilities become available.</p></div><a className="button button-primary" href="https://github.com/kellysteve/gulz" target="_blank" rel="noreferrer">Private development repo <ArrowUpRight size={16}/></a></section>
      </main>
      <footer><a className="brand" href="#"><span className="brand-mark">G</span><span>GULZ</span></a><span>Goals. Executed.</span><span>A Gaxity product · © 2026</span></footer>
    </div>
  );
}

export default App;
