# Step 4 — Quotes

Two screens in the Power App: the list of quotes, and the editor for one quote. Plus the
workflow that moves a quote from draft to approved, and the history it leaves behind.

This step needs **no Office Scripts and no scheduling**. A quote is a budget — it works out cost
and duration but reserves no rig, which is exactly why `LTIClassification = COTACAO` is excluded
from the scheduler. So it can be built while the Office Scripts request goes through IT.

Everything below follows the conventions already used in the app: brand tokens from
`App.Formulas`, the `; ` separator, the same `[$-pt-BR]` currency formatting, controls renamed
the moment they are inserted. The lessons from the v1 build apply unchanged — read them before
writing a formula.

## The one thing that must not be got wrong

**A quote stores its prices; it does not recompute them.**

`TC_CotacaoItens` carries `HourlyRate`, `HoursCost`, `ConsumablesCost`, `UnitCost` and `Total` as
stored values, frozen at the moment the line was added. That is deliberate, and it is the whole
reason the list exists. The hourly rate is renegotiated once a year; the procedure's hours get
corrected as the lab learns. If the quote screen recalculated from `TC_Procedimentos` and
`TC_Parametros` every time it opened, a quote delivered in March would quietly change in April,
and the customer would be looking at a different number from the one in their inbox.

The catalogue and the request screen do the opposite — they recompute live, because there the
current price is the right answer. Same data, two different correct behaviours.

## The cost of a line

Taken from the web version (`src/views/cotacoes.js`), which the Power App has to match:

```
BillableHours   = SetupHours + TestHours × Samples + ReportingHours
HoursCost       = BillableHours × HourlyRate
ConsumablesCost = the procedure's ConsumablesCost, once
Total           = HoursCost + ConsumablesCost
UnitCost        = Total ÷ Samples          (the average price per sample)
```

Three things that surprise people:

* **Only the test hours multiply by the sample count.** Each sample is a separate run, so the
  test hours repeat; the setup is done once for the campaign and the report written once at the
  end. Consumables are a one-off too.
* **The unit price therefore falls as the quantity rises**, because the setup and the report are
  spread across more samples. That is a real argument for testing a campaign together rather
  than one sample at a time, and it is worth the customer being able to see it — which is why
  `UnitCost` is stored as the average rather than as a fixed per-run price.
* **The part itself is not in the quote.** A request adds `Quantity × CostPerSample` because the
  lab consumes the customer's parts; a quote prices the test centre's service. That is why the
  same procedure quotes lower than the request that follows it, and it is correct.

## App.Formulas — add these

Alongside the tables already there:

```
colQuoteStatus = Table(
  { Key: "RASCUNHO",   Label: "Draft",                     Fg: clrTextWeak, Bg: clrSurface2 },
  { Key: "SOLICITADA", Label: "Requested",                 Fg: clrBrand,    Bg: clrBrandWeak },
  { Key: "EM_ANALISE", Label: "Under review",              Fg: clrWarn,     Bg: clrWarnBg },
  { Key: "DEVOLVIDA",  Label: "Returned to customer",      Fg: clrError,    Bg: clrErrorBg },
  { Key: "VALIDADA",   Label: "Confirmed by test centre",  Fg: clrOk,       Bg: clrOkBg },
  { Key: "APROVADA",   Label: "Approved by customer",      Fg: clrOk,       Bg: clrOkBg },
  { Key: "RECUSADA",   Label: "Declined",                  Fg: clrTextWeak, Bg: clrSurface2 }
);

// Who may move a quote where, straight from src/fluxo.js. Keeping it as data means the
// buttons are generated from the rule instead of hard-coded per screen.
colQuoteMoves = Table(
  { From: "RASCUNHO",   To: "SOLICITADA", Role: "PRODUTO", Label: "Send for quoting",   NeedsNote: false },
  { From: "SOLICITADA", To: "EM_ANALISE", Role: "TESTES",  Label: "Take on review",     NeedsNote: false },
  { From: "EM_ANALISE", To: "VALIDADA",   Role: "TESTES",  Label: "Confirm quote",      NeedsNote: false },
  { From: "EM_ANALISE", To: "DEVOLVIDA",  Role: "TESTES",  Label: "Return to requester",NeedsNote: true },
  { From: "DEVOLVIDA",  To: "SOLICITADA", Role: "PRODUTO", Label: "Resend",             NeedsNote: false },
  { From: "VALIDADA",   To: "APROVADA",   Role: "PRODUTO", Label: "Approve quote",      NeedsNote: false },
  { From: "VALIDADA",   To: "RECUSADA",   Role: "PRODUTO", Label: "Decline quote",      NeedsNote: true }
);
```

