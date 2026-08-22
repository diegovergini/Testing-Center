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
| `last` | `item()?['LastCalibration']` |
| `due` | `if(or(empty(item()?['LastCalibration']), empty(item()?['IntervalMonths'])), '', addToTime(item()?['LastCalibration'], int(item()?['IntervalMonths']), 'Month', 'yyyy-MM-dd'))` |

An instrument with no last calibration or no interval comes out with an empty `due` and is
reported separately below — it is a gap in the register, not an instrument in date.

### 3. Split into three groups

Three **Filter array** actions, all From `body('With_due_date')`:

| Action | Condition |
|---|---|
| `Overdue` | `item()?['due']` is not equal to `` **and** `item()?['due']` is less than `@{formatDateTime(utcNow(), 'yyyy-MM-dd')}` |
| `Due soon` | `item()?['due']` is greater than or equal to `@{formatDateTime(utcNow(), 'yyyy-MM-dd')}` **and** `item()?['due']` is less than or equal to `@{formatDateTime(addDays(utcNow(), 42), 'yyyy-MM-dd')}` |
| `No due date` | `item()?['due']` is equal to `` |

Six weeks of look-ahead is enough to book a laboratory slot without the list being so long that
it stops being read.

### 4. Turn each into a table

Three **Create HTML table** actions — `Table overdue`, `Table due soon`, `Table missing` — each
From the matching Filter array output, Columns set to *Custom*:

| Header | Value |
|---|---|
| Code | `item()?['code']` |
| Instrument | `item()?['name']` |
| Station | `item()?['station']` |
| Last calibration | `item()?['last']` |
| Due | `item()?['due']` |

On `Table missing`, drop the Due column — it is empty by definition.

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

Run it once by hand (**Test → Manually**) and check the e-mail against the list. Two things to
confirm on the first run:

* **The overdue count is around 70.** Far from that means the `addToTime` expression is reading
  the wrong column, or `IntervalMonths` did not survive the conversion to a number.
* **`No due date on record` is empty or nearly so.** It should be, since all 229 rows have both
  fields. A long list there means the conversion to Number or Date left blanks behind.

Then let it run weekly. It costs nothing to leave on, and the first Monday it reports zero overdue
is the day the register is genuinely under control.

## Afterwards

The natural extension, once someone is acting on the e-mail: a second flow on
`TC_Calibracoes` — when a certificate is recorded there, write its date onto the instrument's
`LastCalibration`, so the register updates itself instead of being maintained twice.
