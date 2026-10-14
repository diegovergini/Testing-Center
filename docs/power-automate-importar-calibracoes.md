# Importing the calibration spreadsheet into SharePoint

Three times a year the metrology spreadsheet gets a batch of new calibration dates, and
`TC_Instrumentos` has to catch up. This is the flow that does it — on demand, from a button, with
a summary of what it changed.

It belongs to whoever is doing the calibration alert: same list, same rules, and the alert is
only as good as the dates underneath it.

## Why a flow and not a paste

*Edit in grid view* and pasting a column of dates works, costs nothing, and is how the 229 rows
got loaded in the first place. For a one-off load that is the right tool.

For a recurring update it is the wrong one, for a single reason: **pasting matches by row
position, and the flow matches by instrument code.** The grid is sorted however the view is
sorted; the spreadsheet is sorted however metrology sorted it. One retired instrument, one added
sensor, one different sort order, and 229 dates land one row off — silently, with no error, onto
instruments they do not belong to. Nothing fails. You find out at an audit.

Matching on `TCL-AC-012` cannot do that. It can only fail loudly, by reporting a code it did not
find.

The flow also fills `TC_Calibracoes`, which is still empty. That is the register of certificates
— one row per certificate, with the result, the laboratory and the document number. The
instrument carries the latest state; the register carries the history. Pasting into the grid
gives you the first and never the second.

## Part A — prepare the spreadsheet

Put the file in the site's **Documents** library — `Calibracoes.xlsx`. Not OneDrive, not a local
drive: the flow reads it from the site.

Inside, the data has to be a **real Excel Table**: select the range and press **Ctrl+T**, tick
*My table has headers*. The connector cannot see a plain range — it lists tables only, and a
sheet with no table shows an empty dropdown with no explanation.

Columns, with these exact headers:

| Header | Content | Example |
|---|---|---|
| `Code` | the instrument code — this is the match key | `TCL-AC-012` |
| `CalibrationDate` | the date on the certificate | `2026-05-14` |
| `Result` | `APROVADO`, `APROVADO_RESTRICAO` or `REPROVADO` | `APROVADO` |
| `Certificate` | certificate number | `CERT-2026-0481` |
| `Laboratory` | who did it | `Metrolab` |
| `CarriedOutBy` | who recorded it | `Diego Vergini` |
| `NextCalibration` | *optional* — only when the certificate states a validity that is not the standard interval | |
| `Notes` | *optional* | |

> **Format `CalibrationDate` and `NextCalibration` as Text, and write them as `yyyy-MM-dd`.**
> A cell formatted as Date comes out of the Excel connector as a serial number — `46156` instead
> of `2026-05-14` — and SharePoint accepts it as a date in 1926. This is the single most common
> way this flow goes wrong, and the result looks like data, not like an error.

Only put in the rows that changed. The flow updates what it is given and leaves the rest alone,
so a spreadsheet of twelve instruments is a twelve-row run.

## Part B — the flow

Create **TC — Import calibrations**, trigger **Manually trigger a flow**. Three times a year does
not want a schedule: you run it when metrology hands you the file, and you want to be watching
when it runs.

### 1. Read the spreadsheet

**Excel Online (Business) → List rows present in a table**, named `Read sheet`:

| Field | Value |
|---|---|
| Location | the SharePoint site |
| Document Library | `Documents` |
| File | `Calibracoes.xlsx` |
| Table | `Table1` |

### 2. Two variables for the summary

Two **Initialize variable** actions, before the loop:

| Name | Type | Value |
|---|---|---|
| `Updated` | Integer | `0` |
| `NotFound` | String | *(empty)* |

### 3. The loop

**Apply to each**, over `outputs('Read_sheet')?['body/value']`. Open its settings and set
**Concurrency Control on, degree 1** — the rows are few, and a sequential run keeps the summary
in the spreadsheet's order and avoids throttling the SharePoint connector.

Inside it, in order:

**a. Find the instrument.** A **Get items** on `TC_Instrumentos`, named `Find instrument`:

| Field | Value |
|---|---|
| Filter Query | `Title eq '@{items('Apply_to_each')?['Code']}'` |
| Top Count | `1` |

**b. A Condition** named `Found?`:
`length(outputs('Find_instrument')?['body/value'])` **is greater than** `0`.

### In the "If no" branch

One **Append to string variable** on `NotFound`:

```
@{items('Apply_to_each')?['Code']};
```

A code in the spreadsheet that is not in the list is the one error worth stopping for, and this
is how it reaches you instead of vanishing.

### In the "If yes" branch

**c. Record the certificate.** A **Create item** on `TC_Calibracoes`, named `Log certificate`:

| Field | Value |
|---|---|
| Title | `@{items('Apply_to_each')?['Code']} · @{items('Apply_to_each')?['CalibrationDate']}` |
| InstrumentId | `items('Apply_to_each')?['Code']` |
| CalibrationDate | `items('Apply_to_each')?['CalibrationDate']` |
| Result | `items('Apply_to_each')?['Result']` |
| NextCalibration | `if(empty(items('Apply_to_each')?['NextCalibration']), null, items('Apply_to_each')?['NextCalibration'])` |
| Certificate | `items('Apply_to_each')?['Certificate']` |
| Laboratory | `items('Apply_to_each')?['Laboratory']` |
| CarriedOutBy | `items('Apply_to_each')?['CarriedOutBy']` |
| Notes | `items('Apply_to_each')?['Notes']` |

**d. Update the instrument.** An **Update item** on `TC_Instrumentos`, named `Update instrument`:

| Field | Value |
|---|---|
| Id | `first(outputs('Find_instrument')?['body/value'])?['ID']` |
| Title | `items('Apply_to_each')?['Code']` |
| LastCalibration | `items('Apply_to_each')?['CalibrationDate']` |
| LastResult | `items('Apply_to_each')?['Result']` |
| Certificate | `items('Apply_to_each')?['Certificate']` |
| Laboratory | `items('Apply_to_each')?['Laboratory']` |
| NextCalibration | `if(equals(items('Apply_to_each')?['Result'], 'REPROVADO'), null, if(empty(items('Apply_to_each')?['NextCalibration']), null, items('Apply_to_each')?['NextCalibration']))` |
| InstrumentStatus | `if(equals(items('Apply_to_each')?['Result'], 'REPROVADO'), 'FORA_DE_USO', 'EM_USO')` |

Leave every other field blank — the connector keeps what is already there.

**Those last two rows are the rule, not decoration.** A failed calibration renews nothing and
takes the instrument out of service: `NextCalibration` is cleared and the status goes to
`FORA_DE_USO`. Without it, a failed instrument would come back from this flow looking renewed for
another twelve months, which is the one outcome worse than not importing at all. It is the same
rule `src/store.js` applies when a calibration is recorded in the web version.

`NextCalibration` stays empty unless the certificate states its own validity. The due date is
computed from `LastCalibration + IntervalMonths` everywhere else — the alert flow, the Power BI
page — and a stored date that disagrees with the computed one is a second source of truth nobody
asked for. Fill it only when the certificate genuinely says something different.

**e. Count it.** An **Increment variable** on `Updated`, by `1`.

### 4. The summary

After the loop, a **Send an email (V2)** to yourself:

Subject:
```
Calibrations imported: @{variables('Updated')} updated
```

Body:
```html
<p><strong>@{variables('Updated')}</strong> instruments updated from
   @{length(outputs('Read_sheet')?['body/value'])} rows in the spreadsheet.</p>

<p><strong>Codes not found in TC_Instrumentos:</strong><br>
   @{if(empty(variables('NotFound')), 'none', variables('NotFound'))}</p>
```

The two numbers should be equal. When they are not, the difference is exactly the list underneath
— that is the whole purpose of the e-mail.

## Running it

1. Metrology sends the spreadsheet.
2. Open `Calibracoes.xlsx` in the Documents library, replace the rows, check the dates still read
   `2026-05-14` and not `46156`, save.
3. Open the flow, **Run** (the Run button, top right).
4. Read the summary e-mail. Numbers equal, no codes listed → done.
5. If codes are listed: a typo in the spreadsheet, an instrument that was retired, or one that
   was never loaded. Fix and run again — the flow is safe to re-run, it just writes the same
   values a second time.
6. Monday's alert now reports against the new dates.

## The first run

Do it with **three rows**, not with the whole batch. Pick one `APROVADO`, one `REPROVADO`, and
one code you deliberately mistype.

Expect: two instruments updated, two rows in `TC_Calibracoes`, the failed one showing
`FORA_DE_USO` with `NextCalibration` empty, and the mistyped code in the e-mail. If all four of
those are right, the flow is right, and the rest of the batch is the same thing more times.

## When it does not work

**The Table dropdown is empty.** The data in the spreadsheet is not an Excel Table. Ctrl+T.

**Dates land in 1926 or 2096.** `CalibrationDate` is formatted as Date in Excel and arrives as a
serial number. Format the column as Text and rewrite the dates as `yyyy-MM-dd`.

**Every row goes to the "not found" branch.** The `Filter Query` has lost its quotes. It must be
`Title eq '...'` with the single quotes around the value.

**`Update item` fails on `InstrumentStatus` or `LastResult`.** Those are Choice columns and the
value has to be one of the keys exactly — `EM_USO`, `FORA_DE_USO`, `APROVADO`,
`APROVADO_RESTRICAO`, `REPROVADO`. The English labels are not stored anywhere; they belong to the
screen.

**The flow updates the wrong instruments.** It cannot, by construction — it matches on `Code`.
If the data looks wrong, the spreadsheet's `Code` column is wrong, and that is worth checking
before anything else.
