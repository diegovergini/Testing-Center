# Testing Center

Product and process validation management for exhaust systems: a catalogue of physical tests
with cost and run time, and automatic rig scheduling from the moment the need for each test
is confirmed.

The cycle goes like this:

```
Test catalogue ──► "Confirm need" ──► Request ──► Schedule (Gantt)
  cost and duration    LTI, customer,    queue by     allocated to the machine
  per procedure        part, class, due  priority     within the constraints
```

## How to run it

A static application, with no build step and no dependencies:

```bash
npm run serve        # http://localhost:8080
```

Any static file server will do (`python3 -m http.server`, Nginx, GitHub Pages). Opening
`index.html` straight from the file system also works, but some browsers block `localStorage`
on `file://` and the data does not persist — prefer serving over HTTP.

Scheduling engine tests:

```bash
npm test
```

Build the distribution files:

```bash
node build.js
```

## Publishing for the team

The data lives in the `localStorage` **of each person's browser**. Hosting the file does not,
by itself, share anything: ten people opening the same address would see ten independent
schedules. Until there is a server, sharing is done by snapshot.

1. Whoever keeps the test centre clicks **Export backup** and saves the JSON as
   `dados/instantaneo.json`.
2. `node build.js` produces **`dist/testing-center-equipe.html`** with that data embedded.
3. That file goes wherever the team can reach it — a SharePoint library, a network folder, an
   internal web server. It is a single HTML file, with no installation and no external
   dependency.

In the team copy the application reads from the embedded snapshot, **ignores `localStorage`
and writes nothing**: everyone sees exactly the same data, and the sidebar shows that
snapshot's date so nobody decides on top of a stale schedule without noticing. No screen is
editable — the create, edit and confirm-need buttons do not appear — and the role selector
still works for choosing which set of screens to look at.

Updating means repeating the three steps. Without `dados/instantaneo.json` the build ships the
seed catalogue, which is enough to demonstrate the platform.

The snapshot carries real data — labour hours, consumables cost, requests and quotes. Decide
deliberately whether it should be versioned along with the code or kept out of the repository.

This is a stage, not the destination: one editor and many readers. Several users editing at
the same time requires shared data, sign-in and real permissions. Two paths were assessed:

* [docs/power-platform.md](docs/power-platform.md) — **the chosen path**: SharePoint Lists as
  the database, a Power App as the interface, Office Script carrying the current scheduling
  engine. Company-standard tooling only, with the test area owning the tool.
  `node ferramentas/exportar-listas.js` already produces the CSVs that load the lists.
  [docs/power-app-v1.md](docs/power-app-v1.md) is the build guide for the first version of the
  app — catalogue, new request, request list — with a design system matched to this app's own
  palette and every screen's Power Fx written out.
  [docs/power-automate-agendamento.md](docs/power-automate-agendamento.md) is the next step:
  the scheduling engine as an Office Script (`ferramentas/agendador-office-script.ts`, a port of
  `src/scheduler.js` kept honest by a parity test) and the flow that calls it.
* [docs/hospedagem.md](docs/hospedagem.md) — Azure App Service + Entra ID + PostgreSQL.
  Technically better, but it depends on provisioning and on IT taking on code support.

## The three scheduling constraints

When you confirm the need for a test, the engine looks for the first free slot, respecting,
in this order:

1. **Sample availability** — no test starts before the sample arrival date, given on the
   request itself (the same part type arrives on different dates depending on the customer and
   the programme).
2. **Equipment availability** — each machine has a number of parallel positions, a calendar
   (weekdays and hours per day, or a continuous 24 h regime) and maintenance windows. A test
   never runs across scheduled downtime. The procedure asks for a rig **group**, and the
   scheduler picks the unit within it that frees up first. A procedure can occupy **more than
   one group at once**: then the slot has to be free on all of them simultaneously, and the
   pace is set by the rig with the shortest shift — 500 h on a 24 h/day dynamometer take 21
   days on their own, but 63 if the test also holds an 8 h/day rig.
3. **Queue** — requests are ordered by priority, then by customer due date, then by creation
   order. A request with a forced start date takes its position ahead of all of them.

