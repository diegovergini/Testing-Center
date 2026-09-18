# Step 5 — Power BI: the Gantt and the test centre KPIs

Power Apps has no Gantt control and no way to draw one that is worth looking at. Power BI has
one, reads SharePoint lists directly, and delivers the indicators the web version computes in
`src/kpi.js` with no extra plumbing. That is the whole case for this step.

This guide mirrors `src/kpi.js` measure for measure. Where a definition here differs from that
file, that file is right and this one is the copy — the definitions were argued out once and
should not be re-argued in DAX.

## Read this before anyone starts

**The Gantt needs step 3.** `PlannedStart`, `PlannedEnd` and `AllocatedEquipment` are written by
the scheduling flow. Until that flow has run at least once, every request has empty dates and the
Gantt is a blank page. Everything else in this guide — cost, queue, right-first-time, calibration
— works on the data as it stands today.

**Licensing, and it is worth settling first.** Power BI Desktop is free to build in. *Sharing* a
report with colleagues needs a **Power BI Pro** licence for the author **and for every viewer**,
unless the workspace sits on Fabric/Premium capacity. Embedding the report in the Power App does
not get around this — the viewer still needs Pro.

Confirm what the company actually has before the team plans around it. If Pro is not available
for everyone, the fallback is a Pro licence for the test centre only, exporting to PDF for the
rest, and it changes what is worth building.

## Build in this order

Four pages, in decreasing order of certainty:

1. **Queue and cost** — works today, no dependencies.
2. **Calibration** — works today, and is the page with 70 overdue instruments on it.
3. **Gantt** — after the scheduling flow has run.
4. **Rig utilisation** — the hard one. It is written up at the end, and it is fair to leave it
   out of the first delivery.

---

## Part A — connect the lists

In **Power BI Desktop**: *Home → Get data → SharePoint Online list*.

| Field | Value |
|---|---|
| Site URL | the site root — `https://forvia.sharepoint.com/sites/LimeiraTestingCenter` — **not** the URL of a list |
| Implementation | **2.0** |

> 2.0, not 1.0. The older implementation returns Choice columns as unusable nested records and
> does not honour the view's column set. If the navigator shows dozens of `OData__` columns, you
> are on 1.0.

Authenticate with **Microsoft account**, then tick:

`TC_Demandas`, `TC_Procedimentos`, `TC_Equipamentos`, `TC_Manutencoes`, `TC_Pecas`,
`TC_Clientes`, `TC_Parametros`, `TC_Instrumentos`, `TC_Cotacoes`, `TC_CotacaoItens`

Then **Transform Data** — not *Load*. Every one of these needs cleaning first.

## Part B — clean each table

Do this once per table. It is repetitive and it is the part that decides whether the model works.

**1. Keep only the columns you need.** *Home → Choose Columns*. Untick everything SharePoint
adds: `odata.*`, `FileSystemObjectType`, `ServerRedirectedEmbedUri`, `ContentTypeId`,
`GUID`, `Attachments`, `ComplianceAssetId`, the `*Id` twins of person fields. Keep `Id`,
`Title`, `Created`, `Modified` and the columns from the schema.

**2. Expand the Choice columns.** A Choice arrives as a `Record`. Click the expand icon (⇄) in
its header and pick **Value** only. Then rename the resulting `Priority.Value` back to
`Priority`. The Choice columns, per table:

| Table | Choice columns |
|---|---|
| `TC_Demandas` | `LTIClassification`, `Priority`, `RequestStatus` |
| `TC_Procedimentos` | `SystemEnd` |
| `TC_Equipamentos` | `Continuous` |
| `TC_Manutencoes` | `MaintenanceType`, `MaintenanceStatus` |
| `TC_Instrumentos` | `InstrumentStatus`, `Active`, `Backup`, `LastResult` |

**3. Set the types.** *Transform → Data Type*. Dates to **Date** (not Date/Time — the times are
meaningless and they break day-level grouping), hours and counts to **Decimal Number**, money to
**Fixed Decimal Number**.

**4. Rename the query** to the list name, without the `TC_` prefix if you prefer shorter DAX —
but then be consistent. This guide keeps the `TC_` names.

Then **Close & Apply**.

### The one extra query: the rig bridge

`AllocatedEquipment` holds one or two machine names joined by ` + ` (`Burner 1 + Shaker`). To
count a test against both rigs, it has to become one row per rig.

*Right-click `TC_Demandas` → Reference*, name the new query **`RequestRig`**, then:

1. *Home → Choose Columns*: keep `Id` and `AllocatedEquipment` only.
2. Filter `AllocatedEquipment` — remove empty.
3. Select the column → *Split Column → By Delimiter* → Custom, `+`, **Advanced options →
   Split into: Rows**.
