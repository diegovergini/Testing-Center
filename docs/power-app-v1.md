# Power App v1 — build guide

Scope, matching the roadmap in [power-platform.md](power-platform.md) step 2: **the catalogue,
new request, request list**. This is what replaces the spreadsheet and gives the sharing the
web version cannot. Scheduling itself (finding the slot, the Gantt) is step 3 — out of scope
here, and `PlannedStart` / `PlannedEnd` / `AllocatedEquipment` stay blank on a request until
that Office Script runs.

Everything below is Power Fx, written against the lists already on the site
(`ferramentas/listas-schema.json`). Paste it screen by screen in Power Apps Studio; nothing
here needs code outside the app.

## Before you start: two settings

**Formula-level error management** and **Explicit column selection** — off, in *Settings >
Upcoming features > Preview*. Neither buys anything at this scale and both make the formulas
below noisier to write. Everything here assumes the defaults.

**Named formulas**, not `App.OnStart`. They are the current recommended way to hold constants
and lookups: they recalculate automatically, so nothing goes stale if a list changes underfoot,
and there is no `Set()`/`Collect()` timing to get wrong. Paste the whole block from *App* →
*Advanced* → the **Formulas** box (not `OnStart`).

## Design system

The web app has its own palette (`assets/styles.css`) and it should carry over — a Power App in
default Fluent blue reads as a prototype next to it, and the colour also has to match the
status pills people already recognise from the browser version.

```
// ---- App.Formulas ------------------------------------------------------------------
// Brand palette, ported from assets/styles.css. Every screen references these tokens —
// never a literal RGBA — so the whole app repaints from one place.

clrBg        = RGBA(244, 246, 249, 1);
clrSurface   = RGBA(255, 255, 255, 1);
clrSurface2  = RGBA(248, 250, 252, 1);
clrBorder    = RGBA(226, 232, 240, 1);
clrBorderStrong = RGBA(203, 213, 225, 1);
clrText      = RGBA(23, 34, 47, 1);
clrTextWeak  = RGBA(100, 116, 139, 1);
clrBrand     = RGBA(15, 92, 140, 1);
clrBrandWeak = RGBA(227, 240, 248, 1);

clrOk        = RGBA(21, 128, 61, 1);
clrOkBg      = RGBA(230, 245, 236, 1);
clrWarn      = RGBA(180, 83, 9, 1);
clrWarnBg    = RGBA(253, 243, 227, 1);
clrError     = RGBA(185, 28, 28, 1);
clrErrorBg   = RGBA(253, 236, 236, 1);
clrHot       = RGBA(194, 65, 12, 1);
clrHotBg     = RGBA(255, 241, 232, 1);
clrCold      = RGBA(3, 105, 161, 1);
clrColdBg    = RGBA(230, 243, 251, 1);

radCard      = 10;
radPill      = 20;
fontBody     = Font.'Segoe UI';

// ---- Reference data, read once and reused everywhere --------------------------------
// A single Value column in TC_Parametros; today it only ever holds HourlyRate.
colHourlyRate = LookUp(TC_Parametros, Title = "HourlyRate", Value);

// ---- Status labels and colours, matching src/fluxo.js one to one --------------------
// Keeping this as data (a table), not a chain of If()s, is what lets the status pill be a
// single reusable component instead of copy-pasted logic on every screen.
colRequestStatus = Table(
  { Key: "SOLICITADA",          Label: "Requested",              Fg: clrBrand, Bg: clrBrandWeak },
  { Key: "ACEITA",               Label: "Accepted",               Fg: clrBrand, Bg: clrBrandWeak },
  { Key: "EM_EXECUCAO",          Label: "Running",                Fg: clrWarn,  Bg: clrWarnBg },
  { Key: "CONCLUIDA",            Label: "Test completed",         Fg: clrOk,    Bg: clrOkBg },
  { Key: "RELATORIO_ENVIADO",    Label: "Report sent",            Fg: clrBrand, Bg: clrBrandWeak },
  { Key: "EM_CORRECAO",          Label: "In rework",              Fg: clrError, Bg: clrErrorBg },
  { Key: "VALIDADA",             Label: "Signed off by customer", Fg: clrOk,    Bg: clrOkBg },
  { Key: "CANCELADA",            Label: "Cancelled",              Fg: clrTextWeak, Bg: clrSurface2 }
);

colPriority = Table(
  { Key: "ALTA",  Label: "High",   Fg: clrError, Bg: clrErrorBg },
  { Key: "MEDIA", Label: "Medium", Fg: clrWarn,  Bg: clrWarnBg },
  { Key: "BAIXA", Label: "Low",    Fg: clrTextWeak, Bg: clrSurface2 }
);

colSystemEnd = Table(
  { Key: "HOT",   Label: "Hot End",       Fg: clrHot,  Bg: clrHotBg },
  { Key: "COLD",  Label: "Cold End",      Fg: clrCold, Bg: clrColdBg },
  { Key: "AMBOS", Label: "Hot & Cold End", Fg: RGBA(109, 40, 217, 1), Bg: RGBA(241, 235, 253, 1) }
);

colLtiClass = Table(
  { Key: "COTACAO", Label: "Quote" },
  { Key: "DV",       Label: "DV — Design Validation" },
  { Key: "PV",       Label: "PV — Process Validation" },
  { Key: "VAVE",     Label: "VAVE" }
);
```

