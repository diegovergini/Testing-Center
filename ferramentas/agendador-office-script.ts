/* Scheduling engine, ported from src/scheduler.js to run as an Office Script.

   Office Scripts run TypeScript inside Microsoft 365 and can be called from a Power Automate
   flow. The flow reads the lists, hands the data over as JSON, and writes the result back onto
   each request — see docs/power-automate-agendamento.md.

   The script never touches the workbook: `workbook` is in the signature because Office Scripts
   require it, and an empty spreadsheet is enough to host the script. Everything comes in through
   `payload` and goes out through the return value.

   This is a port, not a rewrite. The allocation rules, the ordering and the blocking reasons are
   the ones in src/scheduler.js, which is covered by tests. Keep the two in step: a change here
   that is not mirrored there means the web version and the Power App start disagreeing about
   which rig a test lands on. */

/* ---------------------------------------------------------------- shapes coming in and out */

interface Equipment {
  id: string;            /* TC_Equipamentos Title, e.g. "BURNER-1" */
  name: string;
  group: string;         /* GroupName, e.g. "Burner" */
  positions: number;
  continuous: boolean;
  hoursPerDay: number;
  operatingDays: number[]; /* 0 = Sunday ... 6 = Saturday */
}

interface Maintenance {
  equipmentId: string;
  start: string;         /* YYYY-MM-DD */
  end: string;
}

interface Procedure {
  id: string;            /* TC_Procedimentos Title, e.g. "TP-GM-02" */
  setupHours: number;
  testHours: number;
  reportingHours: number;
  samples: number;
  consumablesCost: number;
  equipmentGroups: string[];
}

interface PartType {
  id: string;
  costPerSample: number;
}

interface Request {
  id: string;            /* opaque key the flow uses to write the answer back — the list item ID */
  ref: string;           /* human code of the request (TC_Demandas Title), echoed back untouched */
  procedureId: string;
  partTypeId: string;
  priority: string;      /* ALTA | MEDIA | BAIXA */
  ltiClassification: string;
  status: string;
  samplesAvailableFrom: string;
  dueDate: string;
  forcedStart: string;
  quantity: number;
  createdAt: string;
}

interface Payload {
  today: string;
  hourlyRate: number;
  equipment: Equipment[];
  maintenance: Maintenance[];
  procedures: Procedure[];
  partTypes: PartType[];
  requests: Request[];
}

/* What actually arrives from the flow, before normalise() tidies it up. SharePoint hands over
   numbers as text when the column was never converted, Choice columns as their label, dates as
   full timestamps, and multi-value columns as "; " separated text. */

interface RawEquipment {
  id: string;
  name: string;
  group: string;
  positions: number | string;
  continuous: boolean | string;
  hoursPerDay: number | string;
  operatingDays: number[] | string;
}

interface RawProcedure {
  id: string;
  setupHours: number | string;
  testHours: number | string;
  reportingHours: number | string;
  samples: number | string;
  consumablesCost: number | string;
  equipmentGroups: string[] | string;
}

interface RawPartType {
  id: string;
  costPerSample: number | string;
}

interface RawRequest {
  id: string;
  ref: string;
  procedureId: string;
  partTypeId: string;
  priority: string;
  ltiClassification: string;
  status: string;
  samplesAvailableFrom: string;
  dueDate: string;
  forcedStart: string;
  quantity: number | string;
  createdAt: string;
}

interface RawPayload {
  today: string;
  hourlyRate: number | string;
  equipment: RawEquipment[];
  maintenance: Maintenance[];
  procedures: RawProcedure[];
  partTypes: RawPartType[];
  requests: RawRequest[];
}

interface Result {
  id: string;
  ref: string;
  plannedStart: string;
  plannedEnd: string;
  allocatedEquipment: string;  /* "Burner 1 + Shaker", or "" when unplaced */
  operatingDays: number;
  blockingReason: string;
  isQuote: boolean;
  cost: number;
  slackDays: number | null;    /* days between the end and the due date; negative means late */
  late: boolean;
}

interface Output {
  scheduled: number;
  blocked: number;
  quotes: number;
  results: Result[];
}

