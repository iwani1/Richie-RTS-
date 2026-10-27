# Interface design: research, decision and system

This is the design record for the Richie Transport Services application. It explains what the interface
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

The conclusion that drove everything else: **this is a work surface, not a pitch deck.** The people
using it already know what a timetable, a route card, a licence and an invoice look like; they need the
broken things first, a way to act on each, and a record of what changed. The interface therefore
opens on the day's exceptions and today's runs rather than on a wall of totals, and every figure is
accompanied by the sentence that qualifies it. Colour means state or action; it never decorates.

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
| **Refero Styles** — styles.refero.design | Style library index with named directions (e.g. "serif analytics on warm paper", "editorial finance desk", "dense marketplace") | Editorial finance density (Ramp) and dense marketplace tables: compact rows, tabular figures, one accent. These survived into the final direction. | Dark *terminal* directions and cinematic styles were rejected as wrong for daylight and for printing. The shipped direction keeps the density lesson — compact rows, tabular figures, one accent — and drops the serif: the owner rejected the editorial build and chose the Daylight SaaS direction in §2a. |
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

## 2a. Three directions built, E chosen and applied

After the editorial direction was rejected as "not redesigned", the owner supplied three references —
the Dribbble *transport management system* tag, the Behance *transport management system* search and
Wialon — and asked for three new templates. Their common language is the fleet-SaaS / telematics
idiom: a grouped sidebar, a canvas of soft cards, status pills, sparklines, a run timeline and a
right-hand rail of exceptions. Three complete directions were built in `docs/templates/`, each with a
different *skeleton*, not a different palette:

| Direction | File | Skeleton | Where it wins |
|---|---|---|---|
| **D · Nightshift** | `docs/templates/d-nightshift.html` | 60px icon rail + 236px navigator + one live board; per-vehicle run timeline with a "now" cursor, exception table, readiness ring | A dispatch room in the evening; the whole day on one screen. |
| **E · Daylight** | `docs/templates/e-daylight.html` | White 256px sidebar with count badges; canvas of soft cards; stat cards with sparklines, run timeline, rentals table, readiness donut, due-this-week checklist | Daylight, printouts, first-time users, and the manager who reads rather than watches. |
| **F · Command map** | `docs/templates/f-commandmap.html` | No page frame: a map canvas with floating header pill, floating unit list, selected trip with a stop rail, exception dock | Answering "where is my bus", and anything watched rather than read. |

The owner chose **E · Daylight**, and the application was rebuilt in it rather than re-skinned: the
shell, the dashboard, the sign-in and first-run screens are new markup; every other screen keeps its
behaviour and inherits the new system through the shared primitives and the stylesheet. D and F remain
in `docs/templates/` as history.

## 3. Alternatives considered

The direction had already been through three built templates — **A · Waybill** (warm paper, serif,
ruled bands), **B · Control room** (dark board, split-flap times) and **C · Statement** (cool white,
hairlines, right-aligned figures). B shipped, and was rejected in one line: *"i want to change the
whole ui. dont use anything from the demo app"*.

| Direction | What it was | Why it lost |
|---|---|---|
| **A · Waybill** | Warm paper, serif display, ruled bands, square corners | Rejected as still reading as a printed document rather than software. |
| **B · Control room** | Dark board, split-flap times, lime and violet | Rejected as the wrong metaphor for a daylight office; the owner asked for "pro" transport software. |
| **C · Statement** | Cool white, hairlines, right-aligned figures | Never shipped: it was the third option while the owner asked for new templates. |
| **D · Nightshift** | Dark shell, lime accent, live run board | Strong for a night desk, but a dark screen all day in an office, and the owner wanted light. |
| **F · Command map** | Map-first console | The installation has no GPS feed, so a map would have been decoration over an empty canvas. |

**E was chosen because it is the only direction that reads as daylight, stays legible when printed,
gives fourteen destinations a fixed place with a live count, and does not depend on data the
installation does not have.**

## 4. The direction: "Daylight"

A light operations workspace: a white sidebar, a canvas of soft cards at one shadow level, an indigo
accent for anything actionable, and status as a soft pill. It is the idiom of commercial fleet
software, not of a document.

**Identity rules**

