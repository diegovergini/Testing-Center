# Testing Center on the company's own tooling: SharePoint + Power Platform

IT is not going to provision an App Service and a database, and does not want to take on
support for custom code. That is not a dead end: the company's own tooling — SharePoint,
Microsoft 365 and Power Apps — is enough for this platform, in a model where **the test area
owns the tool**, not IT. It is the *citizen developer* path, and this is exactly the case the
Power Platform exists for.

What actually changes: maintenance moves to tools the company already supports, sign-in and
permissions come from Microsoft 365, and nobody has to review server code because there is no
server.

## The architecture

```
SharePoint Lists            the data, in one place, with permissions and version history
        ▲
        │
Power App (canvas)          catalogue, requests and quotes — what the team uses every day
        │
Power Automate              quote numbering, notifications, export, schedule recalculation
        │
Office Script (TypeScript)  the scheduling engine and the cost calculation
```

**SharePoint Lists as the database.** Each entity becomes a list: procedures, customers,
equipment, part types, requests, quotes and quote line items. It is a real database at this
scale — typed columns, version history, per-list permissions, and native integration with
Power Apps, Power Automate, Power BI and Excel. A site owner creates all of it without asking
IT for anything.

**Power App as the interface.** It is where the product engineer opens a request and asks for
a quote, and the test engineer maintains the catalogue. It is published and shared through
Microsoft 365: whoever opens it is already authenticated, with MFA, and offboarding an
employee is automatic.

**Real permissions, at last.** Here they stop being screen guidance. The lists carry SharePoint
permissions, and the two roles become two Microsoft 365 groups: *Product Engineering* (reads
the catalogue, creates requests and quotes) and *Test Engineering* (edits the catalogue and
the registers, sees the KPIs). What a person can do becomes something the platform guarantees,
not something the interface suggests.

## The honest bit: the scheduling

Catalogue, requests and quotes are registers and forms — Power Apps does that well and fast.

What does **not** translate well into Power Fx is the scheduling engine: greedy day-by-day
allocation, picking the unit that frees up first inside the Burner or MTS group, a test that
occupies two rigs at the same time, each machine's calendar and maintenance. It is an
algorithm, and Power Fx is a formula language — no recursion, delegation limits, and a loop
over hundreds of combinations ends up slow and unreadable.

The way out is not to rewrite it: **Office Scripts runs TypeScript inside Microsoft 365** and
can be called from a Power Automate flow. The engine that already exists (`src/scheduler.js`,
covered by tests) migrates almost as it stands. The flow reads the requests and the equipment
from the lists, calls the script, and writes back onto each request the start date, the end
date, the allocated equipment or the blocking reason. It runs on every new request and once a
day.

That way the Power App does not need to know how to schedule: it reads the result already
computed, which is what the screen shows today.

**The Gantt** is the other thing to watch: there is no native Gantt control in Power Apps. The
options are an embedded **Power BI** (the Gantt visual exists, and Power BI reads SharePoint
lists directly) or a gallery drawn by hand in the Power App — it works, but it ends up simpler
than today's. My recommendation is Power BI: besides the Gantt, it delivers the test centre
KPIs with no extra work.

## What is ready

**The list schema and the data.** `node ferramentas/exportar-listas.js` produces, in
`dist/listas/`, one CSV per list, already carrying the 73 procedures, the 9 customers, the 11
machines, the 5 part types and the 229 instruments with their calibration dates — plus
requests and quotes, if you export a backup of your own.

`ferramentas/listas-schema.json` is the **single source of truth** for the columns: both the
CSV generator and the provisioning script read it, and `tests/listas.test.js` fails if the
header of any CSV drifts from it. That test exists because they did drift once — translating
the platform into English renamed the columns in the generator and not in the script, and
nothing would have failed until someone pasted data into the site.

### Creating the lists

Two ways:

1. **Through the interface**, installing nothing: on each list, *New list > From CSV*. Quick,
   but SharePoint guesses the types and usually makes everything text — dates, numbers and
   currency have to be fixed afterwards, by hand.
2. **With the script** `ferramentas/provisionar-listas.ps1` (PnP.PowerShell module, site owner
   permission), which creates the lists with the right types, sets the date columns to
   date-only and is idempotent — running it again adds nothing twice. `-Conferir` compares an
   existing site against the schema without changing anything.

```powershell
Install-Module PnP.PowerShell -Scope CurrentUser
.\ferramentas\provisionar-listas.ps1 -Site "https://company.sharepoint.com/sites/TestCentre"
.\ferramentas\provisionar-listas.ps1 -Site "..." -Conferir
```

### The lists

| List | Holds | Records today |
|---|---|---|
| `TC_Parametros` | Test centre hourly rate and the period it is in force for | 1 |
| `TC_Clientes` | Code, name and segment | 9 |
| `TC_Equipamentos` | Rigs, group, positions, regime and calendar | 11 |
| `TC_Manutencoes` | Downtime per machine: planned and carried out, with what was done | 0 |
| `TC_Instrumentos` | Sensor and instrument inventory, with the calibration plan | 229 |
| `TC_Calibracoes` | One record per certificate issued, with result and validity | 0 |
| `TC_Pecas` | Part types and cost per sample | 5 |
| `TC_Procedimentos` | The catalogue: standard, revision, hours, consumables, rig | 73 |
| `TC_Demandas` | The confirmed need and the scheduling result | 0 |
| `TC_Cotacoes` | Quote header | 0 |
| `TC_CotacaoItens` | Line items with the price frozen on the quote date | 0 |
| `TC_Historico` | One row per workflow move: from, to, who, when, note | 0 |
| `TC_Documentos` | Attached documents: type, link, who attached it and when | 0 |

