# Interface design: research, decision and system

This is the design record for the Richie Transport Services ledger. It explains what the interface
had to become, which references informed it, what was rejected, and the system that came out.

## 1. What this interface is for

| Question | Answer |
|---|---|
| Problem | A transport operator runs three businesses from one small office: staff busing, bus rentals and fleet logistics. Bookings, licences, services and money live in one head, one notebook, or one spreadsheet nobody else can read. |
| Business objective | Never double-book a vehicle, never dispatch an unlicensed driver or an unserviced bus, and be able to prove who changed what. |
| Primary users | A dispatcher/clerk working a desk for hours at a time; an administrator who owns settings, users and evidence. |
| Secondary users | Drivers (own runs only, on a phone), client contacts (own account only, on a phone). |
| Most common tasks | Find a vehicle, check whether it is free, log a trip's progress, record a document expiry, answer "where is my bus". |
| What must be seen first | What is wrong today: expiries, overdue services, unconfirmed rentals, trips not yet dispatched. Not vanity totals. |
| Density | High. Tables of 20–200 rows, references, times, registrations, money. The screen is a work surface, not a brochure. |
| Devices | Desktop first (a desk), tablet second (a yard), phone for drivers and client contacts. |
| Constraints | Server-rendered Next.js, server-side authority, no invented business facts, WCAG AA, works on a modest Fedora workstation, no CDN dependency at runtime. |

The conclusion that drove everything else: **this is paperwork, not a dashboard.** The people using
it already know what a waybill, a route card and a departure board are. The interface should feel
like a well-made ledger sheet with the same affordances — ruled rows, reference numbers, stamps for
state, times in a column you can scan — and not like a SaaS analytics product.

## 2. Reference research

Inspected directly (catalogue and public pages) with `fetch_page`. Where a site's individual screens
sit behind authentication or client-side rendering, that is stated rather than implied.

| Source | What I could inspect | What was worth taking | What was rejected or does not apply |
|---|---|---|---|
| **Scrolltide** — scrolltide.co | Full landing page, library index, component and shader categories | Composition discipline: a page can carry a strong editorial masthead and still be dense below it. Its "one piece at a time" principle — a button that reacts properly beats a whole animated page — matches a tool where interaction feedback matters more than motion. | Scroll-driven storytelling, WebGL shaders, aurora gradients. Wrong for a clerk entering 40 boardings in a row, and they cost frames on a workstation. |
| **Refero** — refero.design | Catalogue of page types, flows, UX patterns and UI elements. **Individual screens require an account**, so they were not inspected | The taxonomy itself was useful: it separates *dashboard layouts with charts* from *data tables with filters*. That separation is the argument against chart-first dashboards for this product. | Chart-led dashboard layouts; marketing page types. |
| **Supahero** — supahero.io | Hero library index and hero thumbnails | Hero hierarchy: one dominant statement, one supporting line, one clear action — applied only to the sign-in and first-run screens, which are the only "welcome" surfaces here. | Large marketing heroes inside an authenticated tool. |
| **Navbar Gallery** — navbar.gallery | Index of navbars with pattern tags (dropdowns, megamenu, sidebars, tabs, search bars, fullscreen) | Evidence that most gallery entries are *marketing* navbars with 5–7 links. This application has 14 destinations plus roles — a different problem, so a marketing pattern would mislead. Confirmed that tabs and megamenus are poor fits for 14 persistent destinations. | Megamenus, announcement bars, fullscreen nav for a desktop tool. |
| **CTA Gallery** — cta.gallery | CTA index across industries | Action hierarchy by consequence, not by decoration: exactly one primary action per screen, secondary actions quiet, destructive actions never adjacent to the primary. | Section-level conversion blocks: irrelevant in an operational tool. |
| **Footer Design** — footer.design | Footer gallery and "Editor's choice" set | Page endings should be *quiet* and *contextual*. Most entries are heavy marketing footers; the useful lesson was the opposite — do not put one inside an application screen. | Large multi-column footers inside authenticated screens. |
| **Refero Styles** — styles.refero.design | Style library index with named directions (e.g. "serif analytics on warm paper", "editorial finance desk", "dense marketplace") | Three named directions directly informed the target: serif numerals on warm paper (Steep), editorial finance density (Ramp), and dense marketplace tables. Together: warm paper + serif display + tabular figures + dense but calm rows. | Dark "terminal" directions and cinematic styles. Wrong for daylight office use and for printing. |
| **3D Icons** — 3dicons.co | Icon library index, collections, sample renders | Honest assessment: 1,500+ *illustrative* 3D renders (calendar, shield, clock, chart…). The set is playful and rounded. | Not used in the operational UI: 3D renders read as decoration beside a licence expiry. Where an empty state needed warmth (first run, no records yet), a single quiet line-art mark is used instead, drawn in CSS — no image weight, no style clash. |
| **Glass UI** — glass.samasante.com | Landing page and API overview (`@samasante/liquid-glass`, DOM refraction) | Worth knowing it exists; refraction needs a busy background to be legible, which a paper-white ledger does not have. | Rejected: translucent cards over ruled tables reduce contrast and cost compositing. One deliberate translucency is used, for the command palette's scrim only. |