- **One canvas, one card level.** Canvas `#f5f6f9`, card `#ffffff`, hairline `#e7e9ef`. Anything on
  the canvas casts the same shadow; anything inside a card casts none. There is no second elevation.
- **One accent for action.** Indigo `#4453f0` marks the primary button, the active destination, a link
  and a focus ring. It never becomes a background wash, a chart series or a heading.
- **Status is a pill, and the pill carries its word.** Green, amber and red appear as a tint plus a
  6px dot plus the state in words. Colour is never the only carrier.
- **Cards have one head and one body.** Title (14px, 660), one line of qualifying text, the action at
  the right, an 1px rule, then the body. No nested cards.
- **One type family.** Inter Variable for every word and figure, Plex Mono only for machine data —
  references, plates, times, money in tables. Figures are tabular.
- **Radii and edges.** 14px cards, 10px controls, 8px chips, 20px pills. A hairline plus a 1px shadow
  is the edge. Nothing is translucent and nothing is blurred: the top bar, the scrims and the palette
  are all opaque, so a table scrolling underneath never shows through a frame.
- **Numbers are evidence.** Every card says what it counts and over what period, or says that it
  cannot.

**Layout grammar**

- **Sidebar (256px, 232px ≤1280px).** Brand and the installation name, a workspace line, then five
  named groups of destinations. A group shows only destinations the role can read. An outstanding
  count sits beside Rentals, Busing, Logistics, Compliance, Readiness and Settings; a zero is not
  drawn. At the foot: the palette shortcut, the live clock and date, the signed-in operator, sign out.
- **Top bar (60px, sticky, solid).** Breadcrumb (`Operations / Dashboard`) at the left, the in-flight
  "Saving" pill and the palette trigger (`Ctrl K`) at the right. Opaque, so nothing scrolls through it.
- **Page head.** Eyebrow in the section colour, a display greeting at 25px with the company name
  beneath it, one qualifying sentence, then the page action at the right.
- **Overview.** Four stat cards, each with a label, a status chip, a figure with its denominator, a
  sentence of qualification and — where trips are recorded — a seven-day bar series. Below them a
  1.55fr/1fr spread: needs-attention list, today's run sheet and rentals on the left; readiness ring,
  setup checklist and quick actions in the right rail.
- **Registers are one card each.** A register card carries its title and the sentence that counts its
  rows, a filter row inside the card (search and, where it exists, a status filter, with the
  supporting count at the right), then the table flush to the card's edges with a sticky header. A
  table that is not already inside a card gets the same edge from the stylesheet, so no screen shows
  a table dropped on the canvas.
- **Everywhere else.** Rentals keep their five-step state strip and list in a register card; busing
  keeps the run sheet as a card with the dispatch desk beside it; logistics keeps incidents beside
  work orders and the cost statement; readiness keeps interval bars; settings keeps one card per rule.
- **Width.** Content is capped at 1440px with a 28px gutter; the spread collapses at 1180px and the
  sidebar becomes a drawer at 980px.

**Motion** — 120–180ms on background, border and colour for hover and for the panel slide; nothing
moves while someone types. `prefers-reduced-motion: reduce` removes what is left.

## 5. Design system

**Colour tokens** (WCAG relative luminance; card `#ffffff` / canvas `#f5f6f9`)

| Token | Value | Card | Canvas | Use |
|---|---|---|---|---|
| `--ink` | `#0f172a` | 17.85 | 16.52 | Headings, figures, table keys |
| `--ink-2` | `#3d4759` | 9.36 | 8.66 | Body text, cells |
| `--muted` | `#667085` | 4.97 | 4.60 | Captions, notes, hints |
| `--muted-2` | `#5f6a7d` | 5.46 | 5.05 | Table headers |
| `--accent` | `#4453f0` | 5.61 | 5.19 | Actions, active destination, links |
| `--green-ink` | `#0b7d4e` | — | — | Success words on `#e8f7f0` (4.68) |
| `--amber-ink` | `#8a5606` | — | — | Warning words on `#fdf3e3` (5.60) |
| `--red-ink` | `#b42318` | — | — | Error words on `#fdecea` (5.75) |
| `--green` / `--amber` / `--red` | `#0f9d63` / `#b8730b` / `#d92d20` | 3.49 / 3.82 / 4.83 | — | **Graphics only**: ring segments, dots, bars, rules |
| `--line` / `--line-2` | `#e7e9ef` / `#dfe3ea` | 1.21 / 1.29 | — | Hairlines, never text |

