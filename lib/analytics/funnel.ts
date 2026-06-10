// ── Funnel analytics ──────────────────────────────────────────────────────
// Pure functions over DB-shaped rows. No I/O, no env, no framework — usable on
// both server and client. The funnel is computed by POSITIONAL RANK of the
// stage (1..N over open stages), never the raw amoCRM `sort` value. Stage roles
// for the dealership key metrics are matched by NORMALIZED NAME (case/spaces/
// Kazakh «і» tolerant), and stage names are taken dynamically from the data —
// nothing is hard-coded per company.

/** A lead idle longer than this (days) on an open stage is "stuck". */
export const STUCK_AFTER_DAYS = 14;
const DAY = 86400;

/** Ordered open stage (won/lost excluded), rank is 1-based position. */
export interface AnalyticsStage {
  name: string;
  rank: number;
}

export interface AnalyticsLead {
  /** Furthest open-stage rank ever reached (reconstructed at sync). */
  reachedRank: number | null;
  /** Current open-stage rank, or null if won/lost/unknown. */
  statusRank: number | null;
  stageName: string | null;
  isWon: boolean;
  isLost: boolean;
  price: number;
  createdAtSec: number;
  stageEnteredAtSec: number | null;
  lossReason: string | null;
}

export interface StageMetric {
  name: string;
  rank: number;
  reached: number;
  current: number;
  conversionFromPrev: number | null;
  dropFromPrev: number | null;
  lostFromPrev: number;
  avgDaysOnStage: number;
  stuck: number;
}

export interface Bottleneck {
  fromStage: string;
  toStage: string;
  dropPct: number;
  lostCount: number;
  verdict: string;
}

export interface KeyMetric {
  id: string;
  title: string;
  subtitle: string;
  fromStage: string;
  toStage: string;
  fromCount: number;
  toCount: number;
  lost: number;
  conversion: number;
  tone: "good" | "warn" | "leak";
  available: boolean;
  verdict: string;
}

export interface LossReasonStat {
  reason: string;
  count: number;
  value: number;
}

/** Fallback success proxy for orgs that don't move deals to won/lost: how many
 * leads reached the deepest non-empty open stage, and that stage's name. */
export interface FunnelThroughput {
  stageName: string;
  rank: number;
  reached: number;
  pct: number; // reached / totalLeads * 100
}

