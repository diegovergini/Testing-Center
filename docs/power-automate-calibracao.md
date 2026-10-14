# The calibration alert

A scheduled flow that sweeps `TC_Instrumentos` every Monday and e-mails whoever looks after
metrology what has fallen due and what falls due next.

It is worth building out of order, before the scheduling engine: it depends on no other step, it
needs no Office Scripts, and it addresses something the current tools genuinely cannot do.

## Why this one first

On the data as loaded, with the next due date taken as the last calibration plus the instrument's
own interval:

| | Instruments |
|---|---|
| Already overdue | **70** |
| Falling due within six weeks | 8 |
| In date | 151 |
| **Total** | **229** |

Seventy instruments are past due and nothing tells anyone. In the web version that only becomes
visible to whoever happens to open the calibration screen; in the Power App v1 there is no
calibration screen at all. A weekly e-mail turns a passive number into something that reaches a
person.

**`NextCalibration` is empty on all 229 rows.** Only `LastCalibration` and `IntervalMonths` came
across in the load. The flow therefore computes the due date rather than reading it — which is
better anyway: it stays right the moment someone records a new calibration, with no second field
to keep in step.

## The flow

Create **TC — Calibration due**, triggered by **Recurrence**: weekly, Monday, 07:00 (set the time
zone, or use 10:00 UTC for Brasília).

### 1. Read the instruments

**Get items** on `TC_Instrumentos`, named `Get instruments`:

* Top Count `500`, Pagination on — there are 229 and the default cap is 100.
* Filter Query: `Active eq 'Yes'`

Retired instruments should not raise an alert, and the register keeps them.

### 2. Work out what is due

A **Select** named `With due date`, From `outputs('Get_instruments')?['body/value']`:

| Key | Value |
|---|---|
| `code` | `item()?['Title']` |
| `name` | `item()?['InstrumentName']` |
| `station` | `item()?['Station']` |
| `status` | `item()?['InstrumentStatus']?['Value']` |
| `result` | `item()?['LastResult']?['Value']` |
| `last` | `item()?['LastCalibration']` |
| `due` | `if(or(equals(item()?['LastResult']?['Value'], 'REPROVADO'), or(empty(item()?['LastCalibration']), empty(item()?['IntervalMonths']))), '', addToTime(item()?['LastCalibration'], int(item()?['IntervalMonths']), 'Month', 'yyyy-MM-dd'))` |

An instrument with no last calibration or no interval comes out with an empty `due` and is
reported separately below — it is a gap in the register, not an instrument in date.

**A failed calibration has no validity, which is why `REPROVADO` also comes out with an empty
`due`.** Without that guard, the date of the failure plus the interval would produce a future due
date and the instrument would report as *in date* **because** it failed — the opposite of what
happened. This is the same rule `vencimento()` enforces in `src/calibracao.js`, and it bites the
moment real calibration results are loaded: on the seed data `LastResult` is empty on all 229
rows, so nothing looks wrong until the first import.

### 3. Split into four groups

Four **Filter array** actions, all From `body('With_due_date')`:

| Action | Condition |
|---|---|
| `Overdue` | `item()?['due']` is not equal to `` **and** `item()?['due']` is less than `@{formatDateTime(utcNow(), 'yyyy-MM-dd')}` |
| `Due soon` | `item()?['due']` is greater than or equal to `@{formatDateTime(utcNow(), 'yyyy-MM-dd')}` **and** `item()?['due']` is less than or equal to `@{formatDateTime(addDays(utcNow(), 42), 'yyyy-MM-dd')}` |
| `Failed` | `item()?['result']` is equal to `REPROVADO` |
| `No due date` | `item()?['due']` is equal to `` **and** `item()?['result']` is not equal to `REPROVADO` |

Six weeks of look-ahead is enough to book a laboratory slot without the list being so long that
it stops being read.

`Failed` and `No due date` are kept apart because they need different people to do different
things: a failed instrument is out of service and needs repair or replacement; a blank due date
is a register someone has to go and fill in.


### 4. Turn each into a table

Four **Create HTML table** actions — `Table overdue`, `Table due soon`, `Table failed`,
`Table missing` — each From the matching Filter array output, Columns set to *Custom*:

| Header | Value |
|---|---|
| Code | `item()?['code']` |
| Instrument | `item()?['name']` |
| Station | `item()?['station']` |
| Last calibration | `item()?['last']` |
| Due | `item()?['due']` |

On `Table failed` and `Table missing`, drop the Due column — it is empty by definition on both.
On `Table failed`, add a `Status` column with `item()?['status']`: an instrument that failed and
is still `EM_USO` is the single worst row in the whole e-mail.

### 5. Send it

**Send an email (V2)**, to whoever looks after metrology, Subject:

```
Calibration: @{length(body('Overdue'))} overdue, @{length(body('Due_soon'))} due within six weeks
```

Body — switch the editor to **code view** (`</>`) so the tables render:

```html
<p>Calibration status of the test centre instruments, @{formatDateTime(utcNow(), 'dd/MM/yyyy')}.</p>

<h3>Overdue — @{length(body('Overdue'))}</h3>
@{body('Table_overdue')}

<h3>Due within six weeks — @{length(body('Due_soon'))}</h3>
@{body('Table_due_soon')}

<h3>Failed last calibration — @{length(body('Failed'))}</h3>
<p>A failed calibration carries no validity. These have no due date because they are not in
date at all — they need repair, re-calibration or replacement.</p>
@{body('Table_failed')}

<h3>No due date on record — @{length(body('No_due_date'))}</h3>
<p>These have no last calibration or no interval registered, so no due date can be worked out.</p>
@{body('Table_missing')}

<p style="color:#64748b;font-size:12px">
  Sent by the Testing Center flow, every Monday. The due date is the last calibration plus the
  instrument's interval — it is computed, not stored, so recording a new calibration in
  TC_Instrumentos updates it straight away.
</p>
```

Put the count in the subject line: it is the part that gets read on a phone, and a week where it
reads `0 overdue` is worth as much as one where it does not.

## Before switching it on

Run it once by hand (**Test → Manually**) and check the e-mail against the list. Three things to
confirm on the first run:

* **The overdue count is around 70.** Far from that means the `addToTime` expression is reading
  the wrong column, or `IntervalMonths` did not survive the conversion to a number.
* **`No due date on record` is empty or nearly so.** It should be, since all 229 rows have both
  fields. A long list there means the conversion to Number or Date left blanks behind.
* **`Failed last calibration` is empty.** On the data as loaded it has to be — `LastResult` is
  blank on all 229 rows. It stops being empty the first time real results are imported, and that
  is exactly when the guard starts earning its place.

Then let it run weekly. It costs nothing to leave on, and the first Monday it reports zero overdue
is the day the register is genuinely under control.

## Afterwards

Loading the results is the other half of this, and it is written up separately:
[docs/power-automate-importar-calibracoes.md](power-automate-importar-calibracoes.md) — a flow
that reads the metrology spreadsheet and updates `TC_Instrumentos` and `TC_Calibracoes` from it,
matching on the instrument code rather than on row order.