Add `TC_Cotacoes`, `TC_CotacaoItens` and `TC_Historico` as data sources (**Add data**) before any
of the formulas below will resolve.

## Screen 1 — Quotes (`scrQuotes`)

Same shape as `scrRequests`: nav rail on the left, filter bar, gallery. Everything at X 240.

### Filter bar — Y 100, height 40

| Control | Insert via | Position | Formula / config |
|---|---|---|---|
| `txtSearchQ` | Input → Text input | X:240 Y:100, W:280 H:40 | `OnChange`: `Set(varSearchQ, Lower(txtSearchQ.Text))` |
| `ddStatusQ` | Input → Drop down | X:536 Y:100, W:260 H:40 | `Items`: `colQuoteStatus` · `Value`: `Label` · `AllowEmptySelection`: `true` · `Default`: `""` |
| `ddStatusQ` | (same control) | — | `OnChange`: `Set(varStatusQ, ddStatusQ.Selected.Key)` |
| `ddCustomerQ` | Input → Drop down | X:812 Y:100, W:200 H:40 | `Items`: `TC_Clientes` · `Value`: `CustomerName` · `AllowEmptySelection`: `true` · `Default`: `""` |
| `ddCustomerQ` | (same control) | — | `OnChange`: `Set(varCustomerQ, ddCustomerQ.Selected.Title)` |
| `btnNewQuote` | Input → Button | X:1028 Y:100, W:160 H:40 | see below |
| `btnClearQ` | Input → Button | X:1200 Y:100, W:140 H:40 | `OnSelect`: `Reset(txtSearchQ); Reset(ddStatusQ); Reset(ddCustomerQ); Set(varSearchQ, Blank()); Set(varStatusQ, Blank()); Set(varCustomerQ, Blank())` |

`btnNewQuote.Text`: `"New quote"`, `Fill`: `clrBrand`, `Color`: `RGBA(255,255,255,1)`.
`btnNewQuote.OnSelect`:

```
Set(
  varCotacao,
  Patch(
    TC_Cotacoes,
    Defaults(TC_Cotacoes),
    {
      Title: "COT-" & Text(Year(Today())) & "-" &
        Text(
          CountRows(Filter(TC_Cotacoes, StartsWith(Title, "COT-" & Text(Year(Today()))))) + 1,
          "0000"
        ),
      QuoteStatus: "RASCUNHO",
      CreatedOn: Today(),
      RequestedBy: User().FullName
    }
  )
);
Navigate(scrQuoteEditor)
```

Same daily-counter caveat as the request numbering: good enough for a first cut, not race-safe if
two people click within the same second. A Power Automate flow assigning the number is the fix,
and it is a small flow — but it needs no Office Scripts, so it can come later without blocking.

### The gallery

`galQuotes` at X 240, Y 156, Width `Parent.Width - 260`, Height `Parent.Height - 176`.
`Items`:

```
SortByColumns(
  Filter(
    TC_Cotacoes,
    (IsBlank(varSearchQ) || varSearchQ in Lower(Title) || varSearchQ in Lower(Project)
      || varSearchQ in Lower(LTI))
    && (IsBlank(varStatusQ) || QuoteStatus = varStatusQ)
    && (IsBlank(varCustomerQ) || CustomerId = varCustomerQ)
  ),
  "Title", SortOrder.Descending
)
```

Descending, so the newest quote is at the top — the opposite of the request queue, which is
ordered by what happens next.

Row template — insert each as a child of the template (right-click an existing child → Insert),
template height 56:

| Control | Position | Formula |
|---|---|---|
| `lblQuoteNo` | X:16 Y:8, W:130 H:22 | `ThisItem.Title` |
| `lblQuoteCustomer` | X:16 Y:30, W:130 H:18 | `LookUp(TC_Clientes, Title = ThisItem.CustomerId, CustomerName)` |
| `lblQuoteProject` | X:160 Y:8, W:200 H:40 | `ThisItem.Project & Char(10) & ThisItem.PartNumber` |
| `lblQuoteLTI` | X:376 Y:16, W:120 H:22 | `ThisItem.LTI` |
| `lblQuoteItems` | X:510 Y:16, W:90 H:22 | `Text(CountRows(Filter(TC_CotacaoItens, QuoteNumber = ThisItem.Title))) & " test(s)"` |
| `lblQuoteTotal` | X:614 Y:16, W:130 H:22 | `"R$ " & Text(Sum(Filter(TC_CotacaoItens, QuoteNumber = ThisItem.Title), Total), "[$-pt-BR]#.##0")` |
| `pillQuoteStatus` | X:760 Y:17, W:170 H:22 | see the pill formulas below |
| `btnOpenQuote` | X:948 Y:14, W:100 H:28 | `Text`: `"Open"` · `OnSelect`: `Set(varCotacao, ThisItem); Navigate(scrQuoteEditor)` |