/* Internal working shapes. */
interface Window { start: string; end: string; }
interface Group { id: string; name: string; members: Equipment[]; }
interface FreePosition { position: number; freesAt: string | null; }
interface Placement { window: Window; positions: { [equipmentId: string]: number }; }
interface Candidate { units: Equipment[]; window: Window; positions: { [k: string]: number }; days: number; }
interface ResolvedGroups { groups: Group[]; missing: string[]; }

/* ---------------------------------------------------------------- constants */

/* 3 years: past that we treat the request as impossible to place. */
const HORIZON_DAYS = 1095;
const MAX_COMBINATIONS = 400;
const MS_DAY = 86400000;

/* States in which a request still competes for a rig — mirrors fluxo.estadosAtivos(). */
const ACTIVE_STATES: string[] = ["SOLICITADA", "ACEITA", "EM_EXECUCAO"];

/* Priority weights, from data.js PRIORIDADES. Anything unknown sorts last. */
function priorityWeight(id: string): number {
  if (id === "ALTA") return 0;
  if (id === "MEDIA") return 1;
  if (id === "BAIXA") return 2;
  return 9;
}

/* A quote LTI is a budget: it works out cost and duration but reserves no rig. */
function isQuote(request: Request): boolean {
  return request.ltiClassification === "COTACAO";
}

/* ---------------------------------------------------------------- dates, always UTC ISO */

function toDate(iso: string): Date {
  const p = String(iso).slice(0, 10).split("-");
  return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  return toISO(new Date(toDate(iso).getTime() + days * MS_DAY));
}

/* Days from isoA to isoB. Positive when B is later. */
function diffDays(isoA: string, isoB: string): number {
  return Math.round((toDate(isoB).getTime() - toDate(isoA).getTime()) / MS_DAY);
}

function weekday(iso: string): number {
  return toDate(iso).getUTCDay();
}

function laterOf(a: string, b: string): string {
  return diffDays(a, b) > 0 ? b : a;
}

/* "2026-07-26" -> "26 Jul 2026", the format the platform uses everywhere. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = toDate(iso);
  const day = String(d.getUTCDate());
  return (day.length < 2 ? "0" + day : day) + " " + MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear();
}

/* ---------------------------------------------------------------- rig calendars */

function isOperatingDay(equipment: Equipment, iso: string): boolean {
  return equipment.operatingDays.indexOf(weekday(iso)) !== -1;
}

function underMaintenance(equipmentId: string, iso: string, windows: Maintenance[]): boolean {
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    if (w.equipmentId !== equipmentId) continue;
    if (diffDays(w.start, iso) >= 0 && diffDays(iso, w.end) >= 0) return true;
  }
  return false;
}

function anyUnderMaintenance(units: Equipment[], iso: string, windows: Maintenance[]): boolean {
  for (let i = 0; i < units.length; i++) {
    if (underMaintenance(units[i].id, iso, windows)) return true;
  }
  return false;
}

function operatingInAll(units: Equipment[], iso: string): boolean {
  for (let i = 0; i < units.length; i++) if (!isOperatingDay(units[i], iso)) return false;
  return true;
}

/* A test only advances when EVERY rig it occupies is operating: the shortest shift sets the pace. */
function combinedHoursPerDay(units: Equipment[]): number {
  let smallest = 24;
  for (let i = 0; i < units.length; i++) {
    const hours = units[i].continuous ? 24 : (units[i].hoursPerDay || 8);
    if (hours < smallest) smallest = hours;
  }
  return smallest;
}

/* Equipment group: a family of interchangeable units. With no group defined, the unit is its
   own group. Preserves the register order, which is what makes the allocation reproducible. */
function groupEquipment(equipment: Equipment[]): Group[] {
  const order: Group[] = [];
  const seen: { [id: string]: Group } = {};
  for (let i = 0; i < equipment.length; i++) {
    const eq = equipment[i];
    const id = eq.group || eq.name || eq.id;
    if (!seen[id]) {
      seen[id] = { id: id, name: id, members: [] };
      order.push(seen[id]);
    }
    seen[id].members.push(eq);
  }
  return order;
}

/* ---------------------------------------------------------------- hours and duration */

/* Hours that actually hold the rig. Reporting is done afterwards, at a desk. */
function rigHours(procedure: Procedure): number {
  return (procedure.setupHours || 0) + (procedure.testHours || 0);
}