**A status pill formula**, used everywhere a status/priority/system-end shows up (paste as the
`Text`/`Fill`/`Color` of a small pill-shaped label control — rounded rectangle, `radPill`
corner radius, `Padding: 8, 3`):

```
// Text
LookUp(colRequestStatus, Key = ThisItem.RequestStatus, Label)
// Fill
LookUp(colRequestStatus, Key = ThisItem.RequestStatus, Bg)
// Color
LookUp(colRequestStatus, Key = ThisItem.RequestStatus, Fg)
```

Swap `colRequestStatus` / `RequestStatus` for `colPriority` / `Priority` or `colSystemEnd` /
`SystemEnd` on the equivalent pill.

## Role gating, the simple version

The full version — two Microsoft 365 groups, permissions enforced by the platform — is in
*power-platform.md*. For v1, before those groups exist, add one tiny list so the app can still
tell a Product Engineer from a Test Engineer without asking anyone to remember a toggle:

**New list `TC_Perfis`**: `Title` = the person's email, `Role` (Choice: `PRODUTO`, `TESTES`).
Two rows to start — you and whoever else needs edit rights get `TESTES`; everyone else who
opens the app is `PRODUTO` by default if their email is not in the list.

```
// Named formula, added to the block above
colMinhaFuncao = With(
  { linha: LookUp(TC_Perfis, Title = User().Email) },
  If(IsBlank(linha), "PRODUTO", linha.Role)
);
```

Every "New procedure", "Edit", or "Delete" button below is gated by
`colMinhaFuncao = "TESTES"` in its `Visible` property — exactly the same rule the web app
enforces in `src/permissoes.js`, just re-declared here because Power Apps does not read that
file.

## App structure

```
scrCatalogue     (home)  —  gallery of procedures, filters, "Confirm need"
scrNewRequest             —  the form "Confirm need" opens, one procedure at a time
scrRequests               —  the queue of everything already requested
```

A left navigation rail matching the web sidebar (same three items, same brand mark) sits on a
component (`comNavRail`) reused on all three screens — build it once, not per screen.

**comNavRail** — a vertical rectangle, `Width: 220`, `Fill: clrSurface`, containing:
- A "TC" badge (circle, `Fill: clrBrand`, white bold text) + "Testing Center" title, mirroring
  `index.html`'s `.marca` block.
- Three nav buttons (`Catalogue`, `New request`, `Requests`), each:
  `OnSelect: Navigate(scrCatalogue / scrNewRequest / scrRequests, ScreenTransition.Fade)`,
  `Fill: If(App.ActiveScreen = scrCatalogue, clrBrandWeak, clrSurface)`,
  `Color: If(App.ActiveScreen = scrCatalogue, clrBrand, clrText)`.

## How a cost is worked out