4. *Transform → Format → Trim*.
5. Rename the column to `EquipmentName`.

Two rows for a two-rig test, one for the rest. This is the only place the model needs it, and it
is a lot less fragile than trying to parse that string in DAX.

## Part C — the model

*Model view*. Draw these relationships, all **many-to-one, single direction**, from the list on
the left to the list on the right:

| From | Column | To | Column |
|---|---|---|---|
| `TC_Demandas` | `ProcedureId` | `TC_Procedimentos` | `Title` |
| `TC_Demandas` | `PartTypeId` | `TC_Pecas` | `Title` |
| `TC_Demandas` | `CustomerId` | `TC_Clientes` | `Title` |
| `TC_CotacaoItens` | `QuoteNumber` | `TC_Cotacoes` | `Title` |
| `TC_Cotacoes` | `CustomerId` | `TC_Clientes` | `Title` |
| `TC_Manutencoes` | `EquipmentId` | `TC_Equipamentos` | `Title` |
| `RequestRig` | `EquipmentName` | `TC_Equipamentos` | `EquipmentName` |
| `RequestRig` | `Id` | `TC_Demandas` | `Id` |

`RequestRig` sits between two tables on purpose — it is the bridge, and it is the one table with
relationships on both sides.

### The date table

*Modeling → New table*:

```dax
Calendario =
ADDCOLUMNS(
    CALENDAR( DATE( 2026, 1, 1 ), DATE( 2028, 12, 31 ) ),
    "Year", YEAR( [Date] ),
    "Month", FORMAT( [Date], "yyyy-MM" ),
    "MonthName", FORMAT( [Date], "MMM yyyy" ),
    "DayNumber", WEEKDAY( [Date], 1 ) - 1
)
```

Mark it as a date table: select it, *Table tools → Mark as date table*, date column `Date`.

`DayNumber` comes out 0 = Sunday, which is the same convention `OperatingDays` uses in the lists
(`"0; 1; 2; 3; 4; 5; 6"`). Getting this one wrong shifts every capacity figure by a day and
nothing looks broken.

Relate `Calendario[Date]` to `TC_Demandas[PlannedStart]`, single direction, and leave it
**inactive** if you also want to slice by `CompletionDate` — the measures below turn on whichever
one they need with `USERELATIONSHIP`.

## Part D — the measures

*Modeling → New measure*, one at a time. Put them all in a table called `Medidas`
(*Enter data* → empty table named `Medidas` → move each measure into it) so they stop cluttering
the field list.

### The rate

```dax
Hourly rate =
CALCULATE(
    MAX( TC_Parametros[Value] ),
    TC_Parametros[Title] = "HourlyRate",
    REMOVEFILTERS()
)
```

`REMOVEFILTERS()` so a slicer on a page cannot accidentally leave the rate blank.

### Cost — the same arithmetic as the app

The cost is **computed, not stored**. `TC_Demandas` has no cost column, and it should not: a
stored cost is a number that disagrees with the hours it came from the first time someone
corrects a procedure. The catalogue and the request screen recompute live for the same reason;
only a quote freezes its prices, and those live in `TC_CotacaoItens` already.

```dax
Samples =
SUMX(
    TC_Demandas,
    VAR DefaultSamples = RELATED( TC_Procedimentos[Samples] )
    RETURN
        IF(
            TC_Demandas[Quantity] > 0,
            TC_Demandas[Quantity],
            IF( DefaultSamples > 0, DefaultSamples, 1 )
        )
)
```

```dax
Rig hours =
SUMX(
    TC_Demandas,
    VAR Setup = RELATED( TC_Procedimentos[SetupHours] )
    VAR Test = RELATED( TC_Procedimentos[TestHours] )
    VAR DefaultSamples = RELATED( TC_Procedimentos[Samples] )
    VAR Qty =
        IF(
            TC_Demandas[Quantity] > 0,
            TC_Demandas[Quantity],
            IF( DefaultSamples > 0, DefaultSamples, 1 )
        )
    RETURN Setup + Test * Qty
)
```

```dax
Billable hours =
SUMX(
    TC_Demandas,
    VAR Setup = RELATED( TC_Procedimentos[SetupHours] )
    VAR Test = RELATED( TC_Procedimentos[TestHours] )
    VAR Reporting = RELATED( TC_Procedimentos[ReportingHours] )
    VAR DefaultSamples = RELATED( TC_Procedimentos[Samples] )
    VAR Qty =
        IF(
            TC_Demandas[Quantity] > 0,
            TC_Demandas[Quantity],
            IF( DefaultSamples > 0, DefaultSamples, 1 )
        )
    RETURN Setup + Test * Qty + Reporting
)
```