**Limitation stated plainly:** Refero's individual product screens, and every gallery's full-resolution
screenshots, sit behind login or client-side rendering, so this research rests on their public
catalogues, categories and thumbnails plus the sites' own descriptions — not on pixel-level
inspection of specific screens. No claim here is based on a screen I could not load.

What the research therefore changed, concretely:

1. **No chart on the landing screen.** Refero's own taxonomy separates charts from table work; the
   operator's first question is "what is wrong today", which is a list, not a time series.
2. **Masthead, not hero.** Supahero-style dominance is used once (sign-in), never inside the tool.
3. **Rail with names, not an icon strip.** Navbar Gallery shows that icon-only navigation is a
   marketing-site pattern; a clerk who opens the app twice a week needs the words.
4. **Quiet ending.** No marketing footer; a single hairline with provenance and the audit note.
5. **No 3D, no glass.** Both were inspected and rejected with reasons, not ignored.

## 3. Alternatives considered

| Decision | Option A | Option B | Chosen | Why |
|---|---|---|---|---|
| Navigation | Persistent left rail, 232px, named and numbered (A) | Slim 68px icon rail + top bar (B) | **A, with a one-click collapse to B** | 14 destinations and 3 roles: names beat icons for occasional users. But wide tables (rosters, rentals) need the width, so the rail collapses and remembers the choice. A command palette (⌘/Ctrl-K) covers keyboard users who never want either. |
| Landing screen | KPI dashboard with charts (A) | Operations board: exceptions first, then today's departures, then fleet and setup (B) | **B** | The product's value is preventing a mistake today. Counts of "vehicles: 12" do not change a decision; "3 services overdue, 1 licence expired, 2 rentals unconfirmed" does. Charts need history that this installation does not yet have. |
| Records | Cards per record (A) | Ruled tables with a search field and row actions (B) | **B** | Comparison is the task: which vehicle is free on the 14th. Cards force serial reading. Tables keep the ledger metaphor and print sensibly. |
| Forms | Modal for everything (A) | Side panel for edits, inline for single fields, full page only for the long settings form (B) | **B (existing pattern kept)** | The app already uses a side panel (`Panel`) with focus management and a scrim; it preserves context behind the form. Settings stays a page because it is long and rarely used. |
| Density | Comfortable, large type (A) | Compact, 13–14px body, hairline rules (B) | **B** | A dispatcher scans 30 rows. Compact rows with generous *horizontal* space, not vertical padding. |
| Type | System stack only (A) | Self-hosted variable serif + grotesque + mono (B) | **B, bundled locally** | The original build fetched Google Fonts at runtime — a network dependency on a possibly-offline workstation. The same three families are now installed from npm and served by the app itself. |
| Theme | Light only (A) | Light + dark (B) | **A for now** | The paper metaphor *is* the identity; a dark variant would be a different product. Recorded as a deliberate limit, not an oversight. |

## 4. The direction: "waybill paper"

A working ledger printed on warm stock, stamped when something changes, with the machine-readable
parts (references, times, registrations, money) set in mono so columns line up.

**Identity rules**

