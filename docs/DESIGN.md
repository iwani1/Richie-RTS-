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

The conclusion that drove everything else: **this is a board, not a dashboard.** The people using it
already know what a departure board, a route card and a waybill are. The interface should feel like
the board a dispatcher stands in front of — a clock, a row per departure, a lamp per state, and the
broken things listed before the tidy ones — and not like a SaaS analytics product.

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
| **Refero Styles** — styles.refero.design | Style library index with named directions (e.g. "serif analytics on warm paper", "editorial finance desk", "dense marketplace") | Editorial finance density (Ramp) and dense marketplace tables: compact rows, tabular figures, one accent. These survived into the final direction. | Dark *terminal* directions and cinematic styles were rejected at the time as wrong for daylight and for printing. **Later the owner chose a dark departure board from three templates**; that is a board (large mono times, lamps, one lit accent), not a terminal (log streams, neon syntax), and this document records the change rather than pretending the research always pointed there. |
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
3. **Names, never an icon strip.** Navbar Gallery shows that icon-only navigation is a marketing-site
   pattern. The strip moved from a left rail to the top of the board when the owner chose the control
   room, but every destination still carries its word and its number.
4. **Quiet ending.** No marketing footer; a single hairline with provenance and the audit note.
5. **No 3D, no glass.** Both were inspected and rejected with reasons, not ignored. The dark board
   keeps that: there is no glass, no gradient and no glow except an 8px halo on a live lamp.
6. **The direction is the owner's decision, recorded.** Three templates were built and shown
   (`docs/templates/`); B was chosen. §3 compares them and §8 states what the choice costs.

## 3. Alternatives considered

The overall direction was put to the owner as three built templates (`docs/templates/`, three HTML
files plus a switcher) rendering the same screen — attention, today's runs, fleet readiness, a form
with an error state, the setup rules — so the comparison was like-for-like.

| Direction | What it is | What it costs | Verdict |
|---|---|---|---|
| **A · Waybill** | Warm paper, Fraunces serif headings, ruled bands, stamp chips. | Calm, but reads like a document: state is quiet and the clock is not prominent. | Not chosen. It was what the build already had. |
| **B · Control room** | Near-black green board, split-flap departure times, lamp + word states, top navigation, mono figures. | Dark rooms only in daylight; needs strict contrast discipline; two type voices instead of three. | **Chosen.** The product is watched, not read: a dispatcher needs the next departure and what is broken, at a glance, from across a desk. |
| **C · Statement** | Cool white, one grotesque, hairlines, right-aligned figures, green accent. | Quiet and excellent for money and audit; the departures board loses its physicalness. | Not chosen. Its best idea — figures aligned right in tabular mono — was carried into B. |

| Decision | Option A | Option B | Chosen | Why |
|---|---|---|---|---|
| Navigation | Persistent left rail, named, collapsible (A) | Grouped horizontal strip under the identity bar, drawer under 980px (B) | **B** | A dispatcher moves between busing, rentals and logistics many times an hour. A top strip keeps 12 destinations one click away and gives the run list the full page width; wide tables no longer need a collapse control. |
| Landing screen | KPI dashboard with charts (A) | Operations board: what is broken, then today's departures, then fleet and setup (B) | **B** | The value is preventing a mistake today. "Vehicles: 12" changes no decision; "1 licence expired, 2 services overdue" does. |
| State | Coloured pills (A) | Lamp (dot) plus the word, in mono uppercase (B) | **B** | Colour alone fails for the ~8% of male staff with a red–green deficiency, and this palette is green/amber/red. The word is the state; the lamp is the second cue. |
| Time | Plain text, same size as body (A) | Split-flap tile, mono, 16px, tabular (B) | **B** | The departure time is the one datum scanned at speed; it gets its own shape so the eye can run down a column of them. |
| Records | Cards per record (A) | Panelled tables with row actions (B) | **B** | Comparison is the task: which vehicle is free on the 14th. |
| Forms | Modal for everything (A) | Side panel for edits, full page only for the long settings form (B, unchanged) | **B** | The panel preserves context behind the form and already handles focus and Escape. |
| Density | Comfortable, large type (A) | Compact 12.5–13px, generous horizontal space (B) | **B** | A dispatcher scans 30 rows. Density comes from rules and alignment, never from 8px text. |
| Type | Serif display + grotesque + mono (A) | Grotesque for language, mono for every machine datum; serif dropped (B) | **B** | On a dark board a serif heading glows; mono is what makes times, references and money line up. |
| Theme | Light paper (A) | Dark only (B) | **B**, deliberate | This is a room-facing board used beside a dispatch desk and often in the evening; the owner chose B. It is recorded as a limit, not an oversight. |
| Motion | Transitions everywhere (A) | 120–160ms, opacity and 2px translation, panel slide only (B) | **B** | Nothing moves while someone is typing; the only indeterminate animation is the "Saving" rule, and reduced motion removes it. |

