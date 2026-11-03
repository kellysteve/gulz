import { useState } from "react";
import {
  ArrowRight, ArrowUpRight, Bot, Check, Command,
  Download, Laptop, Menu, Monitor, Server, ShieldCheck, Smartphone, Terminal, Code2, AppWindow,
  X, Zap,
} from "lucide-react";

type Platform = "termux" | "linux" | "macos" | "windows" | "vps";

const platforms: { id: Platform; name: string; detail: string; icon: typeof Terminal; methods: string[]; steps: string[]; commands: string[]; note: string }[] = [
  {
    id: "termux", name: "Android / Termux", detail: "Android phones and tablets", icon: Smartphone,
    methods: ["Interactive Bash installer (developer preview)", "Manual CLI source build (developer preview)", "Native Android app (planned)"],
    steps: ["Install Termux from F-Droid or the official GitHub releases.", "Update Termux and install curl. The installer can offer to install Git and Node.js LTS if missing.", "Download and review the installer script.", "Run bash gulz-install.sh, answer its prompts, then launch gulz."],
    commands: ["pkg update && pkg upgrade -y", "pkg install curl", "curl -fsSL https://raw.githubusercontent.com/kellysteve/gulz/main/scripts/install.sh -o gulz-install.sh", "sed -n '1,260p' gulz-install.sh", "bash gulz-install.sh", "gulz", "gulz doctor"],
    note: "The installer asks for the install folder and confirmation. It installs only the CLI workspaces and deliberately skips Wrangler/Workerd, which is unsupported on Android/Termux. It can offer to install missing Termux Git and Node.js LTS packages. This is a developer-preview CLI inside Termux, not a standalone Android app.",
  },
  {
    id: "linux", name: "Linux", detail: "Ubuntu, Debian and other distributions", icon: Terminal,
    methods: ["Interactive Bash installer (developer preview)", "Manual CLI source build (developer preview)", "AppImage / .deb / .rpm packages (planned)", "Desktop app (planned)"],
    steps: ["Install Node.js 20.19+ and curl.", "Download the public installer and review the script if desired.", "Run bash gulz-install.sh and answer the install-folder and confirmation prompts.", "Open a new terminal and run gulz."],
    commands: ["# Install Node.js 20.19+ and curl first", "curl -fsSL https://raw.githubusercontent.com/kellysteve/gulz/main/scripts/install.sh -o gulz-install.sh", "sed -n '1,260p' gulz-install.sh", "bash gulz-install.sh", "gulz", "gulz doctor"],
    note: "The installer asks for the install folder and confirmation, installs only CLI workspace dependencies, then builds and links the CLI. It skips the website tooling. Review scripts/install.sh before running it. Signed .deb, .rpm and AppImage packages are not published.",
  },
  {
    id: "macos", name: "macOS", detail: "Apple Silicon and Intel Macs", icon: Command,
    methods: ["Interactive Bash installer (developer preview)", "Manual CLI source build (developer preview)", "Signed .dmg desktop app (planned)", "Homebrew package (planned)"],
    steps: ["Install Node.js 20.19+ and curl.", "Download the public installer and review the script if desired.", "Run bash gulz-install.sh and answer the install-folder and confirmation prompts.", "Open a new terminal and run gulz."],
    commands: ["brew install node git curl", "curl -fsSL https://raw.githubusercontent.com/kellysteve/gulz/main/scripts/install.sh -o gulz-install.sh", "sed -n '1,260p' gulz-install.sh", "bash gulz-install.sh", "gulz", "gulz doctor"],
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
    methods: ["SSH + interactive Bash installer (developer preview)", "Headless server package (planned)"],
    steps: ["Connect to your server using your own SSH account.", "Install Node.js 20.19+ and curl on the VPS.", "Download and run the Bash installer as your normal user, not root.", "Run gulz on the server itself. SSH-based remote orchestration is not available yet."],
    commands: ["# Install Node.js 20.19+ and curl first", "curl -fsSL https://raw.githubusercontent.com/kellysteve/gulz/main/scripts/install.sh -o gulz-install.sh", "sed -n '1,260p' gulz-install.sh", "bash gulz-install.sh", "gulz doctor"],
    note: "Install Node.js 20.19+ and curl first, then run the interactive installer as your normal non-root SSH user. The CLI runs on this VPS; it does not yet connect to or administer other machines automatically.",
  },
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
            <h1>Stop managing tasks.<br/><span>Start executing goals.</span></h1>
            <p className="hero-description">Meet GULZ — an open-source machine-operations platform in active development. Its CLI foundation is taking shape around real actions, clear approvals and verified results.</p>
            <div className="hero-actions"><a className="button button-primary" href="#install">Explore installation <ArrowRight size={17}/></a><a className="button button-quiet" href="https://github.com/kellysteve/gulz" target="_blank" rel="noreferrer">View source</a></div>
            <div className="hero-note"><ShieldCheck size={15}/> You stay in control. Sensitive actions need your approval.</div>
          </div>
          <div className="terminal-card" aria-label="Illustrative GULZ terminal preview">
            <div className="terminal-head"><div className="window-dots"><i/><i/><i/></div><span>gulz — interactive session</span><span className="terminal-live">CONCEPT</span></div>
            <div className="terminal-body">
              <div className="terminal-prompt"><b>❯</b> gulz</div>
              <div className="terminal-title">Good evening. I'm GULZ.</div>
              <div className="terminal-muted">Tell me what you want to accomplish.</div>
              <div className="terminal-input">› Prepare my server for deployment<span className="cursor"/></div>
              <div className="terminal-line"><span className="ok"><Check size={13}/></span> Goal understood</div>
              <div className="terminal-line"><span className="ok"><Check size={13}/></span> Environment inspection planned</div>
              <div className="terminal-line"><span className="wait">◌</span> Awaiting execution approval</div>
              <div className="terminal-footer"><span><Bot size={13}/> PLANNED AI LAYER</span><span>SUPERVISED MODE</span></div>
            </div>
          </div>
        </section>

        <section className="trust-strip"><span><Zap size={16}/> Goal-oriented execution</span><span><ShieldCheck size={16}/> Permission-aware by design</span><span><Terminal size={16}/> Local-first execution</span></section>

        <section className="section" id="capabilities">
          <div className="section-kicker">BUILT FOR REAL WORK</div><h2>One interface. Many environments.</h2><p className="section-lead">From your phone's terminal to a remote VPS, GULZ is being designed to work where your projects and systems already live.</p>
          <div className="feature-grid">
            <article className="feature-card"><div className="feature-icon"><Command/></div><h3>Machine operations</h3><p>The current CLI preview can inspect and read local files, write approved text changes with backups, and run a small allowlist of diagnostics.</p></article>
            <article className="feature-card"><div className="feature-icon"><Bot/></div><h3>AI goal execution</h3><p>Planned: turn a goal into a structured plan, request approval for sensitive steps, coordinate tools and verify real outcomes.</p></article>
            <article className="feature-card"><div className="feature-icon"><Server/></div><h3>Remote management</h3><p>Planned: connect to authorized SSH and VPS environments through the same permission and approval system. Remote execution is not available yet.</p></article>
          </div>
        </section>

        <section className="section process-section" id="how-it-works">
          <div className="section-kicker">THE PLANNED WORKFLOW</div><h2>From intention to verified outcome.</h2>
          <div className="process-grid">
            <div><span className="process-number">01</span><h3>Describe the goal</h3><p>Describe the outcome you want in plain language.</p></div>
            <div><span className="process-number">02</span><h3>Review the plan</h3><p>The planned AI layer inspects only authorized resources and prepares an actionable plan.</p></div>
            <div><span className="process-number">03</span><h3>Approve sensitive work</h3><p>High-impact and destructive operations wait for your explicit approval.</p></div>
            <div><span className="process-number">04</span><h3>Verify the result</h3><p>The execution layer verifies results and saves progress so work can recover after interruptions.</p></div>
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
              <h4>Developer preview commands</h4><pre className="install-code"><code>{active.commands.join("\n")}</code></pre><p className="install-note">{active.note} {active.id !== "termux" && <><a href="https://nodejs.org/en/download" target="_blank" rel="noreferrer">Get Node.js</a>. </>} {active.id === "termux" && <>Get Termux from <a href="https://f-droid.org/packages/com.termux/" target="_blank" rel="noreferrer">F-Droid</a> or the <a href="https://github.com/termux/termux-app/releases" target="_blank" rel="noreferrer">official releases</a>.</>}</p>
              <p className="install-note"><b>Using and updating:</b> The Bash installer is interactive; download and review the public script, then run it with <code>bash gulz-install.sh</code>. After setup, open a terminal and run <code>gulz</code> whenever you want to use GULZ; it does not need to stay open in the background. To update this developer preview later, run <code>gulz update</code> in a terminal, review the repository path and type <code>UPDATE GULZ</code> to approve. GULZ will fast-forward the source, install dependencies and rebuild itself. Close the session and run <code>gulz</code> again. Published package updates are not available yet.</p><h4>Step-by-step setup</h4><ol className="steps-list">{active.steps.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol>
              <div className="release-notice"><ShieldCheck size={17}/><p><b>This is an interactive source installer, not a stable release installer.</b><br/>The CLI is in early development. Native packages and signed downloads will only be listed after platform builds and security checks pass.</p></div>
              <p className="install-note"><a href="https://github.com/kellysteve/gulz/blob/main/docs/INSTALLATION.md" target="_blank" rel="noreferrer">Open the complete installation guide <ArrowUpRight size={13}/></a></p>
            </div>
          </div>
        </section>

        <section className="section cli-reference" id="commands">
          <div className="section-kicker">CLI QUICK REFERENCE</div><h2>Open GULZ whenever you need it.</h2>
          <p className="section-lead">Run `gulz` to open the interactive terminal session. Create and revisit locally saved goals, or use the commands below. Install once; to update this source preview later, enter the cloned repository and run `git pull --ff-only`, `npm install` and `npm run install:local`, then restart GULZ.</p>
          <div className="command-grid">
            <article><h3><Terminal size={17}/> Start and inspect</h3><pre><code>{"gulz --help\ngulz doctor\ngulz init\ngulz goals"}</code></pre></article>
            <article><h3><Code2 size={17}/> Goals and files</h3><pre><code>{'gulz goal create "Prepare my project"\ngulz inspect .\ngulz read README.md\ngulz write notes.txt'}</code></pre></article>
            <article><h3><ShieldCheck size={17}/> Approved diagnostics</h3><pre><code>{"gulz run node --version\ngulz run git status --short\ngulz run git status --short --branch\ngulz run git branch --show-current\ngulz run git log -1 --oneline\ngulz run git diff --stat\ngulz run git rev-parse --show-toplevel\ngulz restore <backup> <target>"}</code></pre></article>
          </div>
          <div className="release-notice"><ShieldCheck size={17}/><p><b>Safety boundary:</b><br/>The run command uses a fixed allowlist, starts processes without a shell, strips inherited command-injection environment variables, caps output and requires typed approval. Arbitrary shell commands, package installs, deletes, remote SSH execution and unattended AI-driven machine changes are not available.</p></div>
        </section>

        <section className="section desktop-section" id="desktop">
          <div className="section-kicker">DESKTOP EXPERIENCE</div><h2>A native workspace is on the roadmap.</h2>
          <p className="section-lead">The planned desktop app will bring the GULZ task workspace, approvals, execution activity and local project access together in one focused interface. It will use the same local execution engine and approval policy as the CLI rather than introducing a second, less-restricted execution path.</p>
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
      <footer><a className="brand" href="#"><span className="brand-mark">G</span><span>GULZ</span></a><span>Goals. Executed.</span><span>A Gaxity product · © 2026</span></footer>
    </div>
  );
}

export default App;