Duration in days comes from the procedure hours divided by the equipment regime: a 72 h test
takes 3 days in a continuous chamber and 9 days on an 8 h/day rig. Non-working days inside the
window still hold the position, because the part stays mounted.

## Screens

| Screen | What for |
| --- | --- |
| **Quotes** | Budgets asked for by product engineering: pick the tests, the platform builds the cost table, archives it and exports it to Excel. |
| **Test catalogue** | Every procedure by system end (Hot End / Cold End) and customer, with its current revision, rig hours and estimated cost. This is where the need for a test is confirmed. |
| **Requests** | The queue of confirmed tests with the LTI number, project, part number, the computed slot, spare time against the due date, cost and status. Exports CSV. |
| **Schedule** | A Gantt per machine and position, with utilisation, maintenance downtime and anything past its due date called out. |
| **Dashboard** | Cost and hours by customer, phase and system end; the next 30 days; points needing attention. |
| **Customers** | Whoever requires the validation, with required procedures, part types and the cost committed to each one. |
| **Equipment** | Installed capacity: group, positions, calendar and downtime. A schedule constraint, not a cost one. |
| **Parts and samples** | The part types the lab tests, with the unit cost per sample and the accumulated consumption. |
| **Calibration** | The inventory of sensors and instruments, each calibration's validity, what falls due this month and what has already expired while in use. |
| **Roles and permissions** | The matrix of who sees and who edits each screen. |

## Roles and permissions

Two roles use the platform:

* **Product Engineer** — the internal customer. Asks for quotes and opens test requests. Sees
  the catalogue and the schedule but does not change them; has no access to the registers or
  the KPIs.
* **Test Engineer** — keeps the catalogue and the registers, runs the lab and follows the
  KPIs. Has access to everything.

| Screen | Product | Testing |
| --- | --- | --- |
| Test catalogue | view | view + edit |
| Quotes | view + edit | view + edit |
| Requests | view + edit | view + edit |
| Schedule | view | view + edit |
| Dashboard (KPIs) | — | view + edit |
| Customers, Equipment, Parts | — | view + edit |
| Roles and permissions | — | view + edit |

The matrix is editable in *Roles and permissions*, and ticking **edit** turns **view** on with
it. Anyone without edit permission sees the screen with a read-only badge and no action
buttons.

> **This is not access control.** With no server, the role is a choice made by the interface
> itself: it organises the work and prevents accidental edits, but anyone who opens the
> console or the JSON backup reaches everything. Real authentication needs a back end — the
> same swap of `src/store.js` for an API described under *Data*.

## Quotes

The product engineer enters the LTI, the customer, the project, the part number, who
requested it and the planned execution date; picks the procedures and, for each one, how many
samples will be tested. The platform builds the table with the cost of each test — hours,
hourly rate, consumables, unit cost, samples and total — plus the grand total.

**The number of samples multiplies the procedure cost**, because each sample is one run on the
rig. The field comes pre-filled with the procedure's default from the catalogue.

As the list of procedures grows, the *tests to quote* panel has three filters that combine:
free search (name, code, standard), **customer** (shows the procedures it requires plus the
lab standards) and **LTI** (shows the procedures already requested under that work order).
They start neutral, and anything already ticked stays visible even if the filter changes —
nothing drops out of the total without you seeing it.

Each quote gets a sequential number (`COT-2026-0001`), stays archived on the platform with a
status (draft, sent, approved, declined) and comes out in **Excel** (a real `.xlsx`, generated
with no dependencies).

**Prices are frozen in the quote.** Changing the hourly rate in the catalogue later does not
rewrite a budget already delivered — the quote keeps a copy of the values of the day it was
generated, procedure revision included.

## Project phases

There are three: **DV** (Design Validation), **PV** (Process Validation) and **VAVE**
(revalidation after a material, process or cost change).

The phase does **not** classify the procedure — any test in the catalogue can run in any
phase. It classifies the LTI that opens the request.

Data saved by earlier versions, which used Conceito, PPAP and Série, is converted on load:
Conceito becomes DV, PPAP becomes PV and Série becomes VAVE.

## Catalogue, equipment and parts

