import { useEffect, useMemo, useRef, useState } from "react";

type View = "brief" | "phase" | "coverage";
type IconName = "document" | "steps" | "scan" | "search" | "menu" | "close" | "check" | "copy" | "arrow" | "external";

type SectionMeta = {
  id: string;
  number: string;
  title: string;
  searchableText: string;
};

const sharedPrompt =
  "Read AGENTS.md. Follow the session protocol in section 14: read docs/PROGRESS.md, docs/DECISIONS.md and docs/OPEN_QUESTIONS.md if they exist, and run the quality gates before changing anything.";

const phasePrompt = `Read AGENTS.md and follow its session protocol.

Execute Phase 0 only. Do not write feature code.

1. Inspect the project: framework, dependencies, database configuration, existing code, deployment constraints. If it is empty, say so.

2. Verify the hosting target from section 3 of AGENTS.md: does it support Node.js, PostgreSQL with btree_gist, background workers and WebSockets? Report what is confirmed, what is unknown, and what you adapted.

3. Produce, in docs/:
   - ARCHITECTURE.md: modules, request flow, provider interfaces, job runner.
   - ERD.md: full relational schema as a Mermaid diagram, plus a table of key relationships, unique constraints, indexes and the exclusion constraints required by section 5.1.
   - PERMISSIONS.md: role x permission matrix using resource:action strings, including which permissions are company-scoped or own-record-scoped.
   - STATE_MACHINES.md: transition tables for rental request, quotation, booking, trip, vehicle, work order, contract, invoice and incident, with the actor allowed to perform each transition and its preconditions.
   - KPIS.md: formula, inclusion/exclusion rules and data-coverage rule for every KPI named in RPT-01..RPT-03.
   - DATA_PROTECTION.md: what personal data is stored, why, who can see it, retention schedule proposal, and Act 843 considerations.
   - DECISIONS.md: one record per choice (auth library, job runner, package manager, etc.) with reasons and alternatives rejected.
   - OPEN_QUESTIONS.md: every business rule needed from management. At minimum cover: rental pricing basis; deposit amount/percentage; quotation validity; cancellation windows and refund rules; whether drivers are always included; who approves quotations and additional charges; shift names and times; contract billing frequency and payment terms; VAT/levies and GRA e-VAT; payment methods in use; vehicle categories; document types and reminder lead times; service intervals; retention periods; on-time threshold; boarding-code policy; whether bookings are allowed under expired or suspended contracts.
   - PROGRESS.md: every feature ID from section 7, all marked Not Started.

4. Set up the foundation only: repository structure, Docker Compose for PostgreSQL, .env.example, linting, typecheck, test runner, CI workflow, an empty migration baseline, and a /health endpoint. Confirm that typecheck, lint, test and build all run.

STOP when done. Report what was created, what you verified by running it, what you could not verify, and the open questions that block Phase 1A. Wait for approval.`;

const briefSections: SectionMeta[] = [
  {
    id: "mission",
    number: "01",
    title: "Mission",
    searchableText:
      "Build a functional secure production-oriented Transport Management System for Richie Transport Services Ghana. Staff busing recurring transport employees homes pickup points workplaces corporate clients. Bus rentals one-off vehicle hire individuals organisations quotation deposit final billing. Staff logistics daily planning dispatch breakdown response maintenance coordination cost reporting. Operational application request planning resources completed trip financial operational results artifacts decisions ERD permission matrix tests migrations.",
  },
  {
    id: "integrity",
    number: "02",
    title: "Integrity rules",
    searchableText:
      "Real persistence server side validation permission checks. Evidence before claims label simulated unconfigured planned Not configured. No invented business facts unknown rule setting with no default OPEN_QUESTIONS. No misleading numbers profit margin KPI reporting period data coverage insufficient data. No dead controls. Preserve working code decisions. Honest limits. Vertical slices. Seed data demonstration never production. Secrets never source control client code documentation.",
  },
  {
    id: "business-context",
    number: "03",
    title: "Business context",
    searchableText:
      "Authoritative owner fills this in before Phase 0. Blank fields are unknown. Do not guess. List them in docs/OPEN_QUESTIONS.md. Company Richie Transport Services Ghana.",
  },
];

