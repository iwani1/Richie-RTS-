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

The conclusion that drove everything else: **this is a working document, not a dashboard.** The
people using it already know what a timetable, a route card, a licence and an invoice look like. The
interface should feel like a page they could annotate in the margin — a masthead with the day, a
headline that is the day's most urgent fact, sections under rules, figures in a column, and the broken
things printed before the tidy ones — and not like a SaaS analytics product. Colour marks which
section of the paper you are in; it never decorates.

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
| **Refero Styles** — styles.refero.design | Style library index with named directions (e.g. "serif analytics on warm paper", "editorial finance desk", "dense marketplace") | Editorial finance density (Ramp) and dense marketplace tables: compact rows, tabular figures, one accent. These survived into the final direction. | Dark *terminal* directions and cinematic styles were rejected as wrong for daylight and for printing. The build briefly shipped a dark departure board before the owner asked for a new interface; the final direction returns to exactly what the research first suggested — serif display on warm paper, editorial finance density, tabular figures — with one flat colour block per section. |
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
   pattern. The strip is a numbered *contents* line under the masthead, and every destination carries
   its word and its number; icons are hidden entirely rather than used as the primary cue.
4. **Quiet ending.** No marketing footer; a single hairline with provenance and the audit note.
5. **No 3D, no glass.** Both were inspected and rejected with reasons, not ignored. The page keeps
   that: no glass, no gradient, no glow, no shadow — depth is a rule and a flat block.
6. **The direction is the owner's decision, recorded.** Three templates were built and shown
   (`docs/templates/`); the owner rejected all of them and chose a fourth direction in words. §3
   compares the options and §8 states what the choice costs.

## 3. Alternatives considered

The direction had already been through three built templates in `docs/templates/` — **A · Waybill**
(warm paper, serif, ruled bands), **B · Control room** (dark board, split-flap times) and
**C · Statement** (cool white, hairlines, right-aligned figures). B shipped. The owner then rejected
the result in one line — *"i want to change the whole ui. dont use anything from the demo app"* — and
answered two scoping questions: the direction is **bright editorial**, and the scope is *visuals,
layout and no demo data*.

Changing the method mattered as much as changing the look. Three more HTML mockups would have spent a
day re-litigating a decision the owner had already made, so the three new lanes were offered as
written briefs instead, and only the chosen one was built:

| Direction | What it is | What it costs | Verdict |
|---|---|---|---|
| **D · Bright editorial** | Off-white newsprint, one flat colour block per section, Instrument Serif for display, Archivo for text, Plex Mono for figures, rules instead of cards, zero radii. | A serif display needs disciplined sizes or headings swamp a dense table; the colour block must be re-checked for contrast on every screen. | **Chosen.** The work is read and annotated, not watched: a request, a quote, an expiry, a rule still missing. Paper is the right metaphor for that, and colour per section makes 14 destinations navigable without icons. |
| **E · Data broadsheet** | True newspaper: multi-column text flow, 10px body, dense tabloid grid. | Text reflow across columns breaks forms and tables, and 10px type in a side panel fails its own density goal. | Not chosen. Its best idea — a numbered contents list — survives in the dashboard brief. |
| **F · Swiss institutional** | One grotesque, strict 12-column grid, heavy white, a single departmental accent. | Correct and cold; it converges on the generic SaaS dashboard the brief bans, and gives a small family haulier no warmth. | Not chosen. |