The seed catalogue carries the procedures per customer, transcribed from each one's
specification with name, standard and revision 1: **11 from GM** (`TP-GM-01` to `TP-GM-11`),
**30 from Stellantis** (`TP-STL-01` to `TP-STL-30`), **11 from Ford** (`TP-FRD-01` to
`TP-FRD-11`), **4 from Volkswagen** (`TP-VW-01` to `TP-VW-04`), **9 from Hyundai**
(`TP-HYU-01` to `TP-HYU-09`), **4 from RSA** (`TP-RSA-01` to `TP-RSA-04`) and **4 from
Nissan** (`TP-NIS-01` to `TP-NIS-04`).
In the customer register, `CLI-FRD` is Ford and `CLI-FOR` is Forvia Faurecia — different
companies. The remaining fields — equipment, hours, hourly rate, consumables, system end and
samples — arrive blank for the test engineer to fill in: until that happens the procedure
shows up flagged as *no equipment* with a cost of R$ 0, and a request on it stays blocked in
the schedule with the reason *procedure with no equipment defined*.

The **catalogue** holds the procedure with its **current revision** (`Rev. 01`), the standard,
the system end, the equipment it occupies, the hours (setup, test and reporting), the hourly
rate and the consumables cost. The revision follows the procedure across the whole application
— table, request, Gantt and CSV — so there is never any doubt about which version was run.

### Rig maintenance

Each downtime has two lives. It starts **planned** — and already blocks the calendar, because
no test is scheduled across downtime — and is closed with the **record of what was done**, at
which point it becomes **carried out**. Recording requires the description: it is the rig's
history.

The Equipment screen shows, per unit, the **last maintenance** (date, type, how many days ago
and what was done) and the **next planned one** (date, type and in how many days). At the top
are the outstanding items: downtimes past their date with no record, one by one, and a single
line with the machines that have no next maintenance scheduled.

A planned downtime that has passed does **not** become "the next one": it is overdue, and it
stays separate until someone records what was done or removes it. The dates can change when
recording — maintenance rarely ends on the day it was planned to.

### Instrument calibration

The **Calibration** screen starts from the test centre inventory: **229 instruments** —
accelerometers, load cells, thermocouples, pressure transducers, rig acquisition channels —
with code, brand, model, serial, range, resolution, station and the **date of each one's last
calibration**, already transcribed from the laboratory spreadsheet.

Validity comes from the **last calibration plus the interval** (12 months by default,
adjustable per instrument), unless the certificate carries a **date of its own** — then that
one wins. Each instrument falls into one of four due statuses:

* **Expired** — past its validity.
* **Due soon** — falls due within the next 30 days; the queue of whoever sends instruments to
  the laboratory.
* **In date**.
* **No plan** — nobody has said when it was last calibrated. Not the same as expired: it is a
  gap in the register, and it applies to instruments added after the seed inventory.

The top of the screen calls out the serious case: **an instrument expired and in use**. It
means a test running on an out-of-date measurement — the finding an audit looks for. An
expired instrument that is a back-up or out of service still shows, but not in the red alert.

**Bulk-enter dates** exists because there are 229 instruments: paste the slice of the
spreadsheet — code in the first column, last calibration date in the second, certificate and
laboratory optional in the third and fourth — and the platform checks it row by row **before
saving anything**. Dates as `31/12/2025` or `2025-12-31`; the legacy code is recognised too.
Whatever cannot be entered shows up with its row number and the reason (code does not exist,
impossible date, code repeated in the paste) and is ignored, without stopping the rest. A date
entered in bulk does not change the instrument's condition: whatever is *being calibrated*
stays being calibrated.

Recording a calibration saves the date, result, certificate, laboratory and who carried it
out, and renews the validity. **A failed calibration renews nothing**: the instrument leaves
service and is left with no plan until someone decides between adjustment, repair or scrapping
— without that rule it would show as "in date" precisely because it failed. Every certificate
stays in the instrument's history.

The **equipment** entries are the lab's real rigs: Burner 1/2/3, Shaker, MTS 1/2/3/4,
LMS / PTA, ColdFlow and Dynamometer. Each has parallel positions and a calendar — schedule
constraints, not cost ones.