The `Title` column holds the record code (`TP-GM-01`, `CLI-GM`, `COT-2026-0001`), which is how
the lists reference each other.

Multi-value fields — the customers that require a procedure, the rig groups it occupies at the
same time — are a text column with values separated by `; `.

**Column names avoid what SharePoint reserves.** `Name`, `Type`, `Order`, `Created`,
`Modified`, `Author`, `Editor` and `Version` are built-in internal names: creating a column
with one of them either fails or is silently renamed, and the mistake only turns up while
pasting the data. That is why the schema uses `EquipmentName`, `MaintenanceType`,
`InstrumentStatus` and so on. A test guards this.

**Choice values stay as the internal keys** (`EM_USO`, `SOLICITADA`, `RELATORIO_ENVIADO`), not
the English labels. They are what the engine and the saved data already use; the label belongs
to the screen, and in the Power App it is a display formula over the same key.

## The workflows on the Power Platform

Both workflows (`src/fluxo.js`) translate well, and this is where the Power Platform shines:

* **States and move permissions**: the Power App shows the buttons according to the Entra group
  the person belongs to — the same rule as today, now guaranteed by the platform.
* **Email notifications**: a Power Automate flow fires on each move. The customer is notified
  when the report is sent or the quote is confirmed; the test centre when a request is opened
  or rework is asked for. That is what today's version has no way of doing.
* **Native approvals**: signing off a report and approving a quote can become a Power Automate
  approval action, answered from Outlook or Teams without opening the app.
* **History**: each move becomes an item in `TC_Historico` (record, from, to, who, when, note)
  — the same content today's version keeps embedded.
* **Calibration due warning**: a scheduled flow sweeps `TC_Instrumentos` every Monday and sends
  whoever looks after metrology the list of what falls due this month. Today that alert only
  reaches whoever opens the calibration screen. With 69 instruments already expired on load,
  this is the flow worth building first.
* **Documents**: `TC_Documentos` holds the link, not the file. The natural move is a document
  library on the same site and the column pointing at it — and then "send report" can require
  the attachment the same way the platform does today.

## The path

1. **Create the site and the lists** and load the CSVs. No code; you can do it on your own.
2. **Power App v1**: catalogue, new request, request list. It already replaces the spreadsheet
   and already gives the sharing that is missing today. Full build guide, screen by screen,
   with every Power Fx formula: [docs/power-app-v1.md](power-app-v1.md).
3. **Scheduling**: Office Script with the current engine + a Power Automate flow that writes
   the result onto the requests. Both are written:
   [docs/power-automate-agendamento.md](power-automate-agendamento.md) has the flow step by step,
   and `ferramentas/agendador-office-script.ts` is the engine, kept honest by a parity test that
   fails if it places a single request differently from `src/scheduler.js`.
4. **Quotes**: the quote screen, automatic numbering by flow and Excel export (simpler here
   than today — Power Automate generates the file).
5. **Power BI**: Gantt and test centre KPIs.

From step 2 on I write all of it: the Power App formulas screen by screen, the Office Script,
the flows and the Power BI model. What I cannot do from here is click inside your tenant —
creating the site, importing the app and publishing stays with you, and I hand you the
step-by-step.

## Loading the data, step by step

Order matters: the lists reference each other by `Title`, so the referenced ones go in first.

1. `TC_Parametros`, `TC_Clientes`, `TC_Equipamentos`, `TC_Pecas` — no dependencies.
2. `TC_Procedimentos` — references customers and equipment groups.
3. `TC_Instrumentos` — no dependencies; **229 rows, the biggest load**.
4. `TC_Manutencoes`, `TC_Calibracoes` — reference equipment and instruments.
5. `TC_Demandas`, `TC_Cotacoes`, `TC_CotacaoItens`, `TC_Historico`, `TC_Documentos` — empty on
   a seed load; they carry data if you export a backup of your own first.

For each list: open it, switch to **grid view** (*Edit in grid view*), select the first cell of
the first empty row and paste the CSV **without the header row**. SharePoint fills the columns
in order.

Two things to check right after loading, because they are the ones that go wrong quietly:

* **The dates.** Open `TC_Instrumentos` and confirm `LastCalibration` on `TCL-AC-012` reads
  **14 May 2026**. If it comes out as 5 December, the site's regional format read the ISO date
  as month/day — set the site to English (United States) or load the dates as `yyyy-MM-dd`
  with the column already set to date-only.
* **The counts.** 229 instruments, 73 procedures, 11 machines, 9 customers, 5 part types. The
  grid view pastes silently up to its row limit; a short list means the paste was truncated
  and needs to be finished in a second block.

## Meanwhile

The team copy (`dist/testing-center-equipe.html`, see the README) still stands: it is
publishable today in a SharePoint library and already shows everyone the same data, read only.
It does not conflict with any of this — it disappears the day the Power App goes live.