Only `Test` multiplies by the sample count: each sample is a separate run, the setup is done once
for the campaign and the report is written once at the end. `Rig hours` is how long the machine
is held; `Billable hours` is what is charged. The difference is the reporting time, and it is why
the two measures both exist.

```dax
Hours cost = [Billable hours] * [Hourly rate]
```

```dax
Consumables cost =
SUMX( TC_Demandas, RELATED( TC_Procedimentos[ConsumablesCost] ) )
```

```dax
Part cost =
SUMX(
    TC_Demandas,
    VAR DefaultSamples = RELATED( TC_Procedimentos[Samples] )
    VAR Qty =
        IF(
            TC_Demandas[Quantity] > 0,
            TC_Demandas[Quantity],
            IF( DefaultSamples > 0, DefaultSamples, 1 )
        )
    RETURN COALESCE( RELATED( TC_Pecas[CostPerSample] ), 0 ) * Qty
)
```

```dax
Total cost = [Hours cost] + [Consumables cost] + [Part cost]
```

```dax
Confirmed cost =
CALCULATE(
    [Total cost],
    TC_Demandas[LTIClassification] <> "COTACAO",
    TC_Demandas[RequestStatus] <> "CANCELADA"
)
```

`Confirmed cost` is the one to put on the page. A quote is a budget, not committed work, and a
cancelled request is not work at all — the same exclusion `confirmadas()` makes in `src/kpi.js`.

**The part cost is in a request and not in a quote.** The lab consumes the customer's parts on a
real request; a quote prices the test centre's service. That is why the same procedure quotes
lower than the request that follows it, and it is correct.

### Queue and delivery

```dax
Requests = COUNTROWS( TC_Demandas )
```

```dax
Scheduled =
CALCULATE( COUNTROWS( TC_Demandas ), NOT ISBLANK( TC_Demandas[PlannedStart] ) )
```

```dax
Blocked =
CALCULATE(
    COUNTROWS( TC_Demandas ),
    ISBLANK( TC_Demandas[PlannedStart] ),
    TC_Demandas[LTIClassification] <> "COTACAO",
    TC_Demandas[RequestStatus] IN { "SOLICITADA", "ACEITA", "EM_EXECUCAO" }
)
```

`Blocked` is the number that should be looked at every morning: an active request the scheduler
could not place. Quotes are excluded because a quote correctly takes no rig.

```dax
Late =
CALCULATE(
    COUNTROWS( TC_Demandas ),
    NOT ISBLANK( TC_Demandas[DueDate] ),
    NOT ISBLANK( TC_Demandas[PlannedEnd] ),
    TC_Demandas[PlannedEnd] > TC_Demandas[DueDate]
)
```

If Power BI refuses that last filter — it cannot always compare two columns inside `CALCULATE` —
use the explicit form instead:

```dax
Late =
COUNTROWS(
    FILTER(
        TC_Demandas,
        NOT ISBLANK( TC_Demandas[DueDate] ) &&
        NOT ISBLANK( TC_Demandas[PlannedEnd] ) &&
        TC_Demandas[PlannedEnd] > TC_Demandas[DueDate]
    )
)
```

```dax
Approved reports =
CALCULATE( COUNTROWS( TC_Demandas ), TC_Demandas[RequestStatus] = "VALIDADA" )
```

```dax
Right first time =
DIVIDE(
    CALCULATE(
        COUNTROWS( TC_Demandas ),
        TC_Demandas[RequestStatus] = "VALIDADA",
        COALESCE( TC_Demandas[ReworkRounds], 0 ) = 0
    ),
    [Approved reports]
)
```

Measured over reports **approved** in the period. Anything still under review counts neither for
nor against — the verdict is not in, and counting it either way flatters or punishes the number
for no reason. `DIVIDE` returns blank rather than an error when nothing has been approved yet,
which is the right thing for a card to show.

### Calibration

```dax
Due date =
VAR Last = TC_Instrumentos[LastCalibration]
VAR Interval = TC_Instrumentos[IntervalMonths]
RETURN
    IF(
        ISBLANK( Last ) || ISBLANK( Interval ) || Interval <= 0,
        BLANK(),
        EDATE( Last, Interval )
    )
```

This one is a **calculated column**, not a measure (*Table tools → New column*, with
`TC_Instrumentos` selected). `NextCalibration` is empty on all 229 rows; the due date is computed
from `LastCalibration + IntervalMonths`, exactly as the calibration flow does it, so the two
never disagree.