Units that do the same thing sit in a **group**: `Burner` gathers the three, `MTS` the four.
The procedure asks for the group, never the unit — the machine is chosen by the scheduler,
always the one that frees up first (a tie on the start goes to the one that finishes earlier).
That way three Burner tests run in parallel on the three units, and the fourth picks up on the
first one to free. A rig with no group defined forms a group of its own.

A procedure can tick several groups: the test then reserves one unit of each and shows on
every matching Gantt row.

The **part types** are generic — Hot End, Canning, Cold End, Muffler and Component. They
belong neither to a customer nor to a system end: any customer can bring a sample of any type.
Only the unit cost per sample comes from the part type; the arrival date belongs to the
request.

## LTI (work order)

Every request carries the number of the LTI that opened it and a classification:

* **DV, PV or VAVE** — enters the schedule normally: it reserves a rig, competes in the queue
  by priority and due date, and shows on the Gantt.
* **Quote** — a budget, not yet confirmed work. Cost and duration are worked out the same way,
  to give the amount to quote, but the request reserves no rig, does not show on the Gantt and
  does not count as "no slot" on the dashboard.

When a quote LTI becomes actual work, edit the request and change the classification to DV, PV
or VAVE — it joins the queue and gets a slot at the next reschedule.

Besides the LTI, the request records the **project** and the **part number** of the part
tested. The project field suggests projects already used, so the same programme does not end
up spelled three different ways, and the project name follows the procedure on the Gantt bar.

## Required fields

Both forms demand to be filled in completely, so that neither a request nor a procedure gets
in half-done:

* **New procedure** — every field. The only exception is *required by customers*: leaving it
  blank is what marks the procedure as a lab standard, valid for every customer. The code is
  also checked against duplicates.
* **Confirm test need** — every field except *force start*, which exists precisely for the
  exceptional case of pinning a date by hand.

## The workflows

Two state machines in `src/fluxo.js`: which states exist, **who can make each move** and what
has to be filled in for the move to count. The interface only draws the buttons the workflow
authorises for the role in use — the rule is not scattered across the screens.

### Test request

```
                    Product Engineering asks
                              │
        SOLICITADA ──accept (Testing)──► ACEITA ──start (Testing)──► EM_EXECUCAO
                                                                          │ completion (Testing)
                                                                          ▼
      VALIDADA ◄──sign-off (Product)── RELATORIO_ENVIADO ◄──sent (Testing)── CONCLUIDA
                                              │  ▲
                             rework (Product) │  │ resend (Testing)
                                              ▼  │
                                          EM_CORRECAO
```

**Whoever runs the test does not sign off their own report.** Sending the report belongs to
the test centre; signing it off or sending it back belongs to the internal customer. Each
return counts one rework round — that is where right first time comes from.

Only **SOLICITADA, ACEITA and EM_EXECUCAO** compete for a rig; the scheduler reads that list
from the workflow itself. Cancelling is possible until the test finishes: after that it has
already cost rig time.

### Quote

```
   RASCUNHO ──send (Product)──► SOLICITADA ──review (Testing)──► EM_ANALISE
                                     ▲                                │
                    resend (Product) │                                │ confirm (Testing)
                                     └──── DEVOLVIDA ◄────────────────┤
                                                                      ▼
                                          APROVADA / RECUSADA ◄── VALIDADA
                                             (Product decides)
```

The test centre confirms the price but **does not approve on the customer's behalf**: the
decision goes back to whoever asked. Returning and declining require a justification.

### What each move requires

| Move | Requires |
|---|---|
| Complete test | The completion date — without it the test enters no month on the dashboard |
| Send report | The report attached to the request |
| Sign off report | The customer sign-off date |
| Request rework, cancel, return, decline | A justification, which goes into the history |

**History per record.** Each move saves a line with the date, from/to, role and note. It is
what makes a request auditable months later without relying on anyone's memory. It shows on
the request form and in the quote detail.

The status is **not an editable field**: it only changes through the workflow buttons. That
stops anyone marking something "completed" without going through execution, and guarantees
every step leaves a trail.

## Documents

Requests and instruments accept attached documents. An attachment is a **reference, not the
file**: name, link, who attached it and when. The file stays where the company already keeps
documents — SharePoint, OneDrive, a network drive — which is where version control and
retention apply. The whole platform fits in a JSON of a few MB in the browser; a PDF report
would not.

