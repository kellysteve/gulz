import { useState } from "react";
import {
  ArrowRight, ArrowUpRight, Bot, Check, Command, Copy,
  Download, Laptop, Menu, Monitor, Server, ShieldCheck, Smartphone, Terminal, Code2, AppWindow,
  X, Zap,
} from "lucide-react";

type Platform = "termux" | "linux" | "macos" | "windows" | "vps";

const platforms: { id: Platform; name: string; detail: string; icon: typeof Terminal; methods: string[]; steps: string[]; commands: string[]; note: string }[] = [
  {
    id: "termux", name: "Android / Termux", detail: "Android phones and tablets", icon: Smartphone,
    methods: ["Interactive Bash installer (developer preview)", "Manual CLI source build (developer preview)", "Native Android app (planned)"],
    steps: ["Install Termux from F-Droid or the official GitHub releases.","Run pkg update && pkg upgrade -y.","Install curl with pkg install curl.","Copy the Bash command above into Termux and answer the installer's questions.","After installation, run gulz."],
    commands: ["pkg update && pkg upgrade -y","pkg install curl","curl -fsSL https://raw.githubusercontent.com/kellysteve/gulz/main/scripts/install.sh | bash","gulz","gulz doctor"],
    note: "The installer asks for the install folder and confirmation. It installs only the CLI workspaces and deliberately skips Wrangler/Workerd, which is unsupported on Android/Termux. This is a source-build CLI inside Termux, not a standalone Android app.",
  },
  {
    id: "linux", name: "Linux", detail: "Ubuntu, Debian and other distributions", icon: Terminal,
    methods: ["Interactive Bash installer (developer preview)", "Manual CLI source build (developer preview)", "AppImage / .deb / .rpm packages (planned)", "Desktop app (planned)"],
    steps: ["Install Node.js 20.19+ and curl.","Optionally review scripts/install.sh in the public GitHub repository.","Run the Bash command above and answer the installer's questions.","Open a new terminal and run gulz."],
    commands: ["# Install Node.js 20.19+ and curl first","curl -fsSL https://raw.githubusercontent.com/kellysteve/gulz/main/scripts/install.sh | bash","gulz","gulz doctor"],
    note: "The installer asks for the install folder and confirmation, installs only CLI workspace dependencies, then builds and links the CLI. It skips the website tooling. Review scripts/install.sh before running it. Signed .deb, .rpm and AppImage packages are not published.",
  },
  {
    id: "macos", name: "macOS", detail: "Apple Silicon and Intel Macs", icon: Command,
    methods: ["Interactive Bash installer (developer preview)", "Manual CLI source build (developer preview)", "Signed .dmg desktop app (planned)", "Homebrew package (planned)"],
    steps: ["Install Node.js 20.19+ and Git.","Optionally review scripts/install.sh in the public GitHub repository.","Run the Bash command above and answer the installer's questions.","Open a new terminal and run gulz."],
    commands: ["brew install node git curl","curl -fsSL https://raw.githubusercontent.com/kellysteve/gulz/main/scripts/install.sh | bash","gulz","gulz doctor"],
    note: "Install Node.js 20.19+ and Git first. The interactive installer asks where to install GULZ and requests confirmation. Signed desktop .dmg installers for Apple Silicon and Intel are planned, not available for download.",
  },
  {
    id: "windows", name: "Windows", detail: "Windows 10 and 11 · PowerShell", icon: Monitor,
    methods: ["PowerShell source build (developer preview)", "WinGet CLI package (planned)", "Signed desktop installer (planned)"],
    steps: ["Install Node.js LTS and Git for Windows with WinGet.", "Close and reopen PowerShell so PATH updates apply.", "Confirm Node.js is version 20.19 or newer.", "Clone GULZ, install dependencies and link the CLI."],
    commands: ["winget install OpenJS.NodeJS.LTS", "winget install Git.Git", "# Open a new PowerShell window", "node --version", "git clone https://github.com/kellysteve/gulz.git", "cd gulz", "npm run install:cli", "gulz", "gulz --help"],
    note: "Run these commands in PowerShell. The current route builds the CLI from source; signed Windows desktop installers and WinGet publication are planned.",
  },
  {
    id: "vps", name: "VPS / Remote servers", detail: "Ubuntu, Debian and SSH-connected hosts", icon: Server,
    methods: ["Paired OpenSSH remote agent (source preview)", "Headless CLI source build", "Dedicated hosting workflows (in development)"],
    steps: ["Install or update the latest GULZ CLI on the VPS as your normal non-root user.","From your local device, connect once with ssh user@host and verify the host fingerprint yourself.","Ensure the gulz command is available in non-interactive SSH sessions.","Run gulz remote add production user@host /var/www/project (or omit the path to use the remote home directory).","Run gulz remote test production.","Open gulz chat and ask it to work on the production environment."],
    commands: ["# On the VPS, install/update GULZ first","gulz update","# On your local device, verify the host key manually","ssh user@host","# Pair the already-installed remote agent","gulz remote add production user@host /var/www/project","gulz remote test production","gulz chat"],
    note: "GULZ uses the system OpenSSH client with strict host-key checking, no agent forwarding and no automatic host-key acceptance. Pairing stores only the SSH destination and chosen workspace; your SSH keys stay in your own SSH config/agent. The remote agent exposes the same bounded tools and asks for approval before changes or program execution. Package managers can be run as the SSH user; privileged commands must use sudo -n. Dedicated API/website hosting workflows are still in development.",
  },
];