/* Hours billed to the customer: rig time + writing the report. */
function billableHours(procedure: Procedure): number {
  return rigHours(procedure) + (procedure.reportingHours || 0);
}

function operatingDaysNeeded(procedure: Procedure, units: Equipment[]): number {
  const hoursPerDay = units.length ? combinedHoursPerDay(units) : 8;
  return Math.max(1, Math.ceil(rigHours(procedure) / hoursPerDay));
}

/* ---------------------------------------------------------------- window search */

/* From a start date, the calendar window the test occupies. Non-working days inside the window
   still hold the positions — the part stays mounted. Null if it crosses maintenance downtime. */
function calculateWindow(units: Equipment[], start: string, daysNeeded: number,
                         maintenance: Maintenance[]): Window | null {
  let cursor = start;
  let counted = 0;
  let guard = 0;
  while (counted < daysNeeded && guard++ < HORIZON_DAYS) {
    if (anyUnderMaintenance(units, cursor, maintenance)) return null;
    if (operatingInAll(units, cursor)) counted++;
    if (counted < daysNeeded) cursor = addDays(cursor, 1);
  }
  return counted === daysNeeded ? { start: start, end: cursor } : null;
}

function overlaps(a: Window, b: Window): boolean {
  return diffDays(a.start, b.end) >= 0 && diffDays(b.start, a.end) >= 0;
}

function firstConflict(reservations: Window[], window: Window): Window | null {
  for (let i = 0; i < reservations.length; i++) {
    if (overlaps(reservations[i], window)) return reservations[i];
  }
  return null;
}

/* First free position on the machine for the window. Returns the index, or -1 plus the date
   the earliest position frees up. */
function freePosition(positions: Window[][], window: Window): FreePosition {
  let freesAt: string | null = null;
  for (let p = 0; p < positions.length; p++) {
    const conflict = firstConflict(positions[p], window);
    if (!conflict) return { position: p, freesAt: null };
    if (!freesAt || diffDays(conflict.end, freesAt) > 0) freesAt = conflict.end;
  }
  return { position: -1, freesAt: freesAt };
}

/* The first window in which EVERY rig has a free position. */
function searchWindow(units: Equipment[], reservations: { [id: string]: Window[][] },
                      earliest: string, daysNeeded: number,
                      maintenance: Maintenance[]): Placement | null {
  if (!units.length) return null;
  let cursor = earliest;
  const limit = addDays(earliest, HORIZON_DAYS);
  let guard = 0;

  while (diffDays(cursor, limit) > 0 && guard++ < HORIZON_DAYS) {
    if (!operatingInAll(units, cursor) || anyUnderMaintenance(units, cursor, maintenance)) {
      cursor = addDays(cursor, 1);
      continue;
    }
    const window = calculateWindow(units, cursor, daysNeeded, maintenance);
    if (!window) { cursor = addDays(cursor, 1); continue; }

    const chosen: { [id: string]: number } = {};
    let taken = false;
    /* Since every rig has to be free at the same time, the next attempt only makes sense
       after the last of them frees up. */
    let nextAttempt: string | null = null;
    for (let i = 0; i < units.length; i++) {
      const r = freePosition(reservations[units[i].id], window);
      if (r.position === -1) {
        taken = true;
        if (r.freesAt && (!nextAttempt || diffDays(r.freesAt, nextAttempt) < 0)) {
          nextAttempt = r.freesAt;
        }
      } else {
        chosen[units[i].id] = r.position;
      }
    }
    if (!taken) return { window: window, positions: chosen };
    cursor = nextAttempt ? addDays(nextAttempt, 1) : addDays(cursor, 1);
  }
  return null;
}

/* One unit from each group. With few groups and few units the product is small; above the
   ceiling we fall back to the first unit of each group so the recalculation never hangs. */
function unitCombinations(groups: Group[]): Equipment[][] {
  let total = 1;
  for (let i = 0; i < groups.length; i++) total = total * groups[i].members.length;
  if (!total) return [];
  if (total > MAX_COMBINATIONS) {
    return [groups.map((g) => g.members[0])];
  }
  let combinations: Equipment[][] = [[]];
  for (let i = 0; i < groups.length; i++) {
    const next: Equipment[][] = [];
    for (let c = 0; c < combinations.length; c++) {
      for (let m = 0; m < groups[i].members.length; m++) {
        next.push(combinations[c].concat([groups[i].members[m]]));
      }
    }
    combinations = next;
  }
  return combinations;
}