| Type | Screen | Who usually attaches it |
|---|---|---|
| Test input | Request | The requester — the specification of what they want tested |
| Test report | Request | Test engineer |
| Test evidence | Request | Test engineer — raw data, photos, rig acquisition |
| Calibration certificate | Calibration | Test engineer |
| Other document | Both | Anyone |

The type comes pre-suggested from the role in use, but it does not block: whoever can edit the
screen can attach any type.

**Sending the report requires the report to be attached.** Without it the customer gets a
status and nothing to read, and right first time starts counting a delivery nobody can open.

**Only http, https and network path links get in** (`\\server\folder\file.pdf` or `file://`).
An address pasted with no scheme gets `https://` when it has a host and a path. Any other
scheme is refused — the link becomes an `href` on a screen someone else opens, and
`javascript:` there would run code instead of opening a document. A network path is shown to
be copied, not as a clickable link: the browser blocks navigation from a page to the file
system.

Attaching saves at once, without waiting for the screen's **Save** — the document belongs to
the record, not to the edit in progress. Removing takes away only the reference; the file
stays where it was.

On the **Calibration** screen, the *Certificate link* field of the **Calibrate** button
attaches the PDF already tied to that history record, and the certificate number becomes
clickable in the table. A badly pasted link does not bring down the calibration record: the
calibration happened anyway, and the refusal is noted in the observation.

## Test centre dashboard

The management indicators, with a reference-month selector. The arithmetic lives in
`src/kpi.js` — a pure module covered by tests, so that no KPI definition ends up hidden inside
HTML.

| Indicator | How it is measured |
|---|---|
| **Tests carried out in the month** | Completed requests whose **completion date** falls in the month |
| **Rig hours in the month** | Hours the schedule reserved in the month, against the fleet capacity |
| **Right first time** | Reports signed off by the customer in the month **with no rework round** |
| **Scheduled in the year** | Cost and hours of the tests whose slot starts in the year |
| **Utilisation by equipment** | Per unit: hours scheduled ÷ hours that rig has in the month |
| **Cost by project / by customer** | Every confirmed job, run or not; quotes stay out |

Three decisions worth recording:

**A test that spans a month boundary is apportioned.** A 47-day test on the Burner does not
dump 1,113 h into a single month: the hours are spread across the operating days that fall in
each month.

**A test that occupies two rigs counts on both.** That is what actually happens to their
calendars — both are held for the same time.

**Capacity subtracts maintenance.** The month's available hours are the days the rig operates,
minus scheduled downtime, times the shift, times the parallel positions.

The dashboard adds up what has already been run: a completed request leaves the schedule (it
no longer competes for a rig) but stays in the cost by project and by customer.

### Where the dashboard data comes from

From the workflow. The completion and sign-off dates are asked for in the state move itself,
and the rework rounds are counted automatically at each return — nobody types an indicator by
hand.

Without a completion date, a test that was run cannot be assigned to any month. The dashboard
does not guess: it shows a warning with the LTIs still to be filled in.

## Cost model

```
procedure cost = (setup + test + reporting hours) × hourly rate
               + consumables cost

request cost   = procedure cost
               + samples × unit cost of the part type
```

**The hourly rate is a single value, belonging to the test centre**, not a field on each
procedure: it does not vary by test and is only revised once a year. It lives in the
application state (`hourlyRate` and `hourlyRateVigencia`) and is changed in a single field, on
the *Hourly rate* tile of the catalogue — one revision reprices all 73 procedures at once. It
is the lab's full rate, which is why equipment has no hourly cost of its own: the same hour
cannot be charged twice.

Hours and consumables cost belong to the procedure; the unit cost per sample belongs to the
part type.

**An archived quote is not repriced.** Each line item keeps the hourly rate of the day it was
quoted, so next year's revision does not rewrite a budget already delivered.

**Reporting hours count towards cost but not towards the calendar.** Writing the report is
desk work: it goes on the invoice, it does not hold the rig. What defines the slot on the
Gantt is setup + test.

## Data

