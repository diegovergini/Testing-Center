# Step 3 — Scheduling: the Office Script and the flow that runs it

This is what replaces *“Awaiting scheduling”* on every row of the Requests screen with a real
start date, end date and rig.

The Power App does not schedule anything and should not: allocation is an algorithm — a
day-by-day search, picking whichever unit inside a group frees up first, tests that hold two rigs
at once, each machine's calendar and its maintenance windows, priority ordering. Power Fx has no
recursion and hits delegation limits. So the engine runs where it can: **Office Scripts run
TypeScript inside Microsoft 365**, and a Power Automate flow calls it.

```
Power Automate          reads the lists, builds one JSON payload
        │
Office Script           computes the allocation, returns one JSON answer
        │
Power Automate          writes PlannedStart / PlannedEnd / AllocatedEquipment / BlockingReason
        │
Power App               just displays it — no change needed to the app
```

The script is `ferramentas/agendador-office-script.ts`. It is a port of `src/scheduler.js`, and
`tests/agendador-office.test.js` runs both engines against the same scenarios and fails if they
place a single request differently. Keep the two in step: a rule changed on one side and not the
other means the web version and the Power App start disagreeing about which rig a test lands on,
with nothing failing to say so.

## Before you start

**The data has to be there.** The script cannot allocate a test to a rig it does not know about.
Every procedure needs `EquipmentGroups` filled, and hours that are not all zero — see the phase 2
runbook. A procedure with no group comes back as *“Procedure with no equipment defined.”*, which
is correct behaviour and useless output.

**A workbook to host the script.** Office Scripts live in Excel. Create an empty workbook in the
site's *Documents* library — `Agendador.xlsx` — and leave it empty. The script never reads or
writes it; Office Scripts simply require a workbook to be attached to.

**Connections.** The flow uses *SharePoint* and *Excel Online (Business)*. The account running it
needs contribute rights on the lists.

## Part A — create the script

1. Open `Agendador.xlsx` in Excel on the web.
2. **Automate → New Script**.
3. Delete the sample code, paste the whole of `ferramentas/agendador-office-script.ts`.
4. Rename it **Testing Center — Scheduler** (the flow picks it by name) and **Save**.

The editor will show no errors. If it complains about `ExcelScript.Workbook`, you pasted into the
wrong kind of editor — it must be the Office Scripts pane inside Excel, not Power Apps.

## Part B — the flow

Create a flow named **TC — Schedule requests**, triggered by **When an item is created**
(SharePoint), site = the Testing Center site, list = `TC_Demandas`.

> Use *item is created*, not *created or modified*. The flow's own last step modifies
> `TC_Demandas`; on the *modified* trigger it would call itself forever.

### 1. Read the lists

Six **Get items** actions, all on the same site. Rename each one as shown — the expressions below
refer to these names.

| Action name | List | Settings |
|---|---|---|
| `Get equipment` | `TC_Equipamentos` | — |
| `Get maintenance` | `TC_Manutencoes` | — |
| `Get procedures` | `TC_Procedimentos` | Top Count `200` |
| `Get part types` | `TC_Pecas` | — |
| `Get rate` | `TC_Parametros` | Filter Query `Title eq 'HourlyRate'` |
| `Get requests` | `TC_Demandas` | Top Count `5000`, Pagination on |

No status filter on `Get requests`: the script already ignores anything that is not `SOLICITADA`,
`ACEITA` or `EM_EXECUCAO`, and one filter in one place is one thing to get wrong instead of two.

### 2. Reshape each list

Five **Select** actions. *From* is the matching `Get …` output; the map is key/value pairs.

**`Select equipment`** — From: `outputs('Get_equipment')?['body/value']`

| Key | Value |
|---|---|
| `id` | `item()?['Title']` |
| `name` | `item()?['EquipmentName']` |
| `group` | `item()?['GroupName']` |
| `positions` | `item()?['Positions']` |
| `continuous` | `item()?['Continuous']?['Value']` |
| `hoursPerDay` | `item()?['HoursPerDay']` |
| `operatingDays` | `item()?['OperatingDays']` |