Every cost formula in this app is the same one, and it is worth reading once before copying it
around:

```
billable hours = SetupHours + TestHours × samples + ReportingHours
cost           = billable hours × hourly rate + ConsumablesCost + samples × CostPerSample
```

**Only the test hours multiply by the sample count.** Each sample is a separate run of the test;
the setup is done once for the campaign and the report is written once at the end. Consumables
are a one-off too. The part cost is per sample, because the lab consumes one part per run — and
it is the only term that appears on a request but not on a quote, since a quote prices the test
centre's service and the parts are the customer's.

The same rule drives the schedule, not only the price: three samples hold the rig for roughly
three times as long. `src/scheduler.js` and the Office Script both implement it, and a parity
test fails if they ever disagree.

## Screen 1 — Test Catalogue (`scrCatalogue`)

### Header row
- `lblTitle`: "Test catalogue", `Size: 22`, `FontWeight: Bold`.
- `lblSubtitle`: "Every validation procedure by system end and customer. Confirm the need for
  a test and it enters the queue." — `Color: clrTextWeak`.
- `btnHourlyRate` (top right, visible only to `TESTES`): shows the current rate —
  `Text: "Hourly rate " & Text(colHourlyRate, "[$-en-US]$#,##0.00") & "/h"`.

### Filter bar
Four controls in a horizontal container, each updating a variable on `OnChange`:

```
txtSearch.OnChange:      Set(varSearch, Lower(txtSearch.Text))
ddCustomer.Items:        Table({Key: "", Value: "All customers"}) &
                          ForAll(TC_Clientes, {Key: Title, Value: CustomerName})
ddCustomer.OnChange:     Set(varCustomer, ddCustomer.Selected.Key)
ddSystemEnd.Items:       Table({Key:"",Value:"All"},{Key:"HOT",Value:"Hot End"},
                          {Key:"COLD",Value:"Cold End"})
ddSystemEnd.OnChange:    Set(varSystemEnd, ddSystemEnd.Selected.Key)
```

### The gallery

`galCatalogue.Items`:

```
SortByColumns(
  Filter(
    TC_Procedimentos,
    (IsBlank(varSearch)
      || varSearch in Lower(ProcedureName)
      || varSearch in Lower(Title)
      || varSearch in Lower(Standard))
    && (IsBlank(varCustomer) || varCustomer in Customers)
    && (IsBlank(varSystemEnd) || SystemEnd = varSystemEnd || SystemEnd = "AMBOS")
  ),
  "ProcedureName", SortOrder.Ascending
)
```

`Customers` is the semicolon-joined text column (`; ` between codes, same as the CSV export) —
`varCustomer in Customers` is a plain substring check. Safe with today's nine codes (none is a
prefix of another — checked against `TC_Clientes`), but if a future code is ever a substring of
another one (`CLI-G` inside `CLI-GM`, say), switch this one line to
`varCustomer in Split(Customers, "; ").Value` before adding it.

**Card template** (one per item in the gallery — a rounded container, `Fill: clrSurface`,
`radCard`, `1px clrBorder` stroke, drop shadow `0 1px 2px rgba(15,32,51,.06)`, `Padding: 16`):

```
lblCode.Text            = ThisItem.Title
lblName.Text             = ThisItem.ProcedureName
lblStandard.Text         = ThisItem.Standard & " · " & ThisItem.Revision
pillSystemEnd            = (system-end pill, formula above)
lblEquipment.Text         = Substitute(ThisItem.EquipmentGroups, "; ", " + ")
lblHours.Text             = Text(
                              ThisItem.SetupHours + ThisItem.TestHours * ThisItem.Samples
                                + ThisItem.ReportingHours,
                              "0"
                            ) & " h"
lblCost.Text              = "R$ " & Text(
                              (ThisItem.SetupHours + ThisItem.TestHours * ThisItem.Samples
                                + ThisItem.ReportingHours) * colHourlyRate
                                + ThisItem.ConsumablesCost,
                              "[$-pt-BR]#.##0"
                            )
btnConfirm.Text           = "Confirm need"
btnConfirm.OnSelect       = Set(varProcedimentoSelecionado, ThisItem); Navigate(scrNewRequest)
btnEdit.Visible           = colMinhaFuncao = "TESTES"
```