| Decision | Option A | Option B | Chosen | Why |
|---|---|---|---|---|
| Ground | White (#ffffff) with grey panels | Newsprint (#fdfcf8) with true-white surfaces only inside panels | **Newsprint** | White for a full page is glare under office strip lighting; a warm off-white reads as printed stock and lets true white mean "raised". |
| Colour | One accent for the whole app | One flat spot colour per section, carried by the rubric block and section marks | **Per section** | Fourteen destinations in a horizontal strip are hard to tell apart by name alone; colour gives each a place, and it is never the only cue — the rubric also carries the section name. |
| Type | Grotesque only, weights for hierarchy | Display serif + grotesque for text + mono for figures | **Three voices** | The serif gives the page a headline and a by-line; the grotesque stays legible at 12.5px in tables; the mono lines up times, plates and money. |
| Navigation | Left rail (rejected with the old build) | Numbered horizontal contents strip under the masthead, drawer under 980px | **Contents strip** | A rail spends 240px of every wide table on 14 labels; the strip returns that width to the departures table and reads as the contents page of the section. |
| Dashboard | Four KPI cards over a chart, then an activity table | Front page: a masthead figure, a lead story drawn from the first real exception, a numbered brief, then a two-column spread | **Front page** | KPI cards change no decision. "3 services overdue · 1 licence expired" is the morning's work list, and the first one gets the space to be read. |
| State | Colour only | Colour block plus the word (`Expired`, `Not set`, `Draft`) | **Word plus colour** | Colour alone fails for red–green deficiency, and ochre in this palette is too light for text. |
| Records | Cards per record | Ruled tables and side panels | **Tables** | Comparison is the task: which vehicle is free on the 14th. |
| Edges | Rounded cards with shadows | Hairlines and flat colour blocks, every radius 0 | **Hairlines** | A shadow is a fake edge on paper; a 1px rule is a real one and survives printing and screenshots. |
| Density | Comfortable, large type everywhere | 12.5–13px text, generous horizontal space, rules for grouping | **Dense, never small** | A dispatcher scans 30 rows. Density comes from alignment and rules, not from 9px text. |
| Motion | Transitions on every state change | 120–160ms opacity and a 2px translation, panel slide only | **Minimal** | Nothing moves while someone is typing; `prefers-reduced-motion` removes what is left. |

## 4. The direction: "bright editorial"

A magazine built for data. Off-white stock, a flat colour block that opens every screen, a serif
headline, and the rest of the page set as ruled sections rather than boxes.

**Identity rules**

- **Paper, not glass.** Page `#fdfcf8`, raised surface `#ffffff`, ink `#111110`. Nothing is pure black;
  nothing floats. Every separation is a 1px rule (`#e2dcce`) or a solid ink rule at a section head.
- **One colour per section.** The rubric block at the top of a screen is a solid block — ink, teal,
  ochre, green, blue or red — and the same colour marks that section's figures. Ochre is the one
  colour that is never text: at 2.19:1 it is a block only, with ink set on top.
- **A headline, not a label.** Screen titles are Instrument Serif at 34–60px, set to 0.94 line height.
  Body copy is Archivo at 12.5–13.5px. Figures are IBM Plex Mono, tabular, so a column of times and a
  column of money both line up.
- **No radii, no shadows, no gradients.** Every corner is square. Depth is expressed by a rule and by
  colour, never by blur.
- **Numbers are evidence.** Every figure says what it counts and over what period. Where the company
  has not supplied a fact the page says *not set* or *not evaluable*, never a plausible zero.

**Layout grammar**

- **Masthead.** Wordmark, section line, search, live clock, date, user, sign out. Sticky; a 3px ink
  rule closes it.
- **Contents strip.** Fourteen destinations in five named groups, each numbered `01…14`, sitting under
  the masthead. Below 980px it becomes a drawer reached from a Menu button.
- **Rubric.** The screen's colour block: eyebrow, display title, one line of purpose, actions.
- **Spread.** Sections are full-width bands (label and note above an ink rule, work below) or a
  two-column `rts-spread` at 1180px and up — the dashboard sets today's departures beside fleet and
  setup, so the page reads as an inside spread rather than a stack.
- **Listing, panel, palette.** Tables and timetable rows carry records; a side panel edits one record
  without leaving the page; the palette (`Ctrl K`) jumps between screens.
- **Width.** Content is capped at 1400px with a `clamp(16px, 2.6vw, 40px)` gutter.

**Motion** — 120–160ms on opacity and at most a 2px translation, for panel entry and the "Saving"
rule. `prefers-reduced-motion: reduce` removes all of it.

## 5. Design system

**Colour tokens** (measured with the WCAG relative-luminance formula against paper `#fdfcf8`)

| Token | Value | Contrast | Use |
|---|---|---|---|
| `--ink` | `#111110` | 18.40 | Body, headings, figures |
| `--ink-2` | `#33312c` | 11.90 | Secondary text, table cells |
| `--muted` | `#6b675f` | 5.48 | Captions, hints, band notes |
| `--rule` | `#e2dcce` | 1.39 | Hairlines only — never text |
| `--spot-red` | `#c03a26` | 5.28 | Expired, cancelled, rubric for Compliance |
| `--spot-teal` | `#0f6057` | 7.23 | Busing, portals |
| `--spot-green` | `#2c6e49` | 5.96 | Completed, healthy, Logistics |
| `--spot-blue` | `#20356f` | 11.36 | Registers (vehicles, drivers, clients) |
| `--spot-ochre` | `#e3a02f` | 2.19 | **Block and rule only.** Ink sits on top; never used as a text colour |

Rubric map: `dashboard`, `users`, `settings`, `audit` → ink · `busing`, `driver_portal`,
`client_portal` → teal · `rentals`, `fleetReadiness` → ochre with ink text · `logistics` → green ·
`vehicles`, `drivers`, `clients` → blue · `compliance` → red.

**Type scale** — display: 60/34/27/22px Instrument Serif, weight 400 only. Text: 15/13.5/12.5/11px
Archivo. Figures: 26–44px Plex Mono; labels 8.5–9.5px, 0.14–0.24em tracking, uppercase.

**Spacing** — 4/8/12/16/24/32/48/64px. Sections are 34px apart; a rubric block is 22–38px padded.

**Compatibility.** Screens written in earlier passes use Tailwind's `stone`, `red`, `emerald` and
`lime` scales; `@theme` re-points those at the editorial palette (`text-stone-500` → `#6b675f`,
`bg-white` → `#ffffff`, `border-lime-600` → ink) so no screen renders an off-palette grey. The token
aliases `--rts-ink`, `--rts-paper*`, `--rts-line*` survive for the same reason; new rules use the
semantic names.

**Accessibility** — 3px focus ring on `#8a5b10` (checked against both paper and every rubric block),
skip link to `#main-content`, `aria-current="page"` on the active destination, tabular figures so a
changing clock does not reflow, and state never carried by colour alone.

## 6. Screens and their intent

| Screen | Primary task | Highest priority | Layout |
|---|---|---|---|
| Sign in / first run | Establish identity, once | One statement, one form, one action | A cover: full-height teal poster on the left carrying the wordmark and headline, form on paper at the right; poster drops under 980px |
| Front page (dashboard) | Decide what to do next | What is broken, then what leaves today | Masthead figure, lead story from the first exception, numbered brief for the rest, then a spread of departures · fleet · setup, rentals across the foot |
| Registers (vehicles, drivers, clients) | Find and change one record | The record and what is wrong with it | Rubric, count line ("2 of 9 · 1 expired"), ruled table, side-panel form |
| Rentals | Move a request through its states | The state machine of the selected record | Five-step interval strip, request and quote side by side, actions for that state |
| Busing / Logistics | Run the day | Today's runs and the next action on each | Rubric, tabs over banded sections, panels for trips and work orders |
| Compliance / Readiness | Prevent an unroadworthy dispatch | Expiry and overdue, soonest first | Summary figures, urgency-sorted table, plain-language Timing column, interval bars per basis |
| Settings | Supply the company's real rules | Nothing prefilled; what is still missing | "Rules to supply" read from the saved record, then one band per rule — the first screen on an empty install |
| Audit | Prove who changed what | Chronology and the actor | Dense table: mono timestamps, action as a code chip, record named, "showing 17 of 412" |
| Command palette | Jump without the mouse | Destinations and their captions | Overlay, keyboard-first, permission-filtered, focus-trapped |

## 7. What was verified

- `tsc --noEmit` and `eslint src` are clean; `npm test` is **169 passed, 5 skipped** across 24 test
  files (one fewer than before: the `ALLOW_DEMO_SEED` test went with the feature); `next build`
  compiles.
- Every `rts-*` class used in `src/**/*.tsx` has a rule in the stylesheet — checked by extracting
  class names and diffing them against the CSS; the only three "misses" are template prefixes whose
  `--error`/`--warning`/`--success` variants exist.
- Contrast: every text token measured against the paper (§5). The lowest text value is `--muted` at
  5.48:1; ochre is excluded from text entirely and documented as such.
- **The app starts empty.** With demo seeding removed, a fresh database has no users, and
  `POST /api/session` reports `setupRequired: true`; the first screen asks for the administrator and
  Settings asks for the company's own rules. No screen has a prefilled business fact.
- Keyboard: skip link, contents strip in DOM order before the page, Escape closes palette and panel,
  focus returns to the trigger.
- Reduced motion: transitions and the saving rule are removed under `prefers-reduced-motion`.
- Layout behaviour at 1440 / 1180 / 980 / 700px was reasoned from the CSS and the rendered DOM,
  **not** from screenshots: this environment has no browser binary. That remains a real gap — see §8.

## 8. Known limitations of this interface

1. **No screenshots.** Layout was verified from the DOM and CSS, not by looking. The first thing to do
   on a workstation is open 1440 / 1024 / 390 and check a rubric block, a long table and a side panel.
2. **The contents strip is 14 destinations wide.** Above 1400px it fits in one line; between 980 and
   1200px it scrolls horizontally. It is honest (nothing is hidden in a menu) but it is not elegant at
   that width, and a second row would be the fix if the list grows.
3. **Ochre carries two sections.** Rentals and Fleet readiness share the lightest spot colour, which
   is also the one that cannot carry text. If either section gains a dark rubric later, it needs a
   different colour rather than a darker ochre.
4. **The serif is display-only.** Instrument Serif is used at 22px and above; below that it becomes
   Archivo. Small serif headings in table cells would look like a different document.
5. **The in-flight indicator is one shell-level "Saving" state**, not a per-button spinner; commands
   are serialised, so one honest signal is enough, but a slow form cannot say which field it waits on.
6. **Charts are absent by design**; RPT-02/RPT-03 need history this installation does not collect.
7. **The portals were re-skinned, not restructured.** Their tasks (one run, one account) are already
   single-purpose; they carry the rubric and the rules but keep their original body layout.
8. **Bands still bear the label above the work** rather than in a left column, which is the
   editorial choice; on the longest forms (Settings) that makes the page taller than a two-column
   form would be. It is a trade of vertical space for a readable measure.