export interface FunnelReport {
  totalLeads: number;
  wonCount: number;
  lostCount: number;
  openCount: number;
  overallConversion: number;
  /** Whether this org actually uses the won / lost system statuses (per period).
   * When false, the dashboard shows throughput instead of a misleading 0%. */
  usesWon: boolean;
  usesLost: boolean;
  throughput: FunnelThroughput | null;
  wonValue: number;
  lostValue: number;
  atRiskValue: number;
  funnel: StageMetric[];
  bottleneck: Bottleneck | null;
  keyMetrics: KeyMetric[];
  lossReasons: LossReasonStat[];
  generatedAt: number;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// An org "uses" won/lost only when a meaningful share of leads actually reach
// that status. Many companies close deals on an intermediate stage and leave
// won/lost empty — for them won-based conversion is a false 0%. Two conditions
// (absolute floor AND share) avoid flipping on a noisy short period.
const CLOSED_MIN_COUNT = 3;
const CLOSED_MIN_SHARE = 0.05; // 5%

// Throughput target = the deepest *significant* open stage. "Significant" means
// reaching it actually filtered out part of the previous cohort. A spare/parking
// tail stage (e.g. a reserve funnel) that leads merely flow into — its reached
// count barely drops from the previous stage — is skipped, so the metric lands
// on a real progression stage, not a dead-end. No stage names are hard-coded.
const THROUGHPUT_MIN_REACHED = 3; // ignore noise tails reached by 1–2 leads
const THROUGHPUT_PASSTHROUGH_MAX = 0.9; // >90% carryover from prev = not a real milestone

/** Pick the deepest stage that represents real funnel progression. `funnel` must
 * be sorted by rank ascending; `reached` is cumulative (non-increasing). */
function pickThroughputStage(funnel: StageMetric[]): StageMetric | null {
  for (let i = funnel.length - 1; i >= 0; i--) {
    const s = funnel[i];
    if (s.reached < THROUGHPUT_MIN_REACHED) continue; // noise tail
    const prev = i > 0 ? funnel[i - 1] : null;
    // Skip a "spare"/duplicate tail that the previous cohort just flows into.
    if (prev && prev.reached > 0 && s.reached / prev.reached > THROUGHPUT_PASSTHROUGH_MAX) continue;
    return s;
  }
  // Fallback: deepest non-empty stage.
  let deepest: StageMetric | null = null;
  for (const s of funnel) if (s.reached > 0) deepest = s;
  return deepest;
}

// Priority-ordered keywords that identify a real "sale" stage by NAME. Earlier
// entries win, so e.g. Dubai resolves to «Келді» (arrival) rather than its
// barely-used «Предоплата» — specific stages rank above generic «оплата», and
// «келді» above «предоплата»/«оплата». Matched on normalized names — no IDs and
// no per-org code, so new orgs are covered automatically.
const SALE_STAGE_KEYWORDS = [
  "запись подтверждена",
  "полная оплата",
  "бронь",
  "келді",
  "предоплата",
  "оплата",
];

// Stages that are never the "sale" stage: the entry stage (rank 1) and obvious
// service / early stages (WhatsApp lead intake, "на заказ").
const NON_SALE_KEYWORDS = ["whatsapp", "ватсап", "вотсап", "лид", "на заказ"];

function isExcludedFromSale(stage: StageMetric): boolean {
  if (stage.rank <= 1) return true;
  const n = normalizeStageName(stage.name);
  return NON_SALE_KEYWORDS.some((k) => n.includes(normalizeStageName(k)));
}

/** The org's real "sale" stage for the throughput card: the deepest open stage
 * whose name matches a sale keyword (in priority order), excluding entry/service
 * stages. Returns null when nothing matches — caller falls back to the generic
 * deepest-significant stage. Matched by name only (no rank/ID hard-coding). */
function pickSaleStage(funnel: StageMetric[]): StageMetric | null {
  const eligible = funnel.filter((s) => !isExcludedFromSale(s));
  for (const kw of SALE_STAGE_KEYWORDS) {
    const key = normalizeStageName(kw);
    const matches = eligible.filter((s) => normalizeStageName(s.name).includes(key));
    if (matches.length > 0) {
      return matches.reduce((deepest, s) => (s.rank > deepest.rank ? s : deepest));
    }
  }
  return null;
}

/** Derive whether won/lost are really used, plus the throughput fallback
 * (deepest *significant* open stage). Shared by both report builders. `funnel`
 * must be sorted by rank ascending. */
function deriveOutcomeModes(
  funnel: StageMetric[],
  totalLeads: number,
  wonCount: number,
  lostCount: number,
): { usesWon: boolean; usesLost: boolean; throughput: FunnelThroughput | null } {
  const usesWon =
    totalLeads > 0 && wonCount >= CLOSED_MIN_COUNT && wonCount / totalLeads >= CLOSED_MIN_SHARE;
  const usesLost =
    totalLeads > 0 && lostCount >= CLOSED_MIN_COUNT && lostCount / totalLeads >= CLOSED_MIN_SHARE;

  // Prefer the org's real sale stage (by name); fall back to the generic
  // deepest-significant stage when no sale keyword matches.
  const stage = pickSaleStage(funnel) ?? pickThroughputStage(funnel);
  const throughput: FunnelThroughput | null =
    stage && totalLeads > 0
      ? {
          stageName: stage.name,
          rank: stage.rank,
          reached: stage.reached,
          pct: round1((stage.reached / totalLeads) * 100),
        }
      : null;

  return { usesWon, usesLost, throughput };
}

export function computeReport(
  openStages: AnalyticsStage[],
  leads: AnalyticsLead[],
  now: number = Math.floor(Date.now() / 1000),
): FunnelReport {
  const stages = [...openStages].sort((a, b) => a.rank - b.rank);
  const stageCount = stages.length;

  const wonLeads = leads.filter((l) => l.isWon);
  const lostLeads = leads.filter((l) => l.isLost);
  const openLeads = leads.filter((l) => !l.isWon && !l.isLost);

  // Furthest rank reached by each lead. reached_rank is precomputed at sync;
  // fall back conservatively when missing.
  const reachedRanks: number[] = leads.map((l) => {
    if (l.reachedRank != null) return l.reachedRank;
    if (l.isWon) return stageCount;
    if (l.statusRank != null) return l.statusRank;
    return 1;
  });

  const funnel: StageMetric[] = stages.map((stage) => {
    const rank = stage.rank;
    const reached = reachedRanks.filter((r) => r >= rank).length;
    const here = openLeads.filter((l) => l.statusRank === rank);
    const idleDays = here
      .map((l) =>
        l.stageEnteredAtSec != null ? (now - l.stageEnteredAtSec) / DAY : 0,
      )
      .filter((d) => d >= 0);
    const avgDaysOnStage = idleDays.length
      ? round1(idleDays.reduce((a, b) => a + b, 0) / idleDays.length)
      : 0;
    return {
      name: stage.name,
      rank,
      reached,
      current: here.length,
      conversionFromPrev: null,
      dropFromPrev: null,
      lostFromPrev: 0,
      avgDaysOnStage,
      stuck: idleDays.filter((d) => d >= STUCK_AFTER_DAYS).length,
    };
  });

  for (let i = 1; i < funnel.length; i++) {
    const prev = funnel[i - 1];
    const cur = funnel[i];
    if (prev.reached > 0) {
      const conv = (cur.reached / prev.reached) * 100;
      cur.conversionFromPrev = round1(conv);
      cur.dropFromPrev = round1(100 - conv);
      cur.lostFromPrev = Math.max(0, prev.reached - cur.reached);
    }
  }

  // Bottleneck: largest % drop on a transition that carries real volume.
  let bottleneck: Bottleneck | null = null;
  for (let i = 1; i < funnel.length; i++) {
    const cur = funnel[i];
    const prev = funnel[i - 1];
    if (cur.dropFromPrev == null || prev.reached < 5) continue;
    if (!bottleneck || cur.dropFromPrev > bottleneck.dropPct) {
      bottleneck = {
        fromStage: prev.name,
        toStage: cur.name,
        dropPct: cur.dropFromPrev,
        lostCount: cur.lostFromPrev,
        verdict:
          `Больше всего сделок теряется на переходе «${prev.name}» → ` +
          `«${cur.name}» (минус ${cur.dropFromPrev}%). ` +
          `Здесь отвалилось ${cur.lostFromPrev} ${pluralLeads(cur.lostFromPrev)}.`,
      };
    }
  }

  // Loss reasons.
  const reasonMap = new Map<string, LossReasonStat>();
  for (const l of lostLeads) {
    const reason = l.lossReason ?? "Причина не указана";
    const cur = reasonMap.get(reason) ?? { reason, count: 0, value: 0 };
    cur.count += 1;
    cur.value += l.price;
    reasonMap.set(reason, cur);
  }
  const lossReasons = [...reasonMap.values()].sort((a, b) => b.count - a.count);

  // Headline aggregates.
  const totalLeads = leads.length;
  const wonValue = wonLeads.reduce((a, l) => a + l.price, 0);
  const lostValue = lostLeads.reduce((a, l) => a + l.price, 0);
  const atRiskValue = openLeads
    .filter(
      (l) =>
        l.stageEnteredAtSec != null &&
        (now - l.stageEnteredAtSec) / DAY >= STUCK_AFTER_DAYS,
    )
    .reduce((a, l) => a + l.price, 0);
  const overallConversion =
    totalLeads > 0 ? round1((wonLeads.length / totalLeads) * 100) : 0;
  const modes = deriveOutcomeModes(funnel, totalLeads, wonLeads.length, lostLeads.length);

  return {
    totalLeads,
    wonCount: wonLeads.length,
    lostCount: lostLeads.length,
    openCount: openLeads.length,
    overallConversion,
    usesWon: modes.usesWon,
    usesLost: modes.usesLost,
    throughput: modes.throughput,
    wonValue,
    lostValue,
    atRiskValue,
    funnel,
    bottleneck,
    keyMetrics: computeKeyMetrics(funnel),
    lossReasons,
    generatedAt: now,
  };
}

// ── Assemble report from PRE-AGGREGATED SQL rows (fast path) ───────────────
// The SQL RPCs return tiny per-stage rows; this rebuilds the exact same
// FunnelReport (cumulative reached via suffix sum, conversion, bottleneck,
// key metrics) without ever loading individual leads into Node.

/** One row per open stage, already aggregated in Postgres. */
export interface StageAgg {
  rank: number;
  name: string;
  /** Leads currently on this stage (kanban count). */
  current: number;
  /** Leads whose effective furthest rank == this rank (histogram bucket). */
  reachedExact: number;
  avgDays: number;
  stuck: number;
}

export interface HeadlineAgg {
  totalLeads: number;
  wonCount: number;
  lostCount: number;
  openCount: number;
  wonValue: number;
  lostValue: number;
  atRiskValue: number;
}

export function assembleReport(
  stagesIn: StageAgg[],
  headline: HeadlineAgg,
  lossReasons: LossReasonStat[],
): FunnelReport {
  const stages = [...stagesIn].sort((a, b) => a.rank - b.rank);

  // Cumulative "reached" = suffix sum of the reachedExact histogram.
  const reachedByRank = new Map<number, number>();
  let suffix = 0;
  for (let i = stages.length - 1; i >= 0; i--) {
    suffix += stages[i].reachedExact;
    reachedByRank.set(stages[i].rank, suffix);
  }

  const funnel: StageMetric[] = stages.map((s) => ({
    name: s.name,
    rank: s.rank,
    reached: reachedByRank.get(s.rank) ?? 0,
    current: s.current,
    conversionFromPrev: null,
    dropFromPrev: null,
    lostFromPrev: 0,
    avgDaysOnStage: round1(s.avgDays),
    stuck: s.stuck,
  }));

  for (let i = 1; i < funnel.length; i++) {
    const prev = funnel[i - 1];
    const cur = funnel[i];
    if (prev.reached > 0) {
      const conv = (cur.reached / prev.reached) * 100;
      cur.conversionFromPrev = round1(conv);
      cur.dropFromPrev = round1(100 - conv);
      cur.lostFromPrev = Math.max(0, prev.reached - cur.reached);
    }
  }

  let bottleneck: Bottleneck | null = null;
  for (let i = 1; i < funnel.length; i++) {
    const cur = funnel[i];
    const prev = funnel[i - 1];
    if (cur.dropFromPrev == null || prev.reached < 5) continue;
    if (!bottleneck || cur.dropFromPrev > bottleneck.dropPct) {
      bottleneck = {
        fromStage: prev.name,
        toStage: cur.name,
        dropPct: cur.dropFromPrev,
        lostCount: cur.lostFromPrev,
        verdict:
          `Больше всего сделок теряется на переходе «${prev.name}» → ` +
          `«${cur.name}» (минус ${cur.dropFromPrev}%). ` +
          `Здесь отвалилось ${cur.lostFromPrev} ${pluralLeads(cur.lostFromPrev)}.`,
      };
    }
  }

  const overallConversion =
    headline.totalLeads > 0 ? round1((headline.wonCount / headline.totalLeads) * 100) : 0;
  const modes = deriveOutcomeModes(
    funnel,
    headline.totalLeads,
    headline.wonCount,
    headline.lostCount,
  );

  return {
    totalLeads: headline.totalLeads,
    wonCount: headline.wonCount,
    lostCount: headline.lostCount,
    openCount: headline.openCount,
    overallConversion,
    usesWon: modes.usesWon,
    usesLost: modes.usesLost,
    throughput: modes.throughput,
    wonValue: headline.wonValue,
    lostValue: headline.lostValue,
    atRiskValue: headline.atRiskValue,
    funnel,
    bottleneck,
    keyMetrics: computeKeyMetrics(funnel),
    lossReasons,
    generatedAt: Math.floor(Date.now() / 1000),
  };
}

// ── Stage matching by normalized name (dynamic, never keyed on ids) ────────
function normalizeStageName(s: string): string {
  return s
    .toLowerCase()
    .replace(/і/g, "i") // Cyrillic «і» → latin i
    .replace(/["'«»`✅]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findStageIndex(funnel: StageMetric[], candidates: string[]): number {
  const norm = funnel.map((f) => normalizeStageName(f.name));
  const wanted = candidates.map(normalizeStageName);
  for (const w of wanted) {
    const exact = norm.indexOf(w);
    if (exact >= 0) return exact;
  }
  for (const w of wanted) {
    const fuzzy = norm.findIndex((n) => n.includes(w) || w.includes(n));
    if (fuzzy >= 0) return fuzzy;
  }
  return -1;
}

// Keyword aliases for dealership stage roles. Covers RU + KZ spellings; matched
// fuzzily so different companies' wording still resolves.
const STAGE_ALIASES = {
  promised: [
    "келем деди", "келем дедi", "записан на визит", "записан", "запись",
    "назначен визит", "визит", "appointment",
  ],
  arrived: [
    "келди", "келдi", "приехал", "пришел", "пришёл", "в салоне", "салон",
    "arrived", "визит состоялся",
  ],
  order: [
    "на заказ", "заказ", "предоплата", "предоплат", "оплата", "оплачен",
    "договор", "order", "счет", "счёт",
  ],
};

function buildKeyMetric(
  funnel: StageMetric[],
  opts: {
    id: string;
    title: string;
    subtitle: string;
    from: string[];
    to: string[];
    toLabel?: string;
    tone: (conv: number) => "good" | "warn" | "leak";
    verdict: (m: { from: StageMetric; to: StageMetric; conv: number; lost: number }) => string;
  },
): KeyMetric {
  const fromI = findStageIndex(funnel, opts.from);
  const toI = findStageIndex(funnel, opts.to);
  const unavailable: KeyMetric = {
    id: opts.id,
    title: opts.title,
    subtitle: opts.subtitle,
    fromStage: opts.from[0],
    toStage: opts.toLabel ?? opts.to[0],
    fromCount: 0,
    toCount: 0,
    lost: 0,
    conversion: 0,
    tone: "warn",
    available: false,
    verdict: "Подходящие этапы не найдены в этой воронке.",
  };

  if (fromI < 0 || toI < 0 || toI <= fromI) return unavailable;
  const from = funnel[fromI];
  const to = funnel[toI];
  if (from.reached === 0) return unavailable;

  const conv = round1((to.reached / from.reached) * 100);
  const lost = Math.max(0, from.reached - to.reached);
  return {
    id: opts.id,
    title: opts.title,
    subtitle: `${from.name} → ${opts.toLabel ?? to.name}`,
    fromStage: from.name,
    toStage: opts.toLabel ?? to.name,
    fromCount: from.reached,
    toCount: to.reached,
    lost,
    conversion: conv,
    tone: opts.tone(conv),
    available: true,
    verdict: opts.verdict({ from, to, conv, lost }),
  };
}

function computeKeyMetrics(funnel: StageMetric[]): KeyMetric[] {
  const reachVisit = buildKeyMetric(funnel, {
    id: "reach-visit",
    title: "Доходимость до салона",
    subtitle: "Записан на визит → Приехал",
    from: STAGE_ALIASES.promised,
    to: STAGE_ALIASES.arrived,
    tone: (c) => (c >= 70 ? "good" : c >= 50 ? "warn" : "leak"),
    verdict: ({ from, to, conv, lost }) =>
      `Из ${fmtN(from.reached)} записавшихся доехали ${fmtN(to.reached)} (${conv}%) — ` +
      `теряете ${fmtN(lost)} ${plural(lost, ["клиента", "клиентов", "клиентов"])} ещё до визита.`,
  });

  const closeVisit = buildKeyMetric(funnel, {
    id: "close-visit",
    title: "Закрытие в салоне",
    subtitle: "Приехал → заказ / предоплата",
    from: STAGE_ALIASES.arrived,
    to: STAGE_ALIASES.order,
    toLabel: "заказ",
    tone: (c) => (c >= 50 ? "good" : c >= 30 ? "warn" : "leak"),
    verdict: ({ from, to, conv, lost }) =>
      `Из ${fmtN(from.reached)} пришедших оформили заказ ${fmtN(to.reached)} (${conv}%). ` +
      (conv < 50
        ? `${fmtN(lost)} ${plural(lost, ["клиент ушёл", "клиента ушли", "клиентов ушли"])} без покупки.`
        : "Менеджеры в салоне отрабатывают визиты хорошо."),
  });

  return [reachVisit, closeVisit];
}

// ── formatting + plural helpers ────────────────────────────────────────────
export function fmtMoney(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${round1(value / 1_000_000)} млн ₸`;
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000)} тыс ₸`;
  return `${Math.round(value)} ₸`;
}

function fmtN(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(value));
}

function pluralLeads(n: number): string {
  return plural(n, ["сделка", "сделки", "сделок"]);
}

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}