Two families of colour, one rule: the vivid values pass 3:1 and are used for marks; the `*-ink`
values pass 4.5:1 and are used for words. `--faint` (`#98a2b3`) survives as an edge token only —
group labels, placeholders and footnotes were moved to `--muted` so nothing readable sits below 4.5:1.

There is **no** per-destination colour. An earlier pass gave each section its own hue; that map is
gone, and `--accent` is now the only accent in the sheet. A destination is not a category, and a
second colour competing with the primary button made "what do I press here" harder to answer.

**Type** — Inter Variable, 13px base. Display 25 / 14 / 13.5px at 660–690 weight, tracking −0.015 to
−0.045em. Text 12.5 / 12 / 11.5 / 11px. Figures 29px in a stat card, 21px in a rail; `tabular-nums`
wherever a value can change. Labels 10–11.5px, 600, not uppercase except table headers and group
labels.

**Spacing** — 4/8/12/16/18/24/32px; 16px between cards, 18px inside one, 28px page gutter.
**Shadows** — one level: `0 1px 2px rgba(16,24,40,.04), 0 1px 1px rgba(16,24,40,.03), 0 12px 28px -22px rgba(16,24,40,.35)`.

**Compatibility.** Screens written in earlier passes use Tailwind's `stone`, `red`, `emerald` and
`lime` scales and the `--rts-*` aliases; `@theme` re-points those at the Daylight greys and indigo, and
the stylesheet re-skins every legacy `rts-*` class (`rts-band`, `rts-board`, `rts-meter`, `rts-steps`,
`rts-lead`…), so no screen renders an off-palette colour or an editorial radius.

**Copying a reference** — a small ghost button beside the number, its label "Copy" and then "Copied"
for four seconds, with a hidden live region naming what was copied. No tint, no tick, no animation;
the button holds a fixed width so a table cell does not shift while it changes word (D-111).

**Accessibility** — 2px indigo focus ring with 2px offset; skip link to `#main-content`;
`aria-current="page"` on the active destination; the ring and the bar series carry text alternatives
or are `aria-hidden` beside their numbers; state is never carried by colour alone; the drawer closes
from its own button, the scrim and Escape.

## 6. Screens and their intent