/* Among every possible unit, the one that starts earliest. A tie on the start is broken by
   whichever finishes first — a rig with a longer shift delivers the same test in fewer days. */
function bestAcrossGroups(groups: Group[], procedure: Procedure,
                          reservations: { [id: string]: Window[][] },
                          earliest: string, pinnedStart: string,
                          maintenance: Maintenance[]): Candidate | null {
  let best: Candidate | null = null;
  const combinations = unitCombinations(groups);

  for (let c = 0; c < combinations.length; c++) {
    const units = combinations[c];
    const days = operatingDaysNeeded(procedure, units);
    let found: Placement | null = null;

    if (pinnedStart) {
      const window = calculateWindow(units, pinnedStart, days, maintenance);
      if (window) {
        const positions: { [id: string]: number } = {};
        let free = true;
        for (let u = 0; u < units.length; u++) {
          const r = freePosition(reservations[units[u].id], window);
          if (r.position === -1) free = false; else positions[units[u].id] = r.position;
        }
        if (free) found = { window: window, positions: positions };
      }
    } else {
      found = searchWindow(units, reservations, earliest, days, maintenance);
    }
    if (!found) continue;

    const candidate: Candidate = {
      units: units, window: found.window, positions: found.positions, days: days
    };
    if (!best) { best = candidate; continue; }
    const deltaStart = diffDays(candidate.window.start, best.window.start);
    if (deltaStart > 0 || (deltaStart === 0 && diffDays(candidate.window.end, best.window.end) > 0)) {
      best = candidate;
    }
  }
  return best;
}

/* ---------------------------------------------------------------- cost */

/* (setup + test + reporting hours) x hourly rate + consumables + samples x cost per sample.
   The same formula as src/scheduler.js custoDemanda, which is what the Power App shows. */
function requestCost(request: Request, procedure: Procedure | null,
                     partType: PartType | null, hourlyRate: number): number {
  if (!procedure) return 0;
  const quantity = request.quantity ? request.quantity : procedure.samples;
  const hoursCost = billableHours(procedure) * hourlyRate;
  const consumables = procedure.consumablesCost || 0;
  const samplesCost = quantity * (partType ? (partType.costPerSample || 0) : 0);
  return hoursCost + consumables + samplesCost;
}

/* ---------------------------------------------------------------- lookups */

function findProcedure(list: Procedure[], id: string): Procedure | null {
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

function findPartType(list: PartType[], id: string): PartType | null {
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

function findGroup(list: Group[], id: string): Group | null {
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

function groupNames(groups: Group[]): string {
  return groups.map((g) => g.name).join(" + ");
}

/* ---------------------------------------------------------------- normalising the input

   The flow hands over what SharePoint gives it, and SharePoint gives it raw: a Choice column
   arrives as "Yes", a multi-value column as "Burner; Shaker", a date as a full timestamp, and a
   column still typed as text as a string where a number is expected. Normalising here rather
   than in the flow keeps the flow to plain field mappings — and a Select action full of
   conversion expressions is the single most fragile thing you can build in Power Automate. */

function asNumber(value: string | number, fallback: number): number {
  if (typeof value === "number") return value;
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(String(value).replace(",", "."));
  return isNaN(n) ? fallback : n;
}

function asBoolean(value: boolean | string): boolean {
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  return s === "yes" || s === "true" || s === "sim" || s === "1";
}

/* "2026-08-17T03:00:00Z" and "2026-08-17" both come out as "2026-08-17". */
function asDate(value: string): string {
  if (!value) return "";
  return String(value).slice(0, 10);
}

/* Accepts an array already, or the "; " separated text the lists hold. */
function asList(value: string[] | string): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value !== "string") {
    const arr = value as string[];
    const out: string[] = [];
    for (let i = 0; i < arr.length; i++) {
      const s = String(arr[i]).trim();
      if (s) out.push(s);
    }
    return out;
  }
  const parts = String(value).split(";");
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const s = parts[i].trim();
    if (s) out.push(s);
  }
  return out;
}