Pill formulas, the same pattern as the status pills already in the app:

```
Text:  LookUp(colQuoteStatus, Key = ThisItem.QuoteStatus, Label)
Fill:  LookUp(colQuoteStatus, Key = ThisItem.QuoteStatus, Bg)
Color: LookUp(colQuoteStatus, Key = ThisItem.QuoteStatus, Fg)
```

`lblQuoteTotal` sums the line items rather than storing a total on the header. One number in one
place: a stored total is a number that can disagree with the lines under it, and it will.

## Screen 2 — Quote editor (`scrQuoteEditor`)

Opens with `varCotacao` set. Four blocks down the screen: header, add-procedure, line items,
workflow.

### Header

`lblQuoteTitle` — X:240 Y:24, Size 22, Bold:

```
varCotacao.Title & "  ·  " & LookUp(colQuoteStatus, Key = varCotacao.QuoteStatus, Label)
```

Then a form of six fields, three per row, height 40. All of them **read-only once the quote
leaves draft** — set each control's `DisplayMode` to
`If(varCotacao.QuoteStatus = "RASCUNHO", DisplayMode.Edit, DisplayMode.View)`.

| Control | Position | Config |
|---|---|---|
| `ddQCustomer` | X:240 Y:80, W:240 H:40 | `Items`: `TC_Clientes` · `Value`: `CustomerName` · `Default`: `LookUp(TC_Clientes, Title = varCotacao.CustomerId, CustomerName)` |
| `txtQProject` | X:500 Y:80, W:240 H:40 | `Default`: `varCotacao.Project` |
| `txtQPartNumber` | X:760 Y:80, W:240 H:40 | `Default`: `varCotacao.PartNumber` |
| `txtQLTI` | X:240 Y:160, W:240 H:40 | `Default`: `varCotacao.LTI` |
| `txtQRequestedBy` | X:500 Y:160, W:240 H:40 | `Default`: `varCotacao.RequestedBy` |
| `dpQPlanned` | X:760 Y:160, W:240 H:40 | `DefaultDate`: `varCotacao.PlannedExecution` |
| `txtQNotes` | X:240 Y:220, W:760 H:70 | multiline · `Default`: `varCotacao.Notes` |

`btnSaveHeader` — X:1020 Y:80, W:150 H:40, `Text`: `"Save header"`,
`Visible`: `varCotacao.QuoteStatus = "RASCUNHO"`, `OnSelect`:

```
Set(
  varCotacao,
  Patch(
    TC_Cotacoes,
    LookUp(TC_Cotacoes, Title = varCotacao.Title),
    {
      CustomerId: ddQCustomer.Selected.Title,
      Project: txtQProject.Text,
      PartNumber: txtQPartNumber.Text,
      LTI: txtQLTI.Text,
      RequestedBy: txtQRequestedBy.Text,
      PlannedExecution: dpQPlanned.SelectedDate,
      Notes: txtQNotes.Text
    }
  )
);
Notify("Header saved.", NotificationType.Success)
```

### Adding a procedure

One row, only while the quote is a draft. Wrap the three controls in
`Visible: varCotacao.QuoteStatus = "RASCUNHO"`.

| Control | Position | Config |
|---|---|---|
| `ddAddProcedure` | X:240 Y:310, W:420 H:40 | `Items`: `TC_Procedimentos` · `Value`: `ProcedureName` |
| `txtAddSamples` | X:672 Y:310, W:120 H:40 | Format Number · `Default`: `ddAddProcedure.Selected.Samples` |
| `btnAddItem` | X:804 Y:310, W:160 H:40 | `Text`: `"Add to quote"` |

`btnAddItem.DisplayMode`:

```
If(!IsBlank(ddAddProcedure.Selected) && Value(txtAddSamples.Text) >= 1,
   DisplayMode.Edit, DisplayMode.Disabled)
```

`btnAddItem.OnSelect` — this is where the price is frozen:

```
With(
  {
    proc: ddAddProcedure.Selected,
    qtd: Value(txtAddSamples.Text),
    rate: colHourlyRate
  },
  With(
    {
      horas: proc.SetupHours + proc.TestHours * qtd + proc.ReportingHours,
      insumos: proc.ConsumablesCost
    },
    With(
      {
        total: horas * rate + insumos
      },
      Patch(
        TC_CotacaoItens,
        Defaults(TC_CotacaoItens),
        {
          Title: varCotacao.Title & " · " & proc.Title,
          QuoteNumber: varCotacao.Title,
          ProcedureId: proc.Title,
          ItemName: proc.ProcedureName,
          Revision: proc.Revision,
          Standard: proc.Standard,
          BillableHours: horas,
          HourlyRate: rate,
          HoursCost: horas * rate,
          ConsumablesCost: insumos,
          UnitCost: total / qtd,
          Samples: qtd,
          Total: total
        }
      )
    )
  )
);
Reset(ddAddProcedure);
Reset(txtAddSamples);
Notify("Added.", NotificationType.Success)
```

The nested `With()` is not decoration: Power Fx cannot refer to one name inside the same `With`
that declares it, so `horas` has to exist before `total` can use it. Writing it flat means
repeating the hours expression four times, and the day someone corrects one of the four is the
day the quote stops adding up.

### The line items

`galQuoteItems` — X:240 Y:370, W:`Parent.Width - 260`, H:340. `Items`:

```
SortByColumns(
  Filter(TC_CotacaoItens, QuoteNumber = varCotacao.Title),
  "Title", SortOrder.Ascending
)
```

Sort on `Title`, not on `ProcedureId`: the item's Title is `<quote> · <procedure>`, so it groups
by procedure anyway, and it is the one column SharePoint will always sort by. `ProcedureId` —
like any column the CSV import created as multi-line text — throws two errors at once, "The
specified column 'ProcedureId' ..." and "The function 'SortByColumns' has some invalid
arguments", and the gallery renders empty even though the totals above it are right.

Row template, height 48:

| Control | Position | Formula |
|---|---|---|
| `lblItemProc` | X:16 Y:6, W:240 H:20 | `ThisItem.ItemName` |
| `lblItemStd` | X:16 Y:26, W:240 H:16 | `ThisItem.Standard & " · " & ThisItem.Revision` — Size 10, `clrTextWeak` |
| `lblItemHours` | X:270 Y:14, W:80 H:20 | `Text(ThisItem.BillableHours) & " h"` |
| `lblItemRate` | X:360 Y:14, W:110 H:20 | `"R$ " & Text(ThisItem.HourlyRate, "[$-pt-BR]#.##0,00")` |
| `lblItemHoursCost` | X:480 Y:14, W:110 H:20 | `"R$ " & Text(ThisItem.HoursCost, "[$-pt-BR]#.##0")` |
| `lblItemConsum` | X:600 Y:14, W:110 H:20 | `"R$ " & Text(ThisItem.ConsumablesCost, "[$-pt-BR]#.##0")` |
| `lblItemUnit` | X:720 Y:14, W:110 H:20 | `"R$ " & Text(ThisItem.UnitCost, "[$-pt-BR]#.##0")` — the average per sample |
| `lblItemSamples` | X:840 Y:14, W:60 H:20 | `Text(ThisItem.Samples)` |
| `lblItemTotal` | X:910 Y:14, W:120 H:20 | `"R$ " & Text(ThisItem.Total, "[$-pt-BR]#.##0")` — Bold |
| `btnRemoveItem` | X:1044 Y:10, W:90 H:28 | `Text`: `"Remove"` · `Visible`: `varCotacao.QuoteStatus = "RASCUNHO"` · `OnSelect`: `Remove(TC_CotacaoItens, ThisItem)` |

Add column headers above the gallery as plain labels, at Y 348, matching those X positions:
`PROCEDURE`, `HOURS`, `RATE`, `HOURS COST`, `CONSUMABLES`, `UNIT`, `SAMPLES`, `TOTAL` — same
treatment as the Requests screen. Delete the `NextArrow` icon Power Apps puts in the template:
nothing opens from a line, and the chevron invites a click that does nothing.

On a 1366×768 screen the four blocks only fit if the gallery is 250 tall, not 340 — the workflow
bar below it needs 100 px. Set `galQuoteItems.Height` to 250 and drop `lblQuoteGrandTotal` to
Y 630.

`lblQuoteGrandTotal` — X:910 Y:630, W:240 H:34, Size 18, Bold:

```
"Total  R$ " &
Text(Sum(Filter(TC_CotacaoItens, QuoteNumber = varCotacao.Title), Total), "[$-pt-BR]#.##0")
```

### The workflow buttons

One gallery, not a row of hand-placed buttons: the moves come from `colQuoteMoves`, so the rule
lives in one place and the screen follows it.