**`Select maintenance`** — From: `outputs('Get_maintenance')?['body/value']`

| Key | Value |
|---|---|
| `equipmentId` | `item()?['EquipmentId']` |
| `start` | `item()?['StartDate']` |
| `end` | `item()?['EndDate']` |

**`Select procedures`** — From: `outputs('Get_procedures')?['body/value']`

| Key | Value |
|---|---|
| `id` | `item()?['Title']` |
| `setupHours` | `item()?['SetupHours']` |
| `testHours` | `item()?['TestHours']` |
| `reportingHours` | `item()?['ReportingHours']` |
| `samples` | `item()?['Samples']` |
| `consumablesCost` | `item()?['ConsumablesCost']` |
| `equipmentGroups` | `item()?['EquipmentGroups']` |

**`Select part types`** — From: `outputs('Get_part_types')?['body/value']`

| Key | Value |
|---|---|
| `id` | `item()?['Title']` |
| `costPerSample` | `item()?['CostPerSample']` |

**`Select requests`** — From: `outputs('Get_requests')?['body/value']`

| Key | Value |
|---|---|
| `id` | `item()?['ID']` |
| `ref` | `item()?['Title']` |
| `procedureId` | `item()?['ProcedureId']` |
| `partTypeId` | `item()?['PartTypeId']` |
| `priority` | `item()?['Priority']?['Value']` |
| `ltiClassification` | `item()?['LTIClassification']?['Value']` |
| `status` | `item()?['RequestStatus']?['Value']` |
| `samplesAvailableFrom` | `item()?['SamplesAvailableFrom']` |
| `dueDate` | `item()?['DueDate']` |
| `forcedStart` | `item()?['ForcedStart']` |
| `quantity` | `item()?['Quantity']` |
| `createdAt` | `item()?['Created']` |

`id` is the numeric list item ID, which is what the last step needs to write the answer back;
`ref` carries the human code (`DM-20260817-001`) so the update can keep the Title intact. The
script treats both as opaque and hands them back untouched.

**No conversions here on purpose.** Choice columns come as `?['Value']`, everything else goes
across raw — text where a number was expected, `"Yes"`/`"No"`, `"0; 1; 2; 3; 4; 5; 6"`,
timestamps instead of dates. The script normalises all of it on the way in. A Select action full
of `int()`, `split()` and `if()` expressions is the most fragile thing you can build in Power
Automate, and it would break the day someone converts a column to its proper type.

### 3. Build the payload

A **Compose** action named `Payload`, with this as its input (paste it as text; the `@{}` parts
resolve):

```json
{
  "today": "@{formatDateTime(utcNow(), 'yyyy-MM-dd')}",
  "hourlyRate": "@{first(outputs('Get_rate')?['body/value'])?['Value']}",
  "equipment": @{body('Select_equipment')},
  "maintenance": @{body('Select_maintenance')},
  "procedures": @{body('Select_procedures')},
  "partTypes": @{body('Select_part_types')},
  "requests": @{body('Select_requests')}
}
```

### 4. Run the script

An **Excel Online (Business) → Run script** action:

| Field | Value |
|---|---|
| Location | the SharePoint site |
| Document Library | `Documents` |
| File | `Agendador.xlsx` |
| Script | `Testing Center — Scheduler` |
| `payload` | `string(outputs('Payload'))` |

### 5. Read the answer

A **Parse JSON** action named `Plan`, content `body('Run_script')?['result']`, with this schema:

```json
{
  "type": "object",
  "properties": {
    "scheduled": { "type": "integer" },
    "blocked": { "type": "integer" },
    "quotes": { "type": "integer" },
    "results": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "ref": { "type": "string" },
          "plannedStart": { "type": "string" },
          "plannedEnd": { "type": "string" },
          "allocatedEquipment": { "type": "string" },
          "operatingDays": { "type": "integer" },
          "blockingReason": { "type": "string" },
          "isQuote": { "type": "boolean" },
          "cost": { "type": "number" },
          "slackDays": {},
          "late": { "type": "boolean" }
        }
      }
    }
  }
}
```