| Screen | Primary task | Highest priority | Layout |
|---|---|---|---|
| Sign in / first run | Establish identity, once | One statement, one form, one action | Two panels: a brand half on a soft canvas wash (headline, purpose, the three things the desk does) and the form on a card at the right; one column under 980px |
| Overview (dashboard) | Decide what to do next | Wrong today, then what leaves | Page head, four stat cards, then attention · run sheet · rentals beside a rail of readiness ring, setup checklist and quick actions |
| Registers (vehicles, drivers, clients) | Find and change one record | The record and what is wrong with it | Page head, then a register card: title and count, filters inside the card, sticky table header, side panel for the form. The vehicles register leads with a **56 × 40 thumbnail** (`object-fit: cover`) and the word *none* where nobody has filed a picture — never a broken image or an empty cell — and counts "N with no photograph" beside the other gaps. A **Today** column carries the brief's seven
states (D-109): the badge, the run / hire / work-order reference behind it in mono, the office's own
word beneath when the two disagree, and any commitment a blocking state is overriding as an amber line —
one cell that answers "what is this bus doing, and what does the register believe". The fleet is counted
by state in one line beside the search box, and the rule behind each state sits in a disclosure under
the table rather than only in the documentation. The photograph panel shows the picture at up to 320 px tall, contained rather than cropped, with its file name, its size and who filed it in one line of small print; removal asks for a reason in the same panel, because a picture taken off the register is a decision and not housekeeping (D-108) |
| Rentals | Move a request through its states | The state machine of the selected record | Request list in a register card; then a five-step strip, request and quote side by side, actions for that state |
| Busing | Run the day | Today's runs and the next action on each | Tabs, run sheet (departure in the gutter, route and crew in the middle, next action at the right), dispatch desk beside it. The planning aid sits inside the assign panel as one line of conclusion over three ranked pairs, each with its reason, and collapses what it cannot see behind a disclosure (D-96) |
| Logistics | Close the response to a breakdown | What is open and what it costs | Incidents beside the work orders they raise; the cost report as a statement with coverage figures |
| Compliance / Readiness | Prevent an unroadworthy dispatch | Expiry and overdue, soonest first | Summary cards, then **Renewals** — a card of the papers inside the lead time, lapsed first, each with its timing in words and either who has taken it on (one line: person, date, what they are doing, when they expect it) or the plain statement that nobody has — then the urgency-sorted register with interval bars per basis. The renewals panel is two fields, because a reminder that does not say what is being done and when it is expected is not a record of anything (D-110) |
| Settings | Supply the company's real rules | Nothing prefilled; what is still missing | "Rules to supply" read from the saved record, then one card per rule |
| Audit | Prove who changed what | Chronology and the actor | Dense table: mono timestamps, action as a chip, record named, "showing 17 of 412" |
| Command palette | Jump without the mouse | Destinations and their captions | Overlay, keyboard-first, permission-filtered, focus-trapped |
| Finance home | Decide what to do about the money | How bad the debt is, then what to chase | Page head, period, eight figures, then **debt by age** (four bands with a sentence each, and the customers behind them) above the overdue list, unbilled work, payments to check, revenue and spend. The oldest band is named, never only coloured |
| Invoices | Settle what is owed on one invoice | The balance and every action on it | Detail: notice, seven figures (total, received, credited, outstanding, refunded), line items, payments, credit notes, **refunds paid back** with their own numbers and reasons, then the document itself. A refund is recorded from here, in a panel that fills in what is still owed back |
| Expenses | Enter what the month actually cost | The period total, the biggest category, and what has no receipt | Period at the top, then four figures (recorded, biggest category, entries with no receipt number, receipts held), the register with receipts named per row, a category table beneath it, and a panel to record or void. A voided entry stays on the list, struck through, with its reason in words. Finance sees a **Scan** column — `Open scan` where an image is filed, `File scan` where it is not — and a **No scan on file** figure; that column is absent for a role that may not read the paper, rather than present and empty (D-100) |
| Statements | Chase what one customer owes | The balance and its age | Customer list ordered by what is owed beside the statement itself: five figures, the ageing bands in words, the entries in the period, the invoices still owing. Prints as the same A4 sheet as an invoice |
| My journeys (passenger portal) | Catch the bus, and know whether the seat is real | The next run, then what state each seat is in | Page head, then **your next journey** as four facts in a row (time, stop, bus, status) with the status sentence underneath; a request button and a report button; then the upcoming runs as a table whose status cell carries the label *and* the sentence that qualifies it; then **where you have been**; then the company's policy beside the reports the rider has raised. Limits are printed, not hidden (D-97) |
| Reports | Answer one of two questions, not both at once | The money, or the buses | Two tabs: **Hire and money** (the hire, financial and printed report) and **Staff transport** (RPT-02), the second offered only to a role that may read the roster. The staff tab: a service-date range, eight figures each with the sentence that qualifies it, then the seats asked for and why they were lost, by route, by client, and a card that names what the report cannot say beside the coverage counts (D-99) |
| Printed management report | Answer the same questions on paper | The period, then the money | A4 sheet: letterhead with the period and printing reference, a one-line state (complete, or withheld with the reason), eight figures in a four-across grid each with its qualifying sentence, then one section per question (customer, service, costs, money back out, why lost, utilisation, per-unit cost), the coverage counts, and the reading notes. Sections keep whole and a heading never sits alone at the foot of a page (D-98) |
| Printed invoice / credit note | Hand the customer a document | The figures and what is owed | A4 sheet in a preview overlay: letterhead and reference at the top, the line table, the totals in the lower right with the sentence that explains them beneath, footer with reference and print date. Print removes the app entirely |

**Paper is a different surface, and it has its own rules (D-87).** A sheet that becomes a physical
object a customer keeps cannot borrow the interface's tricks. It is white with dark ink whatever the
screen theme; it has no tints, no pills and no cards, because a tint that means "part paid" means
nothing once the customer is holding it. Status is a word. Columns of money sit in the monospaced face
and line up on the right so an amount can be followed down. The one accent appears once, as an
eyebrow over the document type and a hairline at the top of the sheet; in print the hairline goes and
toner is saved. Small print is darkened to stay above 4.5:1 on white. The preview is the same sheet at
screen scale, so what is approved on screen is what goes on the paper.