This block needs `colMinhaFuncao`, the named formula from *power-app-v1.md* that reads
`TC_Perfis`. If that list was never created, create it now — `Title` = the person's email,
`Role` (Choice: `PRODUTO`, `TESTES`), one row per person — add it as a data source and add the
named formula. Without it every button below is invisible, which looks exactly like a broken
screen. Note the `.Value` in that formula: a Choice column returns a record, not text, and
leaving it off puts a red X on the whole `App.Formulas` block.

`txtMoveNote` — Input → Text input, X:240 Y:678, W:520 H:40, `Default`: `""`, HintText
`Reason (required when returning or declining)`. It sits **outside** the gallery, which is why
the button formula can reach it.

`galQuoteMoves` — Insert → Gallery → **Blank horizontal**, X:776 Y:678, W:560 H:48,
`TemplateSize`: 210, `ShowScrollbar`: `false`, `TemplatePadding`: 0. `Items`:

```
Filter(
  colQuoteMoves,
  From = varCotacao.QuoteStatus,
  Role = colMinhaFuncao
)
```

Inside the template, one button `btnMove`, X:0 Y:4, W:200 H:40, `Text`: `ThisItem.Label`,
`Fill`: `clrBrand`, `Color`: `RGBA(255,255,255,1)`. `OnSelect`:

```
Set(varMoveFrom, ThisItem.From);
Set(varMoveTo, ThisItem.To);
Set(varMoveLabel, ThisItem.Label);
Set(varMoveNeedsNote, ThisItem.NeedsNote);
If(
  varMoveNeedsNote && IsBlank(txtMoveNote.Text),
  Notify("This move needs a note explaining why.", NotificationType.Error),
  Patch(
    TC_Historico,
    Defaults(TC_Historico),
    {
      Title: varCotacao.Title & " · " & Text(Now(), "yyyy-mm-dd hh:mm:ss"),
      RecordType: "Cotacao",
      Record: varCotacao.Title,
      MovedOn: Now(),
      FromStatus: varMoveFrom,
      ToStatus: varMoveTo,
      Role: colMinhaFuncao,
      Note: txtMoveNote.Text
    }
  );
  Set(
    varCotacao,
    Patch(
      TC_Cotacoes,
      LookUp(TC_Cotacoes, Title = varCotacao.Title),
      { QuoteStatus: varMoveTo }
    )
  );
  Reset(txtMoveNote);
  Notify("Quote moved to " & varMoveLabel & ".", NotificationType.Success)
)
```

**The four `Set()` calls at the top are not style — they are the fix for a bug that is hard to
find afterwards.** The moment `varCotacao.QuoteStatus` changes, `galQuoteMoves.Items` re-filters
and the row the button lives in disappears, taking `ThisItem` with it. Read `ThisItem` after
that point and the history row is written with a blank `FromStatus` and `ToStatus` — a workflow
that silently forgets where it came from. Capturing first, and writing the history **before** the
status change, keeps both writes on the values the person actually clicked.

If `Patch` rejects `{ QuoteStatus: varMoveTo }` with "expects a Record value", the column came
through as a real Choice rather than as text — write `{ QuoteStatus: { Value: varMoveTo } }`
instead, and the same for `RecordType` on the history row.

Two moves require a note (`Return to requester`, `Decline quote`) and the check above enforces
it. That is not bureaucracy: those are the two moves that cost someone else work, and a returned
quote with no reason attached generates a phone call to find out why.

## Excel export

Power Automate does this better than the app can. A flow triggered by a button in the app
(**Power Automate** pane → create a flow, trigger *Power Apps*), which reads
`TC_CotacaoItens` for the quote number passed in, builds an HTML table and attaches it as an
`.xls` — or writes into a real workbook template kept in the site's library.

Leave it until the screens are in use. The quote is readable and printable from the app already,
and the export is the sort of thing that gets specified better after the first three quotes have
been sent.

## Done when…

* A product engineer can create a draft, add three procedures with different sample counts, and
  see a total that matches the sum of the lines.
* The same procedure added with 1 sample and with 3 shows a **lower unit price** on the second —
  the setup and the report are spread across more runs. If the unit price is identical, the
  formula multiplied the wrong term.
* Changing `TC_Parametros.Value` (the hourly rate) afterwards leaves that quote's numbers exactly
  as they were — this is the test that proves the price freeze works, and it is worth doing
  deliberately.
* A draft cannot be moved by a test engineer, and a quote under review cannot be moved by a
  product engineer — the buttons simply are not there.
* Returning a quote without a note is refused; with a note, `TC_Historico` gains a row naming
  who moved it, from what, to what, and why.
* An approved quote's line items can no longer be removed.