```dax
Overdue instruments =
CALCULATE(
    COUNTROWS( TC_Instrumentos ),
    TC_Instrumentos[Active] = "Yes",
    NOT ISBLANK( TC_Instrumentos[Due date] ),
    TC_Instrumentos[Due date] < TODAY()
)
```

```dax
Due within six weeks =
CALCULATE(
    COUNTROWS( TC_Instrumentos ),
    TC_Instrumentos[Active] = "Yes",
    TC_Instrumentos[Due date] >= TODAY(),
    TC_Instrumentos[Due date] <= TODAY() + 42
)
```

## Part E — the pages

### Page 1 — Queue and cost

Across the top, five **Card** visuals: `Requests`, `Scheduled`, `Blocked`, `Late`,
`Confirmed cost`. Set `Blocked` and `Late` to a red font when above zero
(*Format → Callout value → Conditional formatting*).

Below them:

| Visual | Fields |
|---|---|
| **Stacked bar** — queue by status | Y: `TC_Demandas[RequestStatus]` · X: `Requests` · Legend: `TC_Demandas[Priority]` |
| **Clustered bar** — cost by customer | Y: `TC_Clientes[CustomerName]` · X: `Confirmed cost` |
| **Clustered bar** — cost by project | Y: `TC_Demandas[Project]` · X: `Confirmed cost` |
| **Table** — the blocked ones | `Title`, `ProcedureId`, `Priority`, `DueDate`, `BlockingReason`, filtered to `PlannedStart` is blank |

Slicers down the left: `TC_Clientes[CustomerName]`, `TC_Demandas[Priority]`,
`TC_Demandas[LTIClassification]`, and `Calendario[MonthName]`.

The blocked table earns its place: it is the page's only actionable list. Everything else is a
number to watch; that one is a list of things someone has to fix.

### Page 2 — Calibration

Cards: `Overdue instruments`, `Due within six weeks`. Then a **Table**: `Title`,
`InstrumentName`, `Sector`, `Station`, `LastCalibration`, `Due date`, `IntervalMonths`, sorted by
`Due date` ascending, filtered to `Active = "Yes"`.

Conditional-format `Due date` on a rule: before today → red background.

Slicers: `Sector`, `InstrumentStatus`.

This page and the Monday e-mail say the same thing on purpose. The e-mail reaches someone who is
not looking; the page is for the person who is.

### Page 3 — the Gantt

There is no Gantt in the standard visual set. Two ways:

**The custom visual (recommended).** *Insert → More visuals → Get more visuals*, search
**Gantt**, add the one published by Microsoft. Fields:

| Well | Field |
|---|---|
| Task | `TC_Demandas[Title]` |
| Start Date | `TC_Demandas[PlannedStart]` |
| End Date | `TC_Demandas[PlannedEnd]` |
| Legend | `TC_Demandas[Priority]` |
| Resource | `TC_Demandas[AllocatedEquipment]` |
| Tooltips | `TC_Demandas[ProcedureId]`, `TC_Demandas[DueDate]` |

Many tenants block AppSource visuals by admin policy. Find out before building the page around
it — if it is blocked, an admin can allow that one visual, and that request is a lot easier to
get granted than a new server.

**The fallback, if custom visuals are blocked.** A **Stacked bar chart** with:

* Y: `TC_Demandas[Title]`
* X: two measures — first `Offset` (transparent), then `Duration`:

```dax
Offset = DATEDIFF( MIN( Calendario[Date] ), MIN( TC_Demandas[PlannedStart] ), DAY )
```

```dax
Duration = DATEDIFF( MIN( TC_Demandas[PlannedStart] ), MIN( TC_Demandas[PlannedEnd] ), DAY ) + 1
```

Set the `Offset` series colour to fully transparent. It reads as a Gantt and it is honest about
being a trick — no dependencies, no month header, no zoom.

### Page 4 — Rig utilisation (the hard one)

Leave this out of the first delivery if time is short. It is the only part of this guide that is
genuinely awkward in DAX, because capacity is a per-machine, per-day question: which days the
machine works, whether it was in maintenance, how many positions it has, and how a 38-day test
spreads its hours across two months.

First, a calculated table of every day each machine actually operates:

```dax
RigDays =
FILTER(
    ADDCOLUMNS(
        CROSSJOIN(
            SELECTCOLUMNS( Calendario, "Date", Calendario[Date], "DayNumber", Calendario[DayNumber] ),
            TC_Equipamentos
        ),
        "Works",
        PATHCONTAINS(
            SUBSTITUTE( SUBSTITUTE( TC_Equipamentos[OperatingDays], " ", "" ), ";", "|" ),
            [DayNumber] & ""
        )
    ),
    [Works] = TRUE()
)
```