`slackDays` is left untyped on purpose: it is a number when the request has a due date and `null`
when it does not, and Parse JSON rejects a null against `"type": "integer"`.

### 6. Write it back

An **Apply to each** over `body('Plan')?['results']`, containing one **Update item** on
`TC_Demandas`:

| Field | Value |
|---|---|
| Id | `items('Apply_to_each')?['id']` |
| Title | `items('Apply_to_each')?['ref']` |
| PlannedStart | `if(empty(items('Apply_to_each')?['plannedStart']), null, items('Apply_to_each')?['plannedStart'])` |
| PlannedEnd | `if(empty(items('Apply_to_each')?['plannedEnd']), null, items('Apply_to_each')?['plannedEnd'])` |
| AllocatedEquipment | `items('Apply_to_each')?['allocatedEquipment']` |
| BlockingReason | `items('Apply_to_each')?['blockingReason']` |

The `if(empty(...), null, ...)` on the two dates matters: an empty string into a date column
fails the action, and an unplaced request legitimately has no dates. Passing `null` clears the
column, which is what should happen when a request that used to have a slot loses it.

Leave every other field of Update item blank — the connector keeps what is already there.

Set **Concurrency Control on**, degree 1, on the Apply to each. The updates are cheap and running
them in parallel only buys throttling.

## Part C — the daily run

The flow above reschedules when a request is created. Things that change without a request being
created — a maintenance window added this morning, a due date moved, a request cancelled — need a
second pass.

Do not rebuild it: open the flow, **Save As** → name it **TC — Schedule requests (daily)**, then
in the copy delete the SharePoint trigger and add a **Recurrence** trigger, once a day, early
enough to be done before people arrive. Everything below the trigger already works, because
nothing in the flow uses the trigger's output.

## Testing it before trusting it

In order, on the real site:

1. **One request, one rig.** Create a request for a procedure with a single equipment group.
   Expect: a slot within a minute, `AllocatedEquipment` naming one machine.
2. **Two requests, same rig.** Create a second request for the same procedure. Expect: it queues
   after the first — the windows must not overlap.
3. **Two groups at once.** A procedure listing two groups should reserve a unit in each, for the
   same window, and `AllocatedEquipment` should read `Burner 1 + Shaker`.
4. **Maintenance blocks.** Add a window in `TC_Manutencoes` covering the slot of an existing
   request and run the daily flow by hand. Expect: that request moves.
5. **A quote takes nothing.** A request with `LTIClassification = COTACAO` should come back with
   no dates and *“Quote — takes no rig.”* in `BlockingReason`, while a real request scheduled at
   the same time keeps its slot.
6. **An impossible request explains itself.** Point a request at a procedure with no equipment
   group. Expect `BlockingReason` = *“Procedure with no equipment defined.”* — visible, not
   silently skipped.

## When it does not work

**Every request comes back blocked with “no unit registered”.** `EquipmentGroups` on the
procedure does not match `GroupName` on any equipment. The values are case sensitive and must
match exactly — `Burner`, `MTS`, `Shaker`, `LMS / PTA`, `ColdFlow`, `Dynamometer`.

**Everything is scheduled to start and finish the same day.** The procedure's hours are still
zero. The engine is right; the data is not.

**Run script fails with a parse error.** `Payload` is not valid JSON. Open the run history, copy
the Compose output and paste it into any JSON validator — nine times out of ten a Select action
returned `null` because a list name was mistyped, and `"equipment": ,` is the result.

**Update item fails on a date.** The `if(empty(...), null, ...)` wrapper is missing on
`PlannedStart` or `PlannedEnd`.

**The flow runs forever in a loop.** The trigger is *When an item is created or modified*. It has
to be *created*.

**Requests stop being scheduled after a while.** `Get requests` is capped at its default 100
items. Set Top Count to 5000 and turn Pagination on.

## What this step does not do

Notifications, the Gantt and the quote screen are steps 4 and 5. The calibration alert — a
scheduled flow sweeping `TC_Instrumentos` every Monday — depends on none of this and is worth
building first if this one stalls.