const phaseSections: SectionMeta[] = [
  {
    id: "session-protocol",
    number: "00",
    title: "Shared session protocol",
    searchableText: sharedPrompt,
  },
  {
    id: "phase-zero",
    number: "01",
    title: "Inspect and plan",
    searchableText:
      "Phase 0 inspect and plan no feature code. Inspect framework dependencies database configuration existing code deployment constraints. Verify hosting Node.js PostgreSQL btree_gist background workers WebSockets. Produce ARCHITECTURE ERD PERMISSIONS STATE_MACHINES KPIS DATA_PROTECTION DECISIONS OPEN_QUESTIONS PROGRESS. Setup repository structure Docker Compose PostgreSQL .env.example linting typecheck test runner CI migration baseline health endpoint. Report what created verified not verified open questions. Wait for approval.",
  },
  {
    id: "management-questions",
    number: "02",
    title: "Management questions",
    searchableText:
      "rental pricing basis deposit amount percentage quotation validity cancellation windows refund rules drivers included approvals additional charges shift names times contract billing frequency payment terms VAT levies GRA e-VAT payment methods vehicle categories document types reminder lead times service intervals retention periods on-time threshold boarding-code policy expired suspended contracts",
  },
  {
    id: "review-checklist",
    number: "03",
    title: "Review checklist",
    searchableText:
      "Your review checklist before approving Phase 0. The heading is visible in the screenshot. Checklist items are below the crop and not visible.",
  },
];

const coverageSections: SectionMeta[] = [
  {
    id: "files-read",
    number: "01",
    title: "Files visible",
    searchableText:
      "Four screenshots show two unique documents: Richie Transport Services standing brief and Richie TMS phase prompts. Duplicate screenshots were included.",
  },
  {
    id: "cropped-content",
    number: "02",
    title: "Content outside the crop",
    searchableText:
      "Standing brief business context begins with Company Richie Transport Services Ghana. Remaining business context is outside the visible crop. Phase 0 review checklist heading is visible but checklist items are cropped out. Do not infer missing rules.",
  },
];

const integrityRules = [
  ["Real persistence.", "Operational screens read and write the database through server-side validation and permission checks. No workflow depends on frontend-only sample data."],
  ["Evidence before claims.", "Do not claim a feature, integration or test works unless it was run and passed. Label simulated, unconfigured or planned work as such, including in the UI and docs (\"Not configured\")."],
  ["No invented business facts.", "Unknown rules become settings with no default; an administrator must set them before dependent features can be used. Record them in docs/OPEN_QUESTIONS.md."],
  ["No misleading numbers.", "Do not present profit, margin or a KPI as verified when inputs are missing. Show the reporting period and data coverage, or say \"insufficient data\"."],
  ["No dead controls.", "Every visible button and link works, or is explicitly labelled unavailable or planned."],
  ["Preserve working code.", "Inspect before changing. No wholesale rewrites without a decision record in docs/DECISIONS.md."],
  ["Honest limits.", "If the environment cannot support a requirement, say so and build the best supported alternative."],
  ["Vertical slices.", "Finish complete features (interface, server logic, validation, persistence, permissions and tests) before starting new ones."],
  ["Seed data.", "Clearly label demonstration data and never load it in production."],
  ["Secrets.", "Never put secrets in source control, client code or documentation."],
] as const;

const services = [
  ["Staff busing", "Recurring transport of employees between homes, pickup points and workplaces for corporate clients."],
  ["Bus rentals", "One-off vehicle hire for individuals and organisations, with quotation, deposit and final billing."],
  ["Staff logistics", "Daily planning, dispatch, breakdown response, maintenance coordination and cost reporting."],
] as const;

const artifacts = [
  ["ARCHITECTURE.md", "Modules, request flow, provider interfaces and job runner."],
  ["ERD.md", "Relational schema as Mermaid, key relationships, constraints and indexes."],
  ["PERMISSIONS.md", "Role-by-permission matrix, including company and own-record scope."],
  ["STATE_MACHINES.md", "Transitions, authorised actors and preconditions for operational records."],
  ["KPIS.md", "Formulas, inclusion rules and data-coverage rules for RPT-01 through RPT-03."],
  ["DATA_PROTECTION.md", "Personal data, purpose, access, retention proposal and Act 843 considerations."],
  ["DECISIONS.md", "Technical choices, reasons and alternatives rejected."],
  ["OPEN_QUESTIONS.md", "Business rules that management must answer; unknowns are not defaulted."],
  ["PROGRESS.md", "Every feature ID from section 7, initially Not Started."],
] as const;