## 7. What was verified

- `tsc --noEmit` and `eslint .` are clean; `npm test` is **1045 passed, 28 skipped** across 90 files
  (the skips are the database integration suites, which need a live server); `next build` compiles.
- Every `rts-*` class used in `src/**/*.tsx` has a rule in `src/index.css` — checked by extracting the
  class names from the source and diffing them against the stylesheet. The only prefixes reported are
  `rts-badge--`, `rts-btn--` and similar, whose concrete variants all exist. Re-run while adding the
  printed sheet (D-87), it found one that did not: `.rts-summary`, used by the invoice and credit-note
  previews since Phase 16, had no rule at all. It now has one. The photograph (D-108) added two more,
  `.rts-thumb` and `.rts-photo`, both on the card ground so a picture with a transparent edge does not
  float on the canvas.
- Contrast: every text token measured against the card and the canvas (§5). No word sits below 4.5:1;
  the vivid semantic values are confined to graphics and pass 3:1.
- Fonts are self-hosted and imported once, in `src/app/layout.tsx`: Inter Variable for the interface,
  Plex Mono for machine data. Nothing is fetched from a third party at first paint.
- **The app starts empty.** A fresh database has no users; `/api/session` reports `setupRequired`, the
  first screen asks for the administrator, and Settings asks for the company's own rules. No screen
  carries a prefilled business fact; the preview data used to review the layout lives outside the
  repository and is disposable.
- Keyboard: skip link first in the DOM, palette on `Ctrl K`, Escape closes palette, panel and drawer.
- Reduced motion: transitions, the panel slide and the saving indicator are removed.
- Layout at 1440 / 1280 / 1180 / 980 / 700px was reasoned from the CSS and the DOM — **not** from
  screenshots: this environment has no browser binary. That remains a real gap (see §8).

## 8. Known limitations of this interface

1. **No screenshots.** Every judgement about proportion, alignment and rhythm is made from the CSS and
   the rendered DOM. The thing to do first on a workstation is open 1440 / 1024 / 390 and look at a
   stat card, a long run sheet and a side panel.
2. **The sparkline is real but short.** It draws the last seven service dates from recorded trips. A
   new installation therefore shows no series at all until trips exist — the card says so rather than
   drawing a flat line.
3. **Restricted figures are dashes.** A role that cannot read rentals or drivers sees `—` with the
   reason in words, not a hidden card. That is deliberate: a missing card reads as "not important".
4. **The readiness ring needs a configured interval.** Until service intervals are set, the card says
   readiness cannot be computed and links to the screen that fixes it; no ring is drawn.
5. **The top bar does not blur.** It is opaque by choice; a translucent bar over a scrolling table
   reads as a filter rather than a frame.
6. **Charts are absent by design** beyond the seven-day runs series. The staff transport report
   (RPT-02) prints counts that are small and exact — a bar beside "3 carried of 20 seats" would be
   decoration around a number that already fits — and the fleet-hours figure still has no screen
   because nothing records it.
7. **The printed report reuses the document sheet, not a second one.** The invoice, the credit note, the
   statement and the management report share `.rts-sheet`, so the paper a customer keeps and the paper a
   manager reads cannot drift apart in type, measure or margins (D-98). The report adds one thing the
   invoices do not need: it runs past one page, so a section is kept whole across a page break and a
   heading is never left alone at the foot of a sheet.
8. **The passenger portal's status is a word plus a sentence.** A rider reads "Bus assigned" and then
   "A bus and a driver are on this run. It has not been released to leave yet" — one word alone cannot
   distinguish a held seat with no bus from a bus that has not left, and colour is never the carrier
   (D-97). Its absent map is stated on the page rather than left blank, so silence is not read as a
   fault.
9. **The portals were re-skinned, not restructured.** Their tasks (one run, one account) are already
   single-purpose; they inherit the system and keep their body layout.
10. **Settings is one card per rule**, so on the longest form the page is taller than a two-column
   form would be. That is a trade of vertical space for a readable measure.
11. **The sidebar shows at most six counts.** Groups without an outstanding number stay silent; if
   more destinations gain counts, the sidebar needs a "see all" treatment rather than a wall of pills.