If `EquipmentGroups` is blank, show the `sem equipamento` warning the web app shows —
`lblNoEquipment.Visible: IsBlank(ThisItem.EquipmentGroups)`, red pill, text "no equipment".

## Screen 2 — Confirm need (`scrNewRequest`)

Opens with `varProcedimentoSelecionado` already set from the catalogue card. Header repeats the
procedure identification, exactly as the web modal does:

```
lblContext.Text = varProcedimentoSelecionado.ProcedureName & " · " &
  varProcedimentoSelecionado.Standard & " · " &
  Substitute(varProcedimentoSelecionado.EquipmentGroups, "; ", " + ")
```

### The form

Every field below is required except **Force start** — same exception as the web app's
`ui.validarObrigatorios` call for this exact form. Use SharePoint form controls or plain
`Classic TextInput`/`Combo box` controls; the formulas are the same either way.

| Field | Control | Source / formula |
|---|---|---|
| LTI number | Text input | free text, placeholder `LTI-2026-0142` |
| LTI classification | Dropdown | `Items: colLtiClass`, `Default: "DV"` |
| Customer | Dropdown | `Items: TC_Clientes`, `DisplayFields: ["CustomerName"]` |
| Project | Combo box, allow custom | `Items: Distinct(TC_Demandas, Project)` — suggests, does not force |
| Part Number | Text input | free text |
| Part type | Dropdown | `Items: TC_Pecas`, `DisplayFields: ["PartTypeName"]` |
| Samples available from | Date picker | `DefaultDate: Today()` |
| Due date | Date picker | `DefaultDate: DateAdd(Today(), 60, TimeUnit.Days)` |
| Priority | Dropdown | `Items: colPriority`, `Default: "MEDIA"` |
| Samples to consume | Text input, `Format: Number` | `Default: varProcedimentoSelecionado.Samples` |
| Force start (optional) | Date picker | not required |
| Note | Text input, multiline | optional |

### Live cost preview

Mirrors the web app's `atualizarPrevia()` — the same formula, `Quantity` in place of the
default when the field has been typed in:

```
lblCostPreview.Text =
  With(
    {
      qtd: If(IsBlank(txtQuantity.Text), varProcedimentoSelecionado.Samples, Value(txtQuantity.Text)),
      partType: LookUp(TC_Pecas, Title = ddPartType.Selected.Title)
    },
    "Estimated cost R$ " &
    Text(
      (varProcedimentoSelecionado.SetupHours
        + varProcedimentoSelecionado.TestHours * qtd
        + varProcedimentoSelecionado.ReportingHours) * colHourlyRate
        + varProcedimentoSelecionado.ConsumablesCost
        + qtd * partType.CostPerSample,
      "[$-pt-BR]#.##0"
    ) &
    If(ddLtiClass.Selected.Key = "COTACAO",
      " · as a quote, no rig is reserved.",
      " · the test is not scheduled before " & Text(dpSamplesFrom.SelectedDate, "dd mmm yyyy") & ".")
  )
```

### Submitting

`btnSubmit.DisplayMode`:

```
If(
  !IsBlank(txtLTI.Text) && !IsBlank(ddCustomer.Selected) && !IsBlank(txtProject.Text) &&
  !IsBlank(txtPartNumber.Text) && !IsBlank(ddPartType.Selected) &&
  !IsBlank(dpSamplesFrom.SelectedDate) && !IsBlank(dpDueDate.SelectedDate) &&
  !IsBlank(txtQuantity.Text) && Value(txtQuantity.Text) >= 1,
  DisplayMode.Edit, DisplayMode.Disabled
)
```

`btnSubmit.OnSelect`:

```
Patch(
  TC_Demandas,
  Defaults(TC_Demandas),
  {
    Title: "DM-" & Text(Today(), "yyyymmdd") & "-" &
      Text(CountRows(Filter(TC_Demandas, StartsWith(Title, "DM-" & Text(Today(), "yyyymmdd")))) + 1, "000"),
    ProcedureId: varProcedimentoSelecionado.Title,
    PartTypeId: ddPartType.Selected.Title,
    CustomerId: ddCustomer.Selected.Title,
    Project: txtProject.Text,
    PartNumber: txtPartNumber.Text,
    LTI: txtLTI.Text,
    LTIClassification: ddLtiClass.Selected.Key,
    Priority: ddPriority.Selected.Key,
    Quantity: Value(txtQuantity.Text),
    SamplesAvailableFrom: dpSamplesFrom.SelectedDate,
    DueDate: dpDueDate.SelectedDate,
    ForcedStart: dpForcedStart.SelectedDate,
    Notes: txtNote.Text,
    RequestStatus: "SOLICITADA",
    ReworkRounds: 0
  }
);
Notify("Request " & Title & " created.", NotificationType.Success);
Navigate(scrRequests)
```

The daily counter in `Title` is good enough for a first cut and matches the human-readable
style of `TP-GM-01` and `COT-2026-0001` elsewhere in the schema, but it is not race-safe: two
people submitting in the same second could collide. `power-platform.md` step 3 already plans a
Power Automate flow for quote numbering; extending that flow to assign `TC_Demandas.Title`
properly is the fix, and it is a five-minute addition once that flow exists — not worth
blocking v1 on.

## Screen 3 — Requests (`scrRequests`)

Same filter-bar pattern as the catalogue (`varSearch2`, `varStatus`, `varCustomer2`), then:

```
galRequests.Items =
  SortByColumns(
    Filter(
      TC_Demandas,
      (IsBlank(varSearch2) || varSearch2 in Lower(LTI) || varSearch2 in Lower(Project))
      && (IsBlank(varStatus) || RequestStatus = varStatus)
      && (IsBlank(varCustomer2) || CustomerId = varCustomer2)
    ),
    "DueDate", SortOrder.Ascending
  )
```

Row template, one line per field, matching the web table's columns in the same order
(Procedure, Project, Part type, LTI, Priority, Slot, Due date, Cost, Status):

```
lblProcedure.Text = LookUp(TC_Procedimentos, Title = ThisItem.ProcedureId, ProcedureName)
lblProject.Text   = ThisItem.Project & " · " & ThisItem.PartNumber
lblPartType.Text  = LookUp(TC_Pecas, Title = ThisItem.PartTypeId, PartTypeName)
pillPriority       = (priority pill, formula above)
lblSlot.Text      = If(
                      !IsBlank(ThisItem.PlannedStart),
                      Text(ThisItem.PlannedStart, "dd mmm") & " → " & Text(ThisItem.PlannedEnd, "dd mmm"),
                      "Awaiting scheduling"
                    )
lblDueDate.Text   = Text(ThisItem.DueDate, "dd mmm yyyy")
lblCost.Text      = Text(
                      With(
                        { proc: LookUp(TC_Procedimentos, Title = ThisItem.ProcedureId),
                          part: LookUp(TC_Pecas, Title = ThisItem.PartTypeId) },
                        (proc.SetupHours + proc.TestHours * ThisItem.Quantity
                          + proc.ReportingHours) * colHourlyRate
                          + proc.ConsumablesCost + ThisItem.Quantity * part.CostPerSample
                      ),
                      "[$-pt-BR]#.##0"
                    )
pillStatus         = (status pill, formula above)
```

`lblSlot` reading "Awaiting scheduling" for every row is expected until step 3 wires up the
Office Script — it is not a bug in this screen.

## Testing v1 before calling it done

Open it in *Preview* and, in order: confirm a need from the catalogue for a procedure that has
equipment groups, check the request appears in the queue with the right cost and "Awaiting
scheduling"; then repeat for a procedure with **no** equipment (the card should still show the
warning and still let the request through, matching `docs/power-platform.md`'s note that the
request is recorded regardless); then switch `colMinhaFuncao` by editing your own row in
`TC_Perfis` to `PRODUTO` and confirm the "New procedure"/"Edit" buttons disappear.