## 4. The direction: "control room"

A departure board in a dark office: the clock, what is broken and what leaves next, legible from a
metre away.

**Identity rules**

- **Board, not paper.** Surfaces are near-black green (#0B1210 page, #111B17 panel, #16241E raised).
  Nothing is pure black; nothing is pure white. Rules are 1px edges at #24332C / #35473D.
- **State is a lamp.** Every status is a dot plus a word in tracked mono capitals. The dot's colour is
  the second cue, never the only one.
- **Time has a shape.** Departure times sit in split-flap tiles — dark tile, cream digits, tabular.
  You can scan a column of them without reading the routes.
- **Two voices.** Archivo for language, IBM Plex Mono for every machine datum: times, references,
  registrations, money, counts, labels. Figures are tabular and larger than body text.
- **One accent.** Amber (#FFB545) means act: primary action, selected destination, the "Saving" rule,
  overdue and due-soon. Mint means finished or healthy; red means stopped or expired. No gradients,
  no glass, no glow except a 8px halo on a live lamp.
- **Numbers are evidence.** Every figure says what it counts. Where the company has not supplied a
  fact, the board says *not set* or *not evaluable*, never a plausible zero.

**Layout grammar**

- Header: identity, clock and user on one row; grouped destinations on the next. Sticky, because the
  run list is long.
- Sheet masthead: eyebrow, title, one line of purpose, actions.
- Bands: a 176px label column (sticky at desktop, static under 980px) and the work on the right.
- Panels for anything tabular (`rts-board`, `rts-table-wrap`); full-page bands for prose and forms;
  the side panel for edits; the palette for jumps.
- Maximum content width 1360px. Toasts and notices never overlap the header.

**Motion** — 120–160ms, opacity and at most 2px translation, for panel entry and the saving rule.
`prefers-reduced-motion` removes all of it.

## 5. Design system

**Colour tokens** (measured with the WCAG relative-luminance formula against page `#0B1210`,
panel `#111B17` and raised `#16241E`)

| Token | Value | Contrast (page · panel · raised) | Use |
|---|---|---|---|
| `--rts-text` | `#D9E7DE` | 14.83 · 13.78 · 12.59 | Body, table values, headings |
| `--rts-text-2` | `#B9CBC0` | 11.16 · 10.37 · 9.47 | Secondary text, row titles |
| `--rts-muted` | `#93A89B` | 7.50 · 6.97 · 6.37 | Captions, hints, band notes |
| `--rts-dim` | `#7F9488` | 5.86 · 5.44 · 4.98 | Column heads, labels, placeholders |
| `--rts-amber` | `#FFB545` | 10.78 · 10.01 · 9.15 | Act: primary, selected nav, due soon |
| `--rts-mint` | `#8FE0AB` | 12.11 · 11.25 · 10.28 | Confirmed, ready, completed |
| `--rts-red` | `#FF8A6A` | 8.21 · 7.62 · 6.97 | Overdue, expired, destructive |
| `--rts-edge` | `#24332C` | 1.43 · 1.33 · 1.21 (decorative) | Hairlines |
| `--rts-edge-strong` | `#35473D` | 1.91 · 1.78 · 1.62 (decorative) | Section rules, table borders |

Ink on amber measures 10.78:1 and ink on mint 12.11:1, so the primary button and any lamp fill take
dark text. No text token is below 4.5:1 on any of the three surfaces — the worst is `--rts-dim` on
raised at 4.98:1.

**Type** (13px body; nothing below 10.5px anywhere)

| Step | Size / line | Family | Use |
|---|---|---|---|
| Display | 24–32px / 1.08 | Archivo 650, −0.018em | Page title |
| Figure | 22–26px / 1.05 | Plex Mono 600, tabular | Headline numbers, money |
| Body | 13px / 1.55 | Archivo 400 | Default |
| Row title | 12.5px / 1.3 | Archivo 600 | Route, record names |
| Mono datum | 11–12px / 1.4 | Plex Mono 500, tabular | Times, refs, money in tables |
| Micro label | 10.5px / 1.5, tracking .14em | Plex Mono 600 uppercase | Band labels, table heads |
| Chip | 9.5px / 1.5, tracking .10em | Plex Mono 600 uppercase | State flags, badges |

**Spacing** 4px base: 4, 8, 12, 16, 24, 32, 48, 64. Page gutter 26px desktop / 16px tablet / 12px phone.

**Radii** 0 for boards, inputs, tables and chips; 2px is the maximum anywhere. **Elevation** none on
content; one blurred shadow for the side panel and the palette scrim. **Icons** one 16px inline-SVG
family, 1.5px stroke, always beside a word.

**Legacy utility mapping.** Screens written in earlier passes still name Tailwind's `stone`/`white`/
`red`/`lime` scales. Those are remapped in `@theme` to the board (e.g. `text-stone-500` → `#93A89B`,
`bg-white` → `#111B17`, `border-lime-600` → amber) so no screen renders a light surface. Token names
`--rts-ink`, `--rts-paper*` and `--rts-line*` survive as aliases of the new surfaces for the same
reason; new rules use the semantic names.

## 6. Screens and their intent

| Screen | Primary task | Highest priority | Layout |
|---|---|---|---|
| Sign in / first run | Establish identity, once | One statement, one form, one action | Split: ruled board on the left, form card on the right; the board side is dropped under 980px |
| Operations board (dashboard) | Decide what to do next | What is broken, then what leaves today | Masthead, attention band with lamps, departures board with flap times, fleet meter, rentals, setup rules |
| Registers (vehicles, drivers, clients) | Find and change one record | The record and what is wrong with it | Masthead, count line ("2 of 9 · 1 expired"), panel table, side-panel form |
| Rentals | Move a request through its states | The state machine of the selected record | Five-step strip (tick / amber current / muted), request and quote side by side, actions for that state |
| Busing / Logistics | Run the day | Today's runs and the next action on each | Masthead, tabs over banded sections, panels for trips and work orders |
| Compliance / Readiness | Prevent an unroadworthy dispatch | Expiry and overdue, soonest first | Summary figures, urgency-sorted table, plain-language Timing column, interval bars per basis |
| Settings | Supply the company's real rules | Nothing prefilled; what is still missing | "Rules to supply" band read from the saved record, then one band per rule |
| Audit | Prove who changed what | Chronology and the actor | Dense table: mono timestamps, action as a code chip, record named, "showing 17 of 412" |
| Command palette | Jump without the mouse | Destinations and their captions | Overlay, keyboard-first, permission-filtered, focus-trapped |

## 7. What was verified

- `tsc --noEmit` and `eslint src` are clean; `npm test` is **170 passed, 5 skipped** across 23 test
  files; `next build` completes (First Load JS 169 kB, fonts self-hosted).
- Every one of the 167 `rts-*` classes used in the source has a rule in the stylesheet — checked by
  extracting class names from `src/**/*.tsx` and diffing them against the CSS, so no element can fall
  back to browser defaults unnoticed.
- The built stylesheet contains no light surface: the previous paper values (`#F2ECDF`, `#FBF7EC`,
  `#E9E1CF`, `#14231D`) appear zero times; the only white left is 2–4% translucency on hover rows.
- Contrast: every text token measured against all three surfaces (§5). The worst is 4.98:1.
- The build was served from `next start` on `0.0.0.0` and signed in against a seeded database; the CSS
  and fonts load from the app itself.
- Keyboard: skip link, destination strip reachable in DOM order before the page, Escape closes the
  palette and panel, focus returns to the trigger, one 3px focus ring on `--rts-focus`.
- Reduced motion: transitions and the saving rule are removed under `prefers-reduced-motion`.
- Layout behaviour at 1440 / 1024 / 390px was reasoned from the CSS and the rendered DOM, **not** from
  screenshots: this environment has no browser binary. That is a real gap — see §8.

## 8. Known limitations of this interface

1. Dark only. In a sunlit office by a window, a dark board is harder to read than paper; the owner
   accepted this in exchange for the room-facing board and evening use. There is no light theme.
2. Two type voices instead of three: there is no serif anywhere now, which costs the "printed
   document" feel on quotations and invoices — those are not built yet, and this decision should be
   revisited when they are.
3. No screenshots: layout was verified from the DOM and CSS, not by looking. The first thing to do on
   a workstation is open 1440 / 1024 / 390 and check the header, a long table and a side panel.
4. The in-flight indicator is one shell-level "Saving" state, not a per-button spinner; commands are
   serialised, so one honest signal is enough, but a slow form cannot say which field it waits on.
5. Charts are absent by design; RPT-02/RPT-03 need history this installation does not collect.
6. The rental strip is the only place that shows sequence; busing and logistics use chips and next
   actions, which fits their flows (a trip is dispatched or cancelled, it does not pass five gates).
7. The driver and client portals were re-skinned with the same tokens but not restructured; their
   tasks (one run, one account) are already single-purpose.