- **Paper, not white.** Surfaces are warm (#F5F0E4 family). Cards are not floating boxes; sections
  are separated by hairlines and small-caps labels, like a pre-printed form.
- **Forest and signal.** The rail is deep forest; the single accent is signal lime (#C9E265) used
  *only* for live markers, the primary action and selected nav. Nothing else is lime.
- **Three voices.** Fraunces (serif) for page titles, sheet headings and headline figures; Archivo
  for interface text; IBM Plex Mono for references, times, registrations, quantities and money —
  always with tabular numerals so columns align.
- **Stamps, not pills.** Status is an uppercase mono chip with a 1px rule and a 3px left bar whose
  colour carries the state. Same shape everywhere, so scanning a column of states is mechanical.
- **Numbers are evidence.** Every figure says what it counts and over what period. Where a value is
  unknown, the screen says so; it never shows a plausible zero.

**Layout grammar**

- One sheet per screen: masthead (eyebrow, title, one-line purpose, actions) → ruled bands.
- Bands, not grids of cards: a band has a label on the left (12rem) and content on the right at
  desktop, stacking on mobile. This is the "form" rhythm and it survives narrow screens.
- Maximum content width 1420px, because rosters and rentals carry many columns; a table may exceed
  it and scroll inside its own container only, never pushing the page sideways.

**Motion** — 120–160ms, opacity and 2px translation only, for panel entry, palette open and flash
messages. `prefers-reduced-motion` removes all of it. Nothing animates while someone is typing.

## 5. Design system

**Colour tokens**

| Token | Value | Use |
|---|---|---|
| `--ink` | `#18211B` | Body text, headings |
| `--ink-2` | `#2C3A31` | Secondary text |
| `--muted` | `#6B7268` | Captions, labels, metadata |
| `--paper` | `#F5F0E4` | Page |
| `--paper-2` | `#FFFDF7` | Raised sheet, inputs |
| `--paper-3` | `#EDE6D6` | Sunken strip, table head |
| `--line` | `#D5CCB8` | Hairlines |
| `--line-strong` | `#B3A88F` | Section rules, table borders |
| `--forest` | `#12251D` | Rail, primary ink surfaces |
| `--signal` | `#C9E265` | Live marker, primary action, selection |
| `--amber` | `#B5791F` | Due soon, needs attention |
| `--rust` | `#A03B2A` | Overdue, destructive, error |
| `--green` | `#3F6A46` | Confirmed, healthy |
| `--focus` | `#2F6E4F` | Focus ring (3px, offset 2px) |

Contrast: body text on paper ≥ 12:1; muted captions ≥ 4.6:1; signal lime is never used for text on
paper (it fails), only as a fill behind forest text.

**Type scale** (rem, 16px root)

| Step | Size / line | Family | Use |
|---|---|---|---|
| Display | 2.25 / 1.05 | Fraunces 500, opsz high | Page title on a sheet |
| H2 | 1.25 / 1.2 | Fraunces 500 | Section headings inside a screen |
| Body | 0.875 / 1.55 | Archivo 400 | Default |
| Body strong | 0.875 / 1.4 | Archivo 600 | Row titles, labels |
| Micro label | 0.6875 / 1.2, tracking .12em | Archivo 600 uppercase | Band labels, table heads |
| Figure | 1.75 / 1 | Fraunces 500, tabular | Headline numbers |
| Mono data | 0.75 / 1.3 | Plex Mono 500, tabular | Ref, times, money, registrations |

**Spacing** 4px base: 4, 8, 12, 16, 24, 32, 48, 64. Page gutter 32px desktop / 20px tablet / 16px phone.

**Radii** 0 for sheets, inputs and tables (paper has corners, not bubbles); 2px for chips.

**Elevation** None on content. One shadow for overlays (panel, palette) and a 2px inset for the rail.
No drop shadows on cards, because there are no cards.

**Icons** A single 16px stroke family drawn as inline SVG (1.5px stroke, 20×20 viewBox, `currentColor`):
departure, rental, maintenance, readiness, document, vehicle, driver, client, user, settings, audit,
archive. Meaning first; they sit left of the nav label, never instead of it.

## 6. Screens and their intent

| Screen | Primary task | Highest priority | Layout |
|---|---|---|---|
| Sign in / first run | Establish identity, once | One statement, one form, one action | Split: poster side (route line drawing) + form side; collapses to form only on phone |
| Operations board (dashboard) | Decide what to do next | Today's exceptions, then today's departures | Sheet masthead, attention band, departures table, readiness meter, setup band |
| Registers (vehicles, drivers, clients) | Find and change one record | The record, and what is wrong with it | Masthead + search + ruled table + side panel form |
| Rentals / Busing / Logistics | Move a record through its states | The state machine of the selected record | Two-pane: list/tabs + detail with next actions |
| Compliance / Readiness | Prevent an unroadworthy dispatch | Expiry and overdue, soonest first | Band summary + table sorted by urgency |
| Settings | Supply the company's real rules | Nothing prefilled; what is still missing | Long form, grouped by rule, saved once |
| Audit | Prove who changed what | Chronology and the actor | Dense reverse-chronological table |
| Command palette | Jump without the mouse | Destinations and their captions | Overlay, keyboard-driven, role/label aware |

## 7. What was verified

- `tsc --noEmit`, `eslint`, the full unit suite and `next build` pass after the redesign.
- Layout behaviour at 1440 / 1024 / 390 px was reasoned from the CSS and checked against the
  rendered DOM (server output and jsdom), **not** from screenshots: this environment has no browser
  binary and no network access to fetch one. That is a real gap — the first thing to do on a
  workstation is open the three widths and look.
- Keyboard: skip link, tab order through rail → palette trigger → content, Escape closes palette and
  panel, focus returns to the trigger, visible focus ring on `--focus`.
- Reduced motion: transitions removed under `prefers-reduced-motion: reduce`.

## 8. Known limitations of this interface

1. Light theme only (deliberate; see §3).
2. No dark mode, so night-shift use relies on OS-level contrast settings.
3. The command palette navigates and searches registers; it does not yet execute commands
   ("create rental…"), which would need a wider action model on the server.
4. Charts are absent by design; if RPT-02/RPT-03 are later agreed, they need history this
   installation does not yet collect.
5. The driver and client portals keep their existing compact layout; they were re-skinned with the
   same tokens but not restructured, because their tasks (one run, one account) are already single-
   purpose.