function asDayList(value: number[] | string): number[] {
  if (value === null || value === undefined) return [];
  const raw: string[] = typeof value === "string"
    ? asList(value)
    : (value as number[]).map((d) => String(d));
  const out: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const n = asNumber(raw[i], -1);
    if (n >= 0 && n <= 6) out.push(n);
  }
  return out;
}

function normalise(payload: RawPayload): Payload {
  return {
    today: asDate(payload.today),
    hourlyRate: asNumber(payload.hourlyRate, 0),
    equipment: (payload.equipment || []).map((eq) => {
      return {
        id: eq.id,
        name: eq.name || eq.id,
        group: eq.group || eq.name || eq.id,
        positions: Math.max(1, Math.round(asNumber(eq.positions, 1))),
        continuous: asBoolean(eq.continuous),
        hoursPerDay: asNumber(eq.hoursPerDay, 8),
        operatingDays: asDayList(eq.operatingDays)
      };
    }),
    maintenance: (payload.maintenance || []).map((m) => {
      return { equipmentId: m.equipmentId, start: asDate(m.start), end: asDate(m.end) };
    }).filter((m) => !!m.start && !!m.end),
    procedures: (payload.procedures || []).map((p) => {
      return {
        id: p.id,
        setupHours: asNumber(p.setupHours, 0),
        testHours: asNumber(p.testHours, 0),
        reportingHours: asNumber(p.reportingHours, 0),
        samples: asNumber(p.samples, 1),
        consumablesCost: asNumber(p.consumablesCost, 0),
        equipmentGroups: asList(p.equipmentGroups)
      };
    }),
    partTypes: (payload.partTypes || []).map((pt) => {
      return { id: pt.id, costPerSample: asNumber(pt.costPerSample, 0) };
    }),
    requests: (payload.requests || []).map((r) => {
      return {
        id: r.id,
        ref: r.ref || "",
        procedureId: r.procedureId,
        partTypeId: r.partTypeId,
        priority: r.priority,
        ltiClassification: r.ltiClassification,
        status: r.status,
        samplesAvailableFrom: asDate(r.samplesAvailableFrom),
        dueDate: asDate(r.dueDate),
        forcedStart: asDate(r.forcedStart),
        quantity: asNumber(r.quantity, 0),
        createdAt: asDate(r.createdAt)
      };
    })
  };
}

/* ---------------------------------------------------------------- the engine */