Then the hours that exist, with maintenance taken out:

```dax
Capacity hours =
SUMX(
    RigDays,
    VAR TheDay = RigDays[Date]
    VAR TheRig = RigDays[Title]
    VAR ShiftHours =
        IF(
            RigDays[Continuous] = "Yes",
            24,
            IF( RigDays[HoursPerDay] > 0, RigDays[HoursPerDay], 8 )
        )
    VAR Positions = IF( RigDays[Positions] > 0, RigDays[Positions], 1 )
    VAR Down =
        COUNTROWS(
            FILTER(
                TC_Manutencoes,
                TC_Manutencoes[EquipmentId] = TheRig &&
                TC_Manutencoes[StartDate] <= TheDay &&
                TC_Manutencoes[EndDate] >= TheDay
            )
        )
    RETURN IF( Down > 0, 0, ShiftHours * Positions )
)
```

And the load, through the `RequestRig` bridge:

```dax
Allocated hours =
SUMX(
    RequestRig,
    VAR TheRequest = RequestRig[Id]
    RETURN
        CALCULATE( [Rig hours], TC_Demandas[Id] = TheRequest )
)
```

```dax
Utilisation = DIVIDE( [Allocated hours], [Capacity hours] )
```

Visual: a **Clustered column chart**, X `TC_Equipamentos[EquipmentName]`, Y `Utilisation`
formatted as a percentage, with a `Calendario[MonthName]` slicer.

**Be honest about what this version does not do.** `Allocated hours` puts all of a test's hours
into whatever period the filter covers, instead of apportioning them across the months the test
actually spans — which is what `horasNoMes()` in `src/kpi.js` does. For a test that starts on the
28th and runs six weeks, that overstates the first month and understates the next two. It is
usable for "which rigs are the bottleneck" and not for a monthly capacity commitment. Doing it
properly means expanding each allocation to one row per operating day in Power Query, the same
way `RequestRig` expands the rigs — worth doing, and worth doing after the other three pages are
live.

## Part F — publish and refresh

1. *Home → Publish*, into a workspace the test centre owns (not "My workspace" — nobody else can
   be given access to that one).
2. In the Power BI service, open the dataset → **Settings → Data source credentials** → sign in
   with OAuth2.
3. **Scheduled refresh**: on, daily, early — after the scheduling flow's daily run, so the Gantt
   shows the plan people will work to that day. Eight refreshes a day is the Pro ceiling; one is
   enough here.

### Showing it inside the Power App

In Power Apps Studio, on a new screen `scrDashboard`:

*Insert → Charts → **Power BI tile***, then pick workspace, report and tile in the properties
pane. Add it to the nav rail the same way the other screens are wired.

The viewer needs a Power BI Pro licence for the tile to render. If licensing lands the wrong way,
skip this and share the report link — the app is not worse for it.

## Testing it before trusting it

1. **The rate is 368.75.** Drop the `Hourly rate` card on a page. A blank means the
   `TC_Parametros` filter is not matching `"HourlyRate"`.
2. **`Confirmed cost` against the app.** Take one request, open it in the Power App, compare the
   cost preview with what the table shows for that row. They must be identical — if the Power BI
   figure is higher, the part cost is being applied to a quote; if lower, `Quantity` is not
   reaching the `Samples` fallback.
3. **`Overdue instruments` is around 70.** Far from that means `Due date` is reading the wrong
   column or `IntervalMonths` did not convert to a number.
4. **`Blocked` matches the app.** Filter the Requests screen for "Awaiting scheduling" and count.
5. **The Gantt has no bar starting before today** for a request created this week. If it does,
   the scheduler was given a `ForcedStart` in the past — which is legitimate, but worth knowing
   is the reason.

## When it does not work

**Every Choice column shows `[Record]`.** They were not expanded in Power Query. Go back, expand,
keep `Value`.

**`RELATED` says the column cannot be found.** The relationship is missing or points the wrong
way. `RELATED` only works from the many side to the one side — from `TC_Demandas` to
`TC_Procedimentos`, never the reverse.

**Cost is blank for some requests.** `ProcedureId` on those rows does not match any `Title` in
`TC_Procedimentos`. Add a table visual of `ProcedureId` filtered to blank cost and the typos
show up immediately.

**Refresh fails with "not found".** The site URL points at a list instead of the site, or the
connector is on implementation 1.0.

**The Gantt visual will not install.** Tenant policy blocks AppSource visuals — use the stacked
bar fallback, and put in the request to allow it in parallel.