function App() {
  const [selected, setSelected] = useState<Platform>("termux");
  const [menuOpen, setMenuOpen] = useState(false);
  const [copiedInstall, setCopiedInstall] = useState(false);
  const installCommand = "curl -fsSL https://raw.githubusercontent.com/kellysteve/gulz/main/scripts/install.sh | bash";
  const copyInstallCommand = async () => {
    try { await navigator.clipboard.writeText(installCommand); setCopiedInstall(true); window.setTimeout(() => setCopiedInstall(false), 2200); }
    catch { window.prompt("Copy the GULZ installation command:", installCommand); setCopiedInstall(false); }
  };
  const active = platforms.find((item) => item.id === selected)!;

  return (
    <div className="site-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="GULZ home"><span className="brand-mark">G</span><span>GULZ</span></a>
        <nav className={menuOpen ? "nav nav-open" : "nav"}>
          <a href="#capabilities" onClick={() => setMenuOpen(false)}>Capabilities</a>
          <a href="#how-it-works" onClick={() => setMenuOpen(false)}>How it works</a>
          <a href="#install" onClick={() => setMenuOpen(false)}>Installation</a>
          <a href="#commands" onClick={() => setMenuOpen(false)}>CLI commands</a>
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
            <h1>Tell GULZ what you need.<br/><span>Let it work it out.</span></h1>
            <p className="hero-description">Meet GULZ — an open-source AI assistant for getting real work done. Tell it what you need, keep the conversation going, and stay in control of every sensitive operation.</p>
            <div className="hero-actions"><a className="button button-primary" href="#install">Explore installation <ArrowRight size={17}/></a><a className="button button-quiet" href="https://github.com/kellysteve/gulz" target="_blank" rel="noreferrer">View source</a></div>
            <div className="hero-note"><ShieldCheck size={15}/> You stay in control. Sensitive actions need your approval.</div>
          </div>
          <div className="terminal-card" aria-label="Illustrative GULZ terminal preview">
            <div className="terminal-head"><div className="window-dots"><i/><i/><i/></div><span>gulz — interactive session</span><span className="terminal-live">CLI PREVIEW</span></div>
            <div className="terminal-body">
              <div className="terminal-prompt"><b>❯</b> gulz</div>
              <div className="terminal-title">Hi. I'm GULZ.</div>
              <div className="terminal-muted">A continuous conversation. No repeated commands.</div>
              <div className="terminal-input">› Build a portfolio website for me<span className="cursor"/></div>
              <div className="terminal-line"><span className="ok"><Check size={13}/></span> Request understood</div>
              <div className="terminal-line"><span className="ok"><Check size={13}/></span> Conversation context retained</div>
              <div className="terminal-line"><span className="wait">◌</span> Sensitive actions require approval</div>
              <div className="terminal-footer"><span><Bot size={13}/> CONTINUOUS AI CHAT</span><span>SUPERVISED MODE</span></div>
            </div>
          </div>
        </section>

        <section className="trust-strip"><span><Zap size={16}/> Work that gets done</span><span><ShieldCheck size={16}/> Permission-aware by design</span><span><Terminal size={16}/> Local-first execution</span></section>

        <section className="section" id="capabilities">
          <div className="section-kicker">BUILT FOR REAL WORK</div><h2>One interface. Many environments.</h2><p className="section-lead">From your phone's terminal to a remote VPS, GULZ is being designed to work where your projects and systems already live.</p>
          <div className="feature-grid">
            <article className="feature-card"><div className="feature-icon"><Command/></div><h3>Machine operations</h3><p>The local agent can inspect workspaces, read files, create folders, write approved changes with backups and run approved programs without a shell.</p></article>
            <article className="feature-card"><div className="feature-icon"><Bot/></div><h3>AI that gets work done</h3><p>Choose an AI provider and chat naturally. The Agent Engine turns supported requests into tool calls, executes approved actions and returns results to the same conversation.</p></article>
            <article className="feature-card"><div className="feature-icon"><Server/></div><h3>Remote management</h3><p>Pair a VPS through OpenSSH. GULZ can inspect its selected workspace and run approved programs there without sending SSH credentials to the AI provider. Full hosting workflows are still being built.</p></article>
          </div>
        </section>

        <section className="section process-section" id="how-it-works">
          <div className="section-kicker">HOW GULZ WORKS</div><h2>From intention to verified outcome.</h2>
          <div className="process-grid">
            <div><span className="process-number">01</span><h3>Tell GULZ what you need</h3><p>Describe the outcome you want in plain language.</p></div>
            <div><span className="process-number">02</span><h3>Review the plan</h3><p>The selected model reasons over your request and the tools available to GULZ. It can ask questions when details are missing.</p></div>
            <div><span className="process-number">03</span><h3>Approve sensitive work</h3><p>File changes, package commands, privileged operations and other sensitive actions wait for your approval.</p></div>
            <div><span className="process-number">04</span><h3>Verify the result</h3><p>GULZ returns actual tool results to the model and checks the outcome before reporting completion.</p></div>
          </div>
        </section>

        <section className="install-section" id="install">
          <div className="section-kicker">INSTALLATION CENTRE</div><h2>Your device. Your way to install.</h2><p className="section-lead">Choose your environment for the current CLI developer preview. Source builds require Node.js 20.19+ and Git. Native installers and the desktop app are not published yet.</p>
          <div className="install-layout">
            <div className="platform-list" role="tablist" aria-label="Choose your platform">
              {platforms.map((platform) => { const Icon = platform.icon; return <button key={platform.id} role="tab" aria-selected={selected === platform.id} className={selected === platform.id ? "platform-option selected" : "platform-option"} onClick={() => setSelected(platform.id)}><Icon size={19}/><span><b>{platform.name}</b><small>{platform.detail}</small></span><ArrowRight size={15}/></button>; })}
            </div>
            <div className="install-detail" role="tabpanel">
              <div className="install-detail-top"><div><span className="available-label">INSTALLATION GUIDE</span><h3>{active.name}</h3><p>{active.detail}</p></div><Download size={23}/></div>
              <h4>Distribution status</h4><div className="method-list">{active.methods.map((method) => <span key={method}><ArrowRight size={14}/>{method}</span>)}</div>
              <h4>One-command installer</h4>
              {active.id !== "windows" && <div className="install-one-click"><pre className="install-code"><code>{installCommand}</code></pre><button className="button button-primary" type="button" onClick={copyInstallCommand}><Copy size={15}/>{copiedInstall ? "Copied" : "Copy install command"}</button><p>Run this in your platform's terminal. The installer asks questions and requests confirmation before making changes.</p></div>}
              <h4>Platform commands</h4><pre className="install-code"><code>{active.commands.join("\n")}</code></pre><p className="install-note">{active.note} {active.id !== "termux" && <><a href="https://nodejs.org/en/download" target="_blank" rel="noreferrer">Get Node.js</a>. </>} {active.id === "termux" && <>Get Termux from <a href="https://f-droid.org/packages/com.termux/" target="_blank" rel="noreferrer">F-Droid</a> or the <a href="https://github.com/termux/termux-app/releases" target="_blank" rel="noreferrer">official releases</a>.</>}</p>
              <p className="install-note"><b>Using and updating:</b> After setup, run <code>gulz</code> whenever you want to use GULZ; it does not need to stay open in the background. To update this developer preview later, run <code>gulz update</code> and answer yes when prompted. It fast-forwards the source, installs the CLI dependencies and rebuilds itself. Close the session and run <code>gulz</code> again. Published package updates are not available yet.</p><h4>Step-by-step setup</h4><ol className="steps-list">{active.steps.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol>
              <div className="release-notice"><ShieldCheck size={17}/><p><b>This is an interactive source installer, not a stable release installer.</b><br/>The CLI is in early development. Native packages and signed downloads will only be listed after platform builds and security checks pass.</p></div>
              <p className="install-note"><a href="https://github.com/kellysteve/gulz/blob/main/docs/INSTALLATION.md" target="_blank" rel="noreferrer">Open the complete installation guide <ArrowUpRight size={13}/></a></p>
            </div>
          </div>
        </section>

        <section className="section cli-reference" id="commands">
          <div className="section-kicker">CLI QUICK REFERENCE</div><h2>Open GULZ whenever you need it.</h2>
          <p className="section-lead">Run gulz to open the interactive assistant. Connect an AI provider, pair any VPS you authorize and describe the work you want done.</p>
          <div className="command-grid">
            <article><h3><Terminal size={17}/> Start and inspect</h3><pre><code>{"gulz\ngulz chat\ngulz doctor\ngulz provider status"}</code></pre></article>
            <article><h3><Code2 size={17}/> Workspace tools</h3><pre><code>{"gulz inspect .\ngulz list\ngulz read README.md\ngulz write notes.txt"}</code></pre></article>
            <article><h3><Server size={17}/> Connect a VPS</h3><pre><code>{"gulz remote add production user@host /var/www/project\ngulz remote list\ngulz remote test production\ngulz chat"}</code></pre></article>
          </div>
          <div className="release-notice"><ShieldCheck size={17}/><p><b>Safety boundary:</b><br/>GULZ uses strict SSH host-key verification and never stores SSH private keys. File changes and direct program execution require approval. Remote tools are scoped to the workspace selected when the connection is added. Shell interpreters and inline code are blocked. Dedicated end-to-end hosting workflows remain in development.</p></div>
        </section>

        <section className="section desktop-section" id="desktop">
          <div className="section-kicker">DESKTOP EXPERIENCE</div><h2>A native workspace is on the roadmap.</h2>
          <p className="section-lead">The planned desktop app will bring conversations, local and remote environment connections, approvals, tool activity and project access together in one focused interface. It will use the same local execution engine and approval policy as the CLI rather than introducing a second, less-restricted execution path.</p>
          <div className="desktop-grid">
            <article><AppWindow/><h3>Windows</h3><p>Signed .msi or .exe installer, with verified updates.</p><span>Planned</span></article>
            <article><Laptop/><h3>macOS</h3><p>Signed .dmg app for Apple Silicon and Intel.</p><span>Planned</span></article>
            <article><Monitor/><h3>Linux</h3><p>AppImage, .deb and .rpm packages for supported systems.</p><span>Planned</span></article>
          </div>
          <p className="desktop-footnote">No desktop download is available yet. Android users can use the CLI through Termux in the developer preview; a native Android app is planned. VPS users can install the headless CLI over SSH. All native packages will be published only after platform testing, signing and checksum verification.</p>
          <p className="desktop-footnote"><a href="https://github.com/kellysteve/gulz/blob/main/docs/DESKTOP_APP.md" target="_blank" rel="noreferrer">Read the desktop app design and release plan <ArrowUpRight size={13}/></a></p>
        </section>
        <section className="security-section" id="security">
          <div className="security-icon"><ShieldCheck size={28}/></div><div><div className="section-kicker">CONTROL IS NOT OPTIONAL</div><h2>Autonomy, with boundaries.</h2><p>GULZ is being built around least-privilege access, clear approvals, transparent activity logs and verified outcomes. Your credentials stay yours. Sensitive actions do not happen silently.</p></div>
        </section>

        <section className="final-cta"><div><div className="section-kicker">THE BEGINNING</div><h2>Make progress, not just plans.</h2><p>GULZ is in active development. Platform downloads will appear here after they are built, tested and ready.</p></div><a className="button button-primary" href="#install">Explore installation <ArrowUpRight size={16}/></a></section>
      </main>
      <footer><a className="brand" href="#"><span className="brand-mark">G</span><span>GULZ</span></a><span>Tell it. Get it done.</span><span>A Gaxity product · © 2026</span></footer>
    </div>
  );
}

export default App;