function plan(raw: RawPayload): Output {
  const payload = normalise(raw);
  const today = payload.today;
  const hourlyRate = payload.hourlyRate;
  const maintenance = payload.maintenance || [];

  /* equipmentId -> array indexed by position, each holding the windows already taken. */
  const reservations: { [id: string]: Window[][] } = {};
  for (let i = 0; i < payload.equipment.length; i++) {
    const eq = payload.equipment[i];
    const slots: Window[][] = [];
    for (let p = 0; p < Math.max(1, eq.positions); p++) slots.push([]);
    reservations[eq.id] = slots;
  }

  const fleet = groupEquipment(payload.equipment);

  const active = payload.requests.filter((r) => ACTIVE_STATES.indexOf(r.status) !== -1);
  const quotes = active.filter(isQuote);
  const schedulable = active.filter((r) => !isQuote(r));

  const pinned = schedulable.filter((r) => !!r.forcedStart);
  const free = schedulable.filter((r) => !r.forcedStart);

  pinned.sort((a, b) => diffDays(b.forcedStart, a.forcedStart));

  free.sort((a, b) => {
    const dp = priorityWeight(a.priority) - priorityWeight(b.priority);
    if (dp !== 0) return dp;
    if (a.dueDate && b.dueDate) {
      const dd = diffDays(b.dueDate, a.dueDate);
      if (dd !== 0) return dd;
    } else if (a.dueDate !== b.dueDate) {
      return a.dueDate ? -1 : 1;
    }
    return diffDays(b.createdAt || today, a.createdAt || today);
  });

  const results: Result[] = [];

  function blank(request: Request, procedure: Procedure | null, partType: PartType | null): Result {
    return {
      id: request.id,
      ref: request.ref,
      plannedStart: "",
      plannedEnd: "",
      allocatedEquipment: "",
      operatingDays: 0,
      blockingReason: "",
      isQuote: false,
      cost: requestCost(request, procedure, partType, hourlyRate),
      slackDays: null,
      late: false
    };
  }

  function resolveGroups(procedure: Procedure | null): ResolvedGroups {
    const groups: Group[] = [];
    const missing: string[] = [];
    if (!procedure) return { groups: groups, missing: missing };
    const wanted = procedure.equipmentGroups || [];
    for (let i = 0; i < wanted.length; i++) {
      const g = findGroup(fleet, wanted[i]);
      if (g && g.members.length) groups.push(g); else missing.push(wanted[i]);
    }
    return { groups: groups, missing: missing };
  }

  /* Quote: estimated cost and duration, with no position reserved. */
  function processQuote(request: Request): void {
    const procedure = findProcedure(payload.procedures, request.procedureId);
    const partType = findPartType(payload.partTypes, request.partTypeId);
    const out = blank(request, procedure, partType);
    out.isQuote = true;
    out.blockingReason = "Quote — takes no rig.";
    const resolved = resolveGroups(procedure);
    if (procedure && resolved.groups.length) {
      out.operatingDays = operatingDaysNeeded(procedure, resolved.groups.map((g) => g.members[0]));
    }
    results.push(out);
  }

  function process(request: Request): void {
    const procedure = findProcedure(payload.procedures, request.procedureId);
    const partType = findPartType(payload.partTypes, request.partTypeId);
    const out = blank(request, procedure, partType);

    if (!procedure) {
      out.blockingReason = "Procedure not found in the catalogue.";
      results.push(out);
      return;
    }

    const resolved = resolveGroups(procedure);
    if (resolved.missing.length) {
      out.blockingReason = 'Equipment group "' + resolved.missing.join('", "') +
        '" has no unit registered.';
      results.push(out);
      return;
    }
    if (!resolved.groups.length) {
      out.blockingReason = "Procedure with no equipment defined.";
      results.push(out);
      return;
    }

    /* Sample arrival is given on the request: the same part type arrives on different dates
       depending on the customer and the programme. */
    const samplesFrom = request.samplesAvailableFrom || today;
    let earliest = laterOf(today, samplesFrom);
    if (request.forcedStart) earliest = request.forcedStart;

    const best = bestAcrossGroups(resolved.groups, procedure, reservations, earliest,
                                  request.forcedStart, maintenance);

    if (!best) {
      out.blockingReason = request.forcedStart
        ? "Start pinned to " + formatDate(request.forcedStart) + " unavailable on " +
          groupNames(resolved.groups) + "."
        : "No free slot on " + groupNames(resolved.groups) + " within the planning horizon.";
      out.operatingDays = operatingDaysNeeded(procedure, resolved.groups.map((g) => g.members[0]));
      results.push(out);
      return;
    }

    for (let i = 0; i < best.units.length; i++) {
      const eq = best.units[i];
      reservations[eq.id][best.positions[eq.id]].push(best.window);
    }

    out.plannedStart = best.window.start;
    out.plannedEnd = best.window.end;
    out.allocatedEquipment = best.units.map((eq) => eq.name).join(" + ");
    out.operatingDays = best.days;
    out.slackDays = request.dueDate ? diffDays(best.window.end, request.dueDate) : null;
    out.late = out.slackDays !== null && out.slackDays < 0;
    results.push(out);
  }

  for (let i = 0; i < pinned.length; i++) process(pinned[i]);
  for (let i = 0; i < free.length; i++) process(free[i]);
  for (let i = 0; i < quotes.length; i++) processQuote(quotes[i]);

  results.sort((a, b) => {
    if (!a.plannedStart && !b.plannedStart) return 0;
    if (!a.plannedStart) return 1;
    if (!b.plannedStart) return -1;
    return diffDays(b.plannedStart, a.plannedStart);
  });

  return {
    scheduled: results.filter((r) => !!r.plannedStart).length,
    /* Only what should have made it onto a rig and did not counts as blocked. */
    blocked: results.filter((r) => !r.plannedStart && !r.isQuote).length,
    quotes: results.filter((r) => r.isQuote).length,
    results: results
  };
}

/* ---------------------------------------------------------------- entry point */

function main(workbook: ExcelScript.Workbook, payload: string): string {
  const input = JSON.parse(payload) as RawPayload;
  return JSON.stringify(plan(input));
}