The state lives in the browser's `localStorage`. The catalogue that ships with it (73
procedures, 11 machines, 5 part types, 9 customers, 229 instruments) is a starting point —
everything is editable through the interface.

**Catalogue changes.** `TC.data.CATALOGO_VERSAO` marks the version of the seed catalogue. When
that number goes up, whoever already had data saved in the browser receives the new procedures
on the next load (`migrar()` in `src/store.js`):

* **Additive, from version 2 on.** Procedures that do not exist yet go in; the ones already in
  the catalogue stay as they are, with the hours, hourly rate and rig already filled in.
  Nothing the user registered is overwritten.
* **Replacement, only up to version 2.** Data older than that carries the multi-customer
  example catalogue, which goes out whole; requests for procedures that no longer exist are
  discarded, because without a procedure they have neither cost nor rig.

**Instrument inventory.** `TC.data.INSTRUMENTOS_VERSAO` does the same for the calibration
inventory, always additively: instruments that do not exist yet go in, and the plan already
filled in (last calibration, interval, certificate, history) is never overwritten. Version 2
added each instrument's last calibration date; whoever already had saved data receives the
date only where it was blank and there was no history — whoever entered it on the platform
knows more than the spreadsheet does.

Either way, archived quotes stay intact (they have frozen prices) and the equipment, part
type, customer and permission registers are untouched — only a customer required by a new
procedure is added, if it is not on the list yet.

* **Export backup** writes a JSON with the whole state.
* **Import backup** restores that JSON, on another machine as well.
* **Restore defaults** goes back to the seed catalogue and erases the requests.

Since there is no server, the backup is the mechanism for sharing between people. If more than
one user needs to see the same schedule at the same time, the natural next step is to swap
`src/store.js` for an API — the rest of the code does not depend on where the data lives.

## Language

The interface, the seed content and the export headers are in English, the company's official
language. Instrument codes, brands, models and serial numbers are kept exactly as issued, and
the procedure names and standards come from each customer's specification.

The code identifiers (`demanda`, `cotacao`, `instrumento`) and the state keys saved in the
browser (`EM_USO`, `SOLICITADA`, `RELATORIO_ENVIADO`) stay as they are: they are keys, not
text, and renaming them would break data already saved without changing anything anyone sees.

## Code layout

```
index.html            loads the scripts in order; no bundler
assets/styles.css     light/dark theme
src/util.js           UTC dates, currency, HTML escaping
docs/hospedagem.md    where to host and how to control access (a document for IT)
docs/power-platform.md   the SharePoint + Power Platform migration path
docs/power-app-v1.md     Power App v1 build guide: design tokens and every screen's Power Fx
docs/power-automate-agendamento.md  step 3: the Office Script and the flow that runs it
docs/power-automate-calibracao.md   the weekly calibration alert (needs no Office Scripts)
src/fluxo.js          the request and quote workflows: states, who moves them, what they require
src/manutencao.js     each rig's last and next maintenance, and what is overdue
src/calibracao.js     instrument validity, due dates and criticality
src/documentos.js     attached documents: link parsing and record building
src/kpi.js            the dashboard indicators
src/data.js           seed catalogue (customers, equipment, tests, part types)
src/instrumentos-padrao.js  seed inventory: 229 sensors and instruments
src/scheduler.js      allocation engine and cost calculation — no DOM dependency
src/permissoes.js     the role in use and what it views/edits
src/xlsx.js           .xlsx generator (ZIP + XML) with no dependencies
src/store.js          state, persistence and CRUD
src/ui.js             modal, toasts, tags
src/views/*.js        one screen per file
build.js              produces the single-file versions in dist/
src/app.js            navigation and schedule recalculation
tests/                engine tests (node:test)
ferramentas/listas-schema.json   the SharePoint list schema: the single source of truth
ferramentas/exportar-listas.js   generates the load CSVs from that schema
ferramentas/provisionar-listas.ps1  creates the lists on the site from that same schema
ferramentas/agendador-office-script.ts  the scheduling engine as an Office Script
```

`src/scheduler.js` is pure and also runs on Node, which is why the allocation rules are
covered by tests: parallel capacity, maintenance, weekends, priority, due date, forced start
and cost calculation.