const managementQuestions = [
  "Rental pricing basis",
  "Deposit amount or percentage",
  "Quotation validity",
  "Cancellation windows and refund rules",
  "Whether drivers are always included",
  "Who approves quotations and additional charges",
  "Shift names and times",
  "Contract billing frequency and payment terms",
  "VAT/levies and GRA e-VAT",
  "Payment methods in use",
  "Vehicle categories",
  "Document types and reminder lead times",
  "Service intervals",
  "Retention periods",
  "On-time threshold",
  "Boarding-code policy",
  "Whether bookings are allowed under expired or suspended contracts",
];

const viewLabels: Record<View, string> = {
  brief: "Standing brief",
  phase: "Phase 0 prompt",
  coverage: "Source coverage",
};

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };

  switch (name) {
    case "document":
      return <svg {...common}><path d="M7 3.75h7l4.25 4.5v12A.75.75 0 0 1 17.5 21h-10a.75.75 0 0 1-.75-.75v-15A1.5 1.5 0 0 1 8.25 3.75Z" /><path d="M14 4v5h4M9.5 13h5M9.5 16.5h5" /></svg>;
    case "steps":
      return <svg {...common}><path d="M4 5.5h3v3H4zM10.5 5.5H20M4 10.5h3v3H4zM10.5 12h9.5M4 17h3v3H4zM10.5 18.5H20" /></svg>;
    case "scan":
      return <svg {...common}><path d="M8 4H5a1 1 0 0 0-1 1v3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10" /></svg>;
    case "search":
      return <svg {...common}><circle cx="10.8" cy="10.8" r="6.3" /><path d="m15.5 15.5 4.1 4.1" /></svg>;
    case "menu":
      return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
    case "close":
      return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
    case "check":
      return <svg {...common}><path d="m5 12.5 4.2 4.2L19 7" /></svg>;
    case "copy":
      return <svg {...common}><rect x="8" y="8" width="12" height="12" rx="1.5" /><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" /></svg>;
    case "arrow":
      return <svg {...common}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
    case "external":
      return <svg {...common}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></svg>;
  }
}

function getSavedReviews(): Record<View, boolean> {
  const empty: Record<View, boolean> = { brief: false, phase: false, coverage: false };
  try {
    const saved = localStorage.getItem("richie-tms-doc-review");
    if (!saved) return empty;
    const parsed: unknown = JSON.parse(saved);
    if (typeof parsed !== "object" || parsed === null) return empty;
    return {
      brief: Boolean((parsed as Record<string, unknown>).brief),
      phase: Boolean((parsed as Record<string, unknown>).phase),
      coverage: Boolean((parsed as Record<string, unknown>).coverage),
    };
  } catch {
    return empty;
  }
}

export function BriefDesk({ onExit }: { onExit?: () => void }) {
  const [activeView, setActiveView] = useState<View>("brief");
  const [search, setSearch] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [reviewed, setReviewed] = useState<Record<View, boolean>>(getSavedReviews);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "unavailable">("idle");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.matches("input, textarea, [contenteditable='true']");
      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        setMobileNavOpen(false);
        if (search) setSearch("");
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [search]);

  useEffect(() => {
    if (copyState === "idle") return;
    const timeout = window.setTimeout(() => setCopyState("idle"), 2600);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  const sections = activeView === "brief" ? briefSections : activeView === "phase" ? phaseSections : coverageSections;
  const visibleSections = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return sections;
    return sections.filter((section) => `${section.title} ${section.searchableText}`.toLowerCase().includes(needle));
  }, [search, sections]);

  const selectView = (view: View) => {
    setActiveView(view);
    setSearch("");
    setMobileNavOpen(false);
    setCopyState("idle");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggleReviewed = () => {
    const next = { ...reviewed, [activeView]: !reviewed[activeView] };
    setReviewed(next);
    try {
      localStorage.setItem("richie-tms-doc-review", JSON.stringify(next));
    } catch {
      // Review state remains available for this session if storage is blocked.
    }
  };

  const copyPhasePrompt = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(`${sharedPrompt}\n\n${phasePrompt}`);
      setCopyState("copied");
    } catch {
      setCopyState("unavailable");
    }
  };

  const goToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const renderBriefSection = (id: string) => {
    if (id === "mission") {
      return (
        <>
          <p>
            Build a functional, secure, production-oriented Transport Management System for <strong>Richie Transport Services</strong>, a transport company in Ghana. The source brief links to the company&apos;s service page: <a className="text-link" href="https://www.richietransportservices.com/index.html#services" target="_blank" rel="noreferrer">richietransportservices.com <Icon name="external" size={13} /></a>.
          </p>
          <p>The company&apos;s three services must work inside one integrated system:</p>
          <ol className="service-list">
            {services.map(([name, description]) => (
              <li key={name}><strong>{name}:</strong> {description}</li>
            ))}
          </ol>
          <p>
            This is an operational application, not a brochure site or a static dashboard. The brief calls for a clear path from a request, to planning, to assigned resources, to a completed trip, to recorded financial and operational results.
          </p>
          <p>Work as the lead engineer and produce concrete artifacts such as decision records, an ERD, a permission matrix, tests and migrations.</p>
        </>
      );
    }

    if (id === "integrity") {
      return (
        <ol className="integrity-list">
          {integrityRules.map(([title, description]) => (
            <li key={title}><strong>{title}</strong> {description}</li>
          ))}
        </ol>
      );
    }

    return (
      <>
        <p>Business context is authoritative; the owner fills it in before Phase 0. Blank fields are unknown. Do not guess them; list them in <code>docs/OPEN_QUESTIONS.md</code>.</p>
        <pre className="source-code"><code>- Company: Richie Transport Services, Ghana</code></pre>
        <div className="source-note"><span className="note-mark">!</span><p>The screenshot ends after this company line. Any remaining business-context fields are not visible in the supplied image.</p></div>
      </>
    );
  };

  const renderPhaseSection = (id: string) => {
    if (id === "session-protocol") {
      return <blockquote className="protocol-quote">Read <code>AGENTS.md</code>. Follow the session protocol in section 14: read <code>docs/PROGRESS.md</code>, <code>docs/DECISIONS.md</code> and <code>docs/OPEN_QUESTIONS.md</code> if they exist, and run the quality gates before changing anything.</blockquote>;
    }

    if (id === "phase-zero") {
      return (
        <>
          <div className="phase-warning"><span className="warning-mark">0</span><p><strong>Phase 0 only.</strong> Inspect and plan. Do not write feature code.</p></div>
          <ol className="phase-steps">
            <li>
              <h3>Inspect the project</h3>
              <p>Review the framework, dependencies, database configuration, existing code and deployment constraints. If the project is empty, say so.</p>
            </li>
            <li>
              <h3>Verify the hosting target</h3>
              <p>From section 3 of <code>AGENTS.md</code>, check support for Node.js, PostgreSQL with <code>btree_gist</code>, background workers and WebSockets. Report what is confirmed, unknown and adapted.</p>
            </li>
            <li>
              <h3>Produce the planning documents</h3>
              <p>Create these artifacts in <code>docs/</code>:</p>
              <ul className="artifact-list">
                {artifacts.map(([name, description]) => <li key={name}><code>{name}</code><span>{description}</span></li>)}
              </ul>
            </li>
            <li>
              <h3>Set up the foundation only</h3>
              <p>Repository structure, Docker Compose for PostgreSQL, <code>.env.example</code>, linting, typecheck, test runner, CI workflow, an empty migration baseline and a <code>/health</code> endpoint. Confirm typecheck, lint, test and build all run.</p>
            </li>
          </ol>
          <div className="stop-note"><span className="stop-line" /><div><strong>Stop and wait for approval.</strong><p>Report what was created, what was verified by running it, what could not be verified, and the open questions that block Phase 1A.</p></div></div>
        </>
      );
    }

    if (id === "management-questions") {
      return (
        <>
          <p>The prompt says to record every business rule needed from management. These are the minimum questions visible in the source:</p>
          <ul className="question-list">
            {managementQuestions.map((question) => <li key={question}>{question}</li>)}
          </ul>
        </>
      );
    }

    return (
      <div className="source-note"><span className="note-mark">!</span><p>Only the heading &ldquo;Your review checklist before approving Phase 0&rdquo; is visible in the screenshot. The checklist items are below the crop, so they have not been reconstructed.</p></div>
    );
  };

  const renderCoverageSection = (id: string) => {
    if (id === "files-read") {
      return (
        <ul className="coverage-list">
          <li><span className="coverage-index">A</span><div><strong>Standing brief</strong><p>Richie Transport Services - Transport Management System (TMS). The screenshot includes the mission, integrity rules and the beginning of the business context.</p></div></li>
          <li><span className="coverage-index">B</span><div><strong>Phase prompts</strong><p>Richie TMS - Phase Prompts. The screenshot includes the shared session protocol and Phase 0 through the review-checklist heading.</p></div></li>
        </ul>
      );
    }
    return (
      <>
        <p>The screenshots show the same two documents twice. The extracted workspace above reflects the visible text only; content beyond the image crops has not been filled in or treated as fact.</p>
        <ul className="coverage-gaps">
          <li>The standing brief image cuts off during section 3, after the company name and country.</li>
          <li>The Phase Prompts image cuts off after the Phase 0 review-checklist heading; the checklist itself is not visible.</li>
          <li>Pricing, tax, fleet, customer and contract rules that are not visible remain unknown.</li>
        </ul>
        <div className="source-note"><span className="note-mark">i</span><p>These images describe project requirements. They do not provide evidence that an operational TMS, database, hosting target or integrations are configured.</p></div>
      </>
    );
  };

  const pageTitle = activeView === "brief" ? "Standing brief" : activeView === "phase" ? "Phase 0: inspect and plan" : "Source coverage";
  const pageDescription = activeView === "brief"
    ? "The stable brief: what the system must protect and the services it must support."
    : activeView === "phase"
      ? "The first execution prompt. Inspect, document, set up the foundation, then stop for review."
      : "A faithful reading of the supplied screenshots, with the cropped-out material kept explicit.";

  return (
    <div className="workspace-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>

      {mobileNavOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}

      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`} aria-label="Workspace navigation">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span>R</span><i /></div>
          <div><span className="brand-name">RICHIE</span><span className="brand-caption">TMS PROJECT DESK</span></div>
          <button className="mobile-close" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}><Icon name="close" /></button>
        </div>

        <div className="sidebar-divider" />
        <p className="nav-label">SOURCE DOCUMENTS</p>
        <nav className="primary-nav">
          <button className={`nav-item ${activeView === "brief" ? "nav-item-active" : ""}`} onClick={() => selectView("brief")} aria-current={activeView === "brief" ? "page" : undefined}>
            <span className="nav-icon"><Icon name="document" /></span><span className="nav-copy"><strong>Standing brief</strong><small>Stable build rules</small></span><Icon name="arrow" size={15} />
          </button>
          <button className={`nav-item ${activeView === "phase" ? "nav-item-active" : ""}`} onClick={() => selectView("phase")} aria-current={activeView === "phase" ? "page" : undefined}>
            <span className="nav-icon"><Icon name="steps" /></span><span className="nav-copy"><strong>Phase 0 prompt</strong><small>Inspect and plan</small></span><Icon name="arrow" size={15} />
          </button>
          <button className={`nav-item ${activeView === "coverage" ? "nav-item-active" : ""}`} onClick={() => selectView("coverage")} aria-current={activeView === "coverage" ? "page" : undefined}>
            <span className="nav-icon"><Icon name="scan" /></span><span className="nav-copy"><strong>Source coverage</strong><small>What is visible</small></span><Icon name="arrow" size={15} />
          </button>
        </nav>

        <div className="sidebar-bottom">
          {onExit && (
            <button type="button" className="nav-item" onClick={onExit} style={{ marginBottom: 14 }}>
              <span className="nav-icon"><Icon name="arrow" /></span><span className="nav-copy"><strong>Back to TMS</strong><small>Return to the application</small></span>
            </button>
          )}
          <div className="sidebar-bottom-mark"><span className="live-dot" /> SOURCE-LED WORKSPACE</div>
          <p>Document reader only.<br />Operational data is not configured.</p>
          <span className="sidebar-version">RICHIE TMS <span>·</span> BRIEF DESK</span>
        </div>
      </aside>

      <main className="main-area" id="main-content">
        <header className="topbar">
          <div className="topbar-start">
            <button className="mobile-menu" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}><Icon name="menu" /></button>
            <div className="breadcrumb"><span>PROJECT DESK</span><span className="breadcrumb-divider">/</span><strong>{viewLabels[activeView]}</strong></div>
          </div>
          <div className="topbar-tools">
            <label className="search-box">
              <Icon name="search" size={17} />
              <input ref={searchRef} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search this document" aria-label="Search this document" />
              {search ? <button type="button" className="search-clear" onClick={() => setSearch("")} aria-label="Clear search"><Icon name="close" size={14} /></button> : <kbd>/</kbd>}
            </label>
          </div>
        </header>

        <div className="page-container">
          <div className="page-heading">
            <div className="page-heading-copy">
              <div className="eyebrow"><span className="eyebrow-rule" /> PROJECT DOCUMENTS <span className="eyebrow-separator">/</span> {activeView === "brief" ? "01" : activeView === "phase" ? "02" : "03"}</div>
              <h1>{pageTitle}</h1>
              <p className="page-description">{pageDescription}</p>
            </div>
            <div className="page-actions">
              <button className={`review-button ${reviewed[activeView] ? "review-button-done" : ""}`} onClick={toggleReviewed} aria-pressed={reviewed[activeView]}>
                <span className="review-check"><Icon name="check" size={15} /></span>{reviewed[activeView] ? "Reviewed here" : "Mark reviewed"}
              </button>
              {activeView === "phase" && <button className="copy-button" onClick={copyPhasePrompt}><Icon name="copy" size={16} />{copyState === "copied" ? "Copied" : copyState === "unavailable" ? "Copy unavailable" : "Copy prompt"}</button>}
            </div>
          </div>

          {activeView === "brief" && <div className="document-callout"><span className="callout-label">HOW TO USE THIS FILE</span><p>It is the stable brief: it says how to build, not what to do next. Phase prompts are separate. Read this at the start of every session.</p></div>}
          {activeView === "phase" && <div className="document-callout phase-callout"><span className="callout-label">BEFORE EVERY PHASE</span><p>{sharedPrompt}</p></div>}
          {copyState === "unavailable" && activeView === "phase" && <p className="copy-message" role="status">Clipboard access is unavailable in this browser. You can still select and copy the prompt text below.</p>}

          <div className="document-layout">
            <article className="document-content" aria-label={pageTitle}>
              <div className="document-meta"><span className="document-meta-dot" /> TRANSCRIBED FROM UPLOADED SCREENSHOTS <span className="meta-divider">·</span> VISIBLE EXCERPT</div>

              {search && <div className="search-results-line" role="status">{visibleSections.length} {visibleSections.length === 1 ? "section" : "sections"} match &ldquo;{search}&rdquo;</div>}

              {visibleSections.length ? visibleSections.map((section) => (
                <section className="content-section" id={section.id} key={section.id}>
                  <div className="section-heading">
                    <span className="section-number">{section.number}</span>
                    <h2>{section.title}</h2>
                  </div>
                  <div className="section-body">
                    {activeView === "brief" ? renderBriefSection(section.id) : activeView === "phase" ? renderPhaseSection(section.id) : renderCoverageSection(section.id)}
                  </div>
                </section>
              )) : (
                <div className="empty-search"><span className="empty-search-icon"><Icon name="search" size={20} /></span><h2>No matching sections</h2><p>Try a different term, or clear the search to see the full document.</p><button onClick={() => setSearch("")}>Clear search</button></div>
              )}

              <footer className="document-footer"><span>END OF VISIBLE EXCERPT</span><span>Unknown fields remain unknown.</span></footer>
            </article>

            <aside className="document-rail" aria-label="Document tools">
              <div className="rail-block">
                <p className="rail-heading">ON THIS PAGE</p>
                <nav className="outline-nav">
                  {visibleSections.map((section) => (
                    <button key={section.id} className="outline-link" onClick={() => goToSection(section.id)}>
                      <span>{section.number}</span>{section.title}
                    </button>
                  ))}
                </nav>
              </div>
              <div className="rail-block rail-status">
                <p className="rail-heading">READING STATUS</p>
                <div className="status-indicator"><span className={reviewed[activeView] ? "status-dot status-dot-done" : "status-dot"} />{reviewed[activeView] ? "Reviewed in this browser" : "Not marked reviewed"}</div>
                <p className="rail-caption">This status is saved locally on this device. It is not a server record.</p>
              </div>
              {activeView === "phase" && (
                <div className="rail-block rail-source-note">
                  <p className="rail-heading">EXECUTION RULE</p>
                  <p>One phase at a time. Review the previous phase before starting another.</p>
                </div>
              )}
              <div className="rail-bottom-note"><span className="rail-bottom-line" /><p>Built from the visible source only. No business defaults inferred.</p></div>
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}

