import { useState, useEffect, useMemo } from "react";
// S2-6: geometric convergence + ValueScore ranking, via the nullable-safe adapter
// that bridges the board's stored shape onto the pure-ESM engines. Additive only.
import {
  convergentDiscoveryIds,
  valueScoreMap,
  defaultState,
} from "./lib/board-scoring.mjs";
// S2-4: pre-`New` ambient emitter — the "Emitted ≠ counted (yet)" gate lives in
// the scoring/metrics layer; here we surface the emitter-backlog volume and the
// facet-binding triage promotion. Additive; density/funnel gating is structural.
import { funnelMetrics, triagePromotionPatch } from "./lib/board-metrics.mjs";
// S3-3: two-tier triage. `autoFacets` cheaply PRE-computes a PROVISIONAL facet
// suggestion (offline embedding band + conservative surprise/impact) for an
// `emitted` note; `confirmTriage` is the ONE fast human-confirm that binds the
// facets and promotes emitted→New (delegating to triagePromotionPatch above).
import { autoFacets, confirmTriage } from "./lib/triage.mjs";
// S3-5: nullable-safe persistence. Prefer host `window.storage`, fall back to
// localStorage (old saved discoveries keep loading), then in-memory. Resolved
// once at load; the board's async get/set contract is unchanged.
import { createStorage } from "./lib/storage-adapter.mjs";
// S3-2 board-UI wiring (deferred follow-up): SURFACE the already-built
// Clairvoyance-native capture connector in the board — a per-surface opt-in
// toggle (default OFF), the capture-log view, and a native-only purge. This is
// surfacing ONLY: capture/privacy/scoring/lifecycle logic is untouched. Native
// captures stay local, private (teamVisible:false), never auto-public, and fire
// only for surfaces the user has explicitly opted in.
import {
  enableSurface,
  disableSurface,
  listNativeCaptures,
  purgeNativeCaptures,
  isNativeCapture,
} from "./lib/native-capture.mjs";

const STORAGE_KEY = "serendipity-discoveries-v1";
const storage = createStorage();

// S3-2: this board IS one capture "surface". Opt-in is per surface (default OFF)
// — the user turns native capture on/off for this surface; nothing is captured
// until they do.
const NATIVE_SURFACE = "discovery-board";
// A tiny, SEPARATE key persisting only this surface's opt-in choice so it
// survives reload (missing/false → OFF). Additive + nullable-safe; it never
// touches the discovery corpus.
const NATIVE_OPTIN_KEY = "serendipity-native-optin-v1";
// Read the distilled surface off a native capture's tags (`surface:<x>`), for
// display only. Nullable-safe.
const surfaceOf = (c) =>
  (c?.tags || [])
    .find((t) => typeof t === "string" && t.startsWith("surface:"))
    ?.slice("surface:".length) || "";

const STATUS_META = {
  // S2-4: `emitted` is the pre-`New` ENTRY state. Ambient captures land here with
  // no facets bound; they contribute 0 to density + the captured denominator (the
  // gate) until triaged. Its ONE onward transition is triage → New. Existing
  // states and their transitions below are UNCHANGED (additive).
  emitted:     { label: "Emitted",     color: "#7c8598", next: ["new"] },
  new:         { label: "New",         color: "#a78bfa", next: ["reviewing", "team_triage", "banked"] },
  reviewing:   { label: "Reviewing",   color: "#4d9fff", next: ["team_triage", "banked", "new"] },
  team_triage: { label: "Team Triage", color: "#f5a623", next: ["decision", "active", "reviewing", "banked"] },
  decision:    { label: "Decision",    color: "#ff9f4a", next: ["active", "banked", "team_triage"] },
  active:      { label: "Active",      color: "#4ade80", next: ["banked", "decision"] },
  banked:      { label: "Banked",      color: "#6b7590", next: ["reviewing", "team_triage"] },
};

// `emitted` leads the order so its backlog tab/count sits at the funnel mouth.
const STATUS_ORDER = ["emitted","new","reviewing","team_triage","decision","active","banked"];

const TYPE_META = {
  A: { label: "Anomaly",        bg: "rgba(220,38,38,0.18)",   text: "#fca5a5" },
  B: { label: "Bridge",         bg: "rgba(59,130,246,0.18)",  text: "#93c5fd" },
  C: { label: "Constraint Flip",bg: "rgba(34,197,94,0.18)",   text: "#86efac" },
  D: { label: "Scale Shift",    bg: "rgba(234,179,8,0.18)",   text: "#fde68a" },
};
// Fallback for un-typed discoveries — an ambient `emitted` capture has no F1 Type
// until triage binds one. Keeps the card/detail renderers from dereferencing an
// undefined TYPE_META[type]. Neutral, clearly "untyped".
const UNTYPED_META = { label: "Untyped", bg: "rgba(124,133,152,0.16)", text: "#8b93a6" };
const typeMetaOf = (type) => TYPE_META[type] || UNTYPED_META;

const AGENTS = [
  "01 · Physics Bridge","02 · Certification","03 · Materials",
  "04 · Demand Scanner","05 · Mfg Tech","06 · Competitive Intel",
  "07 · Capital & Funding","08 · Policy","09 · Talent",
  "10 · Supplier & Partner","11 · Mission Systems","12 · Operators",
  "13 · IP Infrastructure","14 · Org Systems & AI","Manual entry"
];

// ─── S1-0 discovery ontology delta (additive, nullable) ──────────────────────
// Enum vocabularies for the named minimal delta. Values are the exact tokens the
// SHACL node shape checks with `sh:in` (spec-discovery-ontology.md §1 facet table
// / §7.1). All new fields are optional — a saved discovery missing them stays valid.
const GENERALITY    = ["point", "vertical", "platform", "universal"];          // F6
const CAPTURE_MODE  = ["deliberate-scan", "ambient-emitter", "manual"];        // F7
const DISTANCE_BAND = ["too-close", "serendipity-band", "too-far"];            // F3
const RELATION_KIND = ["converges-with", "bridges", "refines", "supersedes"];  // §4 typed edges

// JSON-LD @context bridging the board's stored JSON to the RDF/OWL model (spec §9).
// Attach this to a discovery record and today's fields become valid RDF — no board
// rewrite, no migration. §9 writes the project-namespace targets with a leading ":"
// (the default namespace); here that default is carried by "@vocab", so the bare
// term names below are equivalent to the spec's ":priority", ":lifecycleState", etc.
export const DISCOVERY_CONTEXT = {
  "@version": 1.1,
  "@vocab": "https://serendipity-maximizer.example/ns#",
  prov: "http://www.w3.org/ns/prov#",
  skos: "http://www.w3.org/2004/02/skos/core#",
  // existing board keys → RDF terms (spec §9)
  type:           "@id",                    // :discoveryType (A/B/C/D scheme)
  priorityScore:  "priority",               // :priority
  status:         "lifecycleState",         // :lifecycleState
  discoveredDate: "prov:generatedAtTime",
  sourceAgent:    "prov:wasAttributedTo",
  domains:        "primaryDomain",          // :primaryDomain (see @context note on domains[])
  // named minimal delta → RDF terms (spec §1 facet table)
  surprise:       "surprise",               // F4
  generality:     "generality",             // F6
  captureMode:    "captureMode",            // F7
  distanceBand:   "distanceBand",           // F3 band
  domainDistance: "domainDistance",         // F3 raw 0.0–1.0
  relations:      "relation",               // §4 typed edges (typed upgrade of relatedIds)
};

const SAMPLE = [
  {
    id:"DISC-001", title:"Insect gait patterns → multi-terrain robot mobility",
    type:"B", sourceAgent:"01 · Physics Bridge", discoveredDate:"2026-05-07",
    discoveredBy:"Example", priorityScore:24, status:"reviewing", owner:"Example",
    teamVisible:true, convergence:false,
    summary:"Cockroach gait adaptation across uneven terrain uses distributed leg-level feedback rather than central planning. The control architecture transfers directly to warehouse robots navigating cluttered, changing floor layouts.",
    refinementNotes:"University biomechanics lab nearby may have published gait datasets.",
    decision:"", decisionReason:"", nextAction:"Literature search: distributed legged locomotion control",
    nextActionDate:"2026-05-15", reactivationTrigger:"",
    relatedIds:[], tags:["mobility","biomimicry","control"],
    domains:[{name:"01 · Physics Bridge",primary:true},{name:"11 · Mission Systems",primary:false}],
    surprise:4, generality:"vertical", captureMode:"deliberate-scan",
    distanceBand:"serendipity-band", domainDistance:0.52,
    relations:[{toId:"DISC-006", kind:"bridges"}]
  },
  {
    id:"DISC-002", title:"SRE blameless postmortems ↔ ISO safety incident reviews",
    type:"B", sourceAgent:"14 · Org Systems & AI", discoveredDate:"2026-05-09",
    discoveredBy:"Example", priorityScore:30, status:"team_triage", owner:"Example",
    teamVisible:true, convergence:false,
    summary:"Software SRE postmortem culture and industrial safety incident review frameworks share the same philosophy: systemic analysis, no individual blame, documented learning. Instilling SRE culture now builds safety-compliance posture before certification requires it.",
    refinementNotes:"One incident template can satisfy both engineering reliability and safety audit needs.",
    decision:"", decisionReason:"", nextAction:"Draft incident template compatible with SRE and ISO safety review",
    nextActionDate:"2026-05-12", reactivationTrigger:"",
    relatedIds:[], tags:["SRE","safety","culture","process"],
    domains:[{name:"14 · Org Systems & AI",primary:true},{name:"02 · Certification",primary:false}],
    surprise:3, generality:"platform", captureMode:"deliberate-scan",
    distanceBand:"serendipity-band", domainDistance:0.48,
    relations:[{toId:"DISC-003", kind:"bridges"}]
  },
  {
    id:"DISC-003", title:"Safety certification precedent as competitive moat",
    type:"C", sourceAgent:"02 · Regulatory/Safety", discoveredDate:"2026-05-05",
    discoveredBy:"Example", priorityScore:32, status:"active", owner:"Example",
    teamVisible:true, convergence:false,
    summary:"Being first to establish a collaborative-robot safety certification in a new facility category sets the compliance template competitors must then follow, creating a durable advantage.",
    refinementNotes:"Engage certification body early to shape the assessment criteria.",
    decision:"IMPLEMENT", decisionReason:"High leverage, low incremental cost, first-mover window is open.",
    nextAction:"Schedule early engagement with certification body", nextActionDate:"2026-05-20",
    reactivationTrigger:"", relatedIds:[], tags:["certification","safety","moat"]
  },
  {
    id:"DISC-004", title:"Cold-storage facilities — underserved high-margin vertical",
    type:"D", sourceAgent:"04 · Demand Scanner", discoveredDate:"2026-05-03",
    discoveredBy:"Example", priorityScore:20, status:"banked", owner:"Example",
    teamVisible:true, convergence:false,
    summary:"Cold-storage warehouses face acute labor shortages (few people want to work at -20C) and pay premiums for automation. Most robots aren't rated for the temperature. A cold-rated variant is a category with little competition.",
    refinementNotes:"Too early — needs the base platform validated first.",
    decision:"", decisionReason:"", nextAction:"", nextActionDate:"",
    reactivationTrigger:"Base platform reaches pilot deployment, OR a cold-storage operator reaches out.",
    relatedIds:[], tags:["cold-storage","demand","vertical"],
    domains:[{name:"04 · Demand Scanner",primary:true}],
    surprise:2, generality:"vertical", captureMode:"ambient-emitter",
    distanceBand:"too-close", domainDistance:0.21, relations:[]
  },
  {
    id:"DISC-005", title:"Tooling platform choice locks data architecture for years",
    type:"C", sourceAgent:"14 · Org Systems & AI", discoveredDate:"2026-05-08",
    discoveredBy:"Example", priorityScore:28, status:"decision", owner:"Example",
    teamVisible:true, convergence:false,
    summary:"The engineering data platform chosen now determines migration cost and audit readiness later. Getting it right at pre-seed costs one week of evaluation versus a painful re-platforming at scale.",
    refinementNotes:"Evaluate cloud-native options before first engineering hire.",
    decision:"", decisionReason:"", nextAction:"1-week platform evaluation sprint",
    nextActionDate:"2026-05-16", reactivationTrigger:"",
    relatedIds:[], tags:["systems-architecture","tooling","pre-seed"]
  },
  {
    id:"DISC-006", title:"Modular end-effectors → one platform, many verticals",
    type:"D", sourceAgent:"11 · Config & Payload", discoveredDate:"2026-05-06",
    discoveredBy:"Example", priorityScore:22, status:"new", owner:"",
    teamVisible:true, convergence:false,
    summary:"A quick-swap end-effector interface lets one robot platform serve picking, sorting, and transport across different facility types — multiplying the addressable market without multiplying the platform.",
    refinementNotes:"", decision:"", decisionReason:"", nextAction:"",
    nextActionDate:"", reactivationTrigger:"",
    relatedIds:[], tags:["modularity","config","platform"]
  },
];

// ─────────────────────────────────────────────
export default function DiscoveryBoard() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [expanded, setExpanded] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [ambientText, setAmbientText] = useState("");
  // ── S3-2 board-UI wiring: native-capture connector controls (surfacing) ────
  const [captureOptIn, setCaptureOptIn] = useState(false);   // default OFF
  const [nativeCaptures, setNativeCaptures] = useState([]);
  const [showCaptureLog, setShowCaptureLog] = useState(false);
  const [purgeArmed, setPurgeArmed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await storage.get(STORAGE_KEY);
        setItems(r?.value ? JSON.parse(r.value) : SAMPLE);
        if (!r?.value) await storage.set(STORAGE_KEY, JSON.stringify(SAMPLE));
      } catch { setItems(SAMPLE); }
      setLoading(false);
    })();
  }, []);

  // S3-2: restore this surface's opt-in choice (default OFF) and load the native
  // capture log through the connector's own API. Additive; nullable-safe.
  useEffect(() => {
    (async () => {
      try {
        const r = await storage.get(NATIVE_OPTIN_KEY);
        if (r?.value === "true") { enableSurface(NATIVE_SURFACE); setCaptureOptIn(true); }
      } catch { /* default OFF */ }
      await refreshCaptures();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function persist(updated) {
    setItems(updated);
    try { await storage.set(STORAGE_KEY, JSON.stringify(updated)); }
    catch(e) { console.error("storage save failed", e); }
  }

  function updateItem(id, patch) {
    const updated = items.map(d => d.id === id ? { ...d, ...patch } : d);
    persist(updated);
    if (expanded?.id === id) setExpanded(prev => ({ ...prev, ...patch }));
  }

  function addItem(disc) { persist([disc, ...items]); setShowAdd(false); }

  // ── S3-2 board-UI wiring: native-capture controls (surface-only) ───────────
  // The capture log comes straight from the connector's own `listNativeCaptures`
  // (native-source notes only; other discoveries are never returned).
  async function refreshCaptures() {
    try { setNativeCaptures(await listNativeCaptures(storage)); }
    catch (e) { console.error("native capture list failed", e); setNativeCaptures([]); }
  }

  // Per-surface OPT-IN toggle → drives the connector's enable/disable registry
  // (default OFF). The choice is persisted so it survives reload; nothing is
  // captured on this surface until the user opts in here.
  async function toggleOptIn() {
    const next = !captureOptIn;
    if (next) enableSurface(NATIVE_SURFACE); else disableSurface(NATIVE_SURFACE);
    setCaptureOptIn(next);
    try { await storage.set(NATIVE_OPTIN_KEY, next ? "true" : "false"); }
    catch (e) { console.error("native opt-in save failed", e); }
  }

  // PURGE — native-only, via the connector. Deletes native captures from the
  // local store and leaves every other discovery untouched. Two-step confirm
  // (sandbox-safe: no reliance on window.confirm, which artifact hosts block).
  async function purgeCaptures() {
    try {
      await purgeNativeCaptures(storage);
      // Re-sync the board with the purged corpus (native notes dropped only).
      setItems(prev => prev.filter(d => !isNativeCapture(d)));
      setNativeCaptures([]);
    } catch (e) { console.error("native purge failed", e); }
    setPurgeArmed(false);
  }

  // S2-4 ambient capture: the cheap/hot quick-add. Creates an `emitted` item with
  // captureMode = ambient-emitter and NO required facets (just the note/title).
  // Distinct from the full AddForm — pre-triage, so it lands OUTSIDE density + the
  // captured funnel until promoted (the gate). Facets get bound later, at triage.
  function emitAmbient() {
    const title = ambientText.trim();
    if (!title) return;
    const n = items.length + 1;
    persist([{
      id:`DISC-${String(n).padStart(3,"0")}`,
      title, status:"emitted", captureMode:"ambient-emitter",
      sourceAgent:"Ambient emitter",
      discoveredDate:new Date().toISOString().split("T")[0],
      discoveredBy:"Ambient", owner:"", teamVisible:true, convergence:false,
      // No facets bound yet (type/surprise/generality/domains/…): all nullable.
      summary:"", refinementNotes:"", decision:"", decisionReason:"",
      nextAction:"", nextActionDate:"", reactivationTrigger:"",
      relatedIds:[], tags:[], domains:[], relations:[],
    }, ...items]);
    setAmbientText("");
  }

  // ── S2-6 geometric layer (derived, additive) ──────────────────────────────
  // convergentIds: the set of discovery ids participating in ANY fired geometric
  // :Convergence — the source of truth for the CONV badge (the stored
  // `convergence` boolean stays readable for back-compat but no longer drives UI).
  // valueScores: id→ValueScore under ratified weights; nullable-safe (missing
  // S2-1 facets → finite score, never NaN). Memoized so they only recompute when
  // the corpus changes.
  const ratifiedState = useMemo(() => defaultState(), []);
  const convergentIds = useMemo(() => convergentDiscoveryIds(items), [items]);
  const valueScores   = useMemo(() => valueScoreMap(items, ratifiedState), [items, ratifiedState]);
  // S2-4 funnel/density metrics (gate-applied): emitter-backlog volume is drawn
  // ONLY from pre-triage items and never feeds the value-weighted density.
  const metrics       = useMemo(() => funnelMetrics(items, { state: ratifiedState }), [items, ratifiedState]);
  const vsOf = (id) => { const v = valueScores.get(String(id)); return typeof v === "number" ? v : null; };

  const visible = items.filter(d =>
    (statusFilter === "all" || d.status === statusFilter) &&
    (typeFilter  === "all" || d.type  === typeFilter)
  ).sort((a,b) => {
    // Rank by geometric ValueScore (desc); fall back to priorityScore when a
    // score is unavailable, and use priorityScore as a stable tiebreaker.
    const va = vsOf(a.id), vb = vsOf(b.id);
    const na = va == null ? -Infinity : va, nb = vb == null ? -Infinity : vb;
    if (nb !== na) return nb - na;
    return (b.priorityScore||0) - (a.priorityScore||0);
  });

  const counts = STATUS_ORDER.reduce((acc,s) => ({ ...acc, [s]: items.filter(d=>d.status===s).length }), {});
  const expandedItem = expanded ? items.find(d => d.id === expanded.id) : null;

  if (loading) return (
    <div style={css.loader}>
      <div style={{fontFamily:"'DM Mono',monospace",fontSize:"0.72rem",color:"#6b7590",letterSpacing:"0.1em"}}>loading registry...</div>
    </div>
  );

  if (showAdd) return <AddForm items={items} onAdd={addItem} onBack={() => setShowAdd(false)} />;
  if (expandedItem) return <DetailView disc={expandedItem} allItems={items} onBack={() => setExpanded(null)} onUpdate={updateItem} />;

  return (
    <div style={css.root}>
      <style>{fonts + scrollbar}</style>

      {/* Header */}
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:"1.125rem"}}>
        <div>
          <div style={css.eyebrow}>Serendipity Maximizer</div>
          <h1 style={css.h1}>Discovery Registry</h1>
        </div>
        <button style={css.addBtn} onClick={() => setShowAdd(true)}>+ Add</button>
      </div>

      {/* S2-4 ambient capture — cheap/hot quick-add. Lands in `emitted` (pre-triage,
          captureMode = ambient-emitter). Note only; facets bound later at triage. */}
      <div style={{display:"flex",gap:"0.4rem",marginBottom:"1rem"}}>
        <input value={ambientText} onChange={e=>setAmbientText(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&emitAmbient()}
          placeholder="⚡ Ambient capture — jot a note, triage later" style={{flex:1}} />
        <button onClick={emitAmbient} style={css.emitBtn} title="Emit an ambient capture (pre-triage; not yet counted)">Emit</button>
      </div>

      {/* Stats strip */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"0.4rem",marginBottom:"1.125rem"}}>
        {[
          { label:"Total",    val:items.length,             color:"#e8eaf0" },
          { label:"Active",   val:counts.active||0,         color:"#4ade80" },
          { label:"Banked",   val:counts.banked||0,         color:"#6b7590" },
          { label:"Emitter",  val:metrics.emitterBacklog,   color:"#7c8598" },
        ].map(s => (
          <div key={s.label} style={css.statCard}>
            <div style={{fontSize:"1.25rem",fontWeight:"700",color:s.color,lineHeight:1}}>{s.val}</div>
            <div style={css.statLabel}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── S3-2 board-UI wiring: native-capture connector controls ──────────
          Surfaces the already-built connector: per-surface opt-in (default OFF),
          the capture-log view, and a native-only purge. Captures are local,
          private (teamVisible:false), distilled-only, never auto-public. */}
      <div style={css.nativePanel}>
        <div style={{display:"flex",alignItems:"center",gap:"0.5rem"}}>
          <span style={css.nativeTitle}>◈ Native capture</span>
          <span style={{...css.nativeState, color: captureOptIn ? "#4ade80" : "#7c8598"}}>
            {captureOptIn ? "ON · this surface" : "OFF · opt-in required"}
          </span>
          <button onClick={toggleOptIn}
            style={{...css.optInBtn,
              marginLeft:"auto",
              background: captureOptIn ? "rgba(74,222,128,0.12)" : "rgba(124,133,152,0.14)",
              borderColor: captureOptIn ? "rgba(74,222,128,0.4)" : "rgba(124,133,152,0.4)",
              color: captureOptIn ? "#4ade80" : "#a7afc0"}}
            title="Opt this surface in / out of native capture (default off)">
            {captureOptIn ? "Disable" : "Enable"}
          </button>
        </div>
        <div style={css.nativeNote}>
          {captureOptIn
            ? "Capture is ON for this surface. Captures are distilled (what / where / why only), stored locally and private — never auto-public — and are always viewable and purgeable below."
            : "Capture is OFF — nothing is captured on this surface until you opt in. Native captures are local, private, and never auto-public."}
        </div>

        <div style={{display:"flex",alignItems:"center",gap:"0.5rem",marginTop:"0.55rem"}}>
          <button
            onClick={() => { if (!showCaptureLog) refreshCaptures(); setShowCaptureLog(v => !v); }}
            style={css.logToggle}>
            {showCaptureLog ? "▾" : "▸"} Capture log ({nativeCaptures.length})
          </button>
          {nativeCaptures.length > 0 && (purgeArmed
            ? <span style={{display:"flex",gap:"0.35rem",marginLeft:"auto",alignItems:"center"}}>
                <span style={{fontSize:"0.55rem",color:"#ff9f4a",fontFamily:"'DM Mono',monospace"}}>Purge {nativeCaptures.length}? native-only, can't undo</span>
                <button onClick={purgeCaptures} style={css.purgeConfirmBtn}>Confirm</button>
                <button onClick={() => setPurgeArmed(false)} style={css.cancelBtn}>Cancel</button>
              </span>
            : <button onClick={() => setPurgeArmed(true)}
                style={{...css.purgeBtn, marginLeft:"auto"}}
                title="Delete native captures from the local store (other discoveries untouched)">Purge</button>
          )}
        </div>

        {showCaptureLog && (
          <div style={{marginTop:"0.5rem",display:"flex",flexDirection:"column",gap:"0.4rem"}}>
            {nativeCaptures.length === 0
              ? <div style={css.nativeEmpty}>no native captures{captureOptIn ? " yet" : ""}</div>
              : nativeCaptures.map((c,i) => (
                  <div key={c.id||i} style={css.captureRow}>
                    <div style={{fontSize:"0.7rem",fontWeight:"600",color:"#e8eaf0",lineHeight:1.35}}>{c.title||"(untitled)"}</div>
                    {c.summary && <div style={{fontSize:"0.63rem",color:"#b8c0cc",marginTop:"0.2rem",lineHeight:1.45}}>{c.summary}</div>}
                    <div style={css.captureMeta}>
                      {surfaceOf(c) && <span>surface: {surfaceOf(c)}</span>}
                      {surfaceOf(c) && c.discoveredDate && <span style={{color:"#3a3d4a"}}>·</span>}
                      {c.discoveredDate && <span>{c.discoveredDate}</span>}
                      <span style={{marginLeft:"auto",color:"#7c8598"}}>private · never public</span>
                    </div>
                  </div>
                ))
            }
          </div>
        )}
      </div>

      {/* Status tabs */}
      <div style={css.tabRow}>
        {[{id:"all",label:"All",color:"#8b8fa8"}, ...STATUS_ORDER.map(s => ({id:s,...STATUS_META[s]}))].map(s => (
          <button key={s.id} style={{...css.tab, ...(statusFilter===s.id ? {borderColor:s.color,color:s.color,background:`${s.color}14`} : {})}}
            onClick={() => setStatusFilter(s.id)}>
            {s.label}{s.id!=="all" && counts[s.id] ? ` ${counts[s.id]}` : ""}
          </button>
        ))}
      </div>

      {/* Type filter */}
      <div style={{display:"flex",gap:"0.3rem",marginBottom:"1rem",flexWrap:"wrap"}}>
        {[{id:"all",label:"All types",bg:"transparent",text:"#8b8fa8"},
          ...Object.entries(TYPE_META).map(([k,v]) => ({id:k,label:`${k}·${v.label.split(" ")[0]}`,bg:v.bg,text:v.text}))
        ].map(t => (
          <button key={t.id} style={{...css.typeBtn,
            background:typeFilter===t.id ? t.bg : "transparent",
            borderColor:typeFilter===t.id ? t.text : "rgba(255,255,255,0.08)",
            color:typeFilter===t.id ? t.text : "#6b7590"}}
            onClick={() => setTypeFilter(t.id)}>{t.label}</button>
        ))}
      </div>

      {/* Count */}
      <div style={css.countLabel}>{visible.length} {visible.length===1?"discovery":"discoveries"}</div>

      {/* List */}
      <div style={{display:"flex",flexDirection:"column",gap:"0.5rem"}}>
        {visible.map(d => <DiscCard key={d.id} disc={d} converged={convergentIds.has(String(d.id))} valueScore={vsOf(d.id)} onClick={() => setExpanded(d)} />)}
        {visible.length === 0 && (
          <div style={css.empty}>no discoveries match this filter</div>
        )}
      </div>
    </div>
  );
}

// ─── Discovery Card ────────────────────────────────────────
function DiscCard({ disc, onClick, converged, valueScore }) {
  const sm = STATUS_META[disc.status] || STATUS_META.emitted;
  const tm = typeMetaOf(disc.type);
  return (
    <div style={css.card} onClick={onClick}>
      <div style={{...css.cardAccent, background:sm.color}} />
      <div style={{paddingLeft:"0.875rem"}}>
        <div style={{display:"flex",alignItems:"center",gap:"0.4rem",marginBottom:"0.3rem"}}>
          <span style={{...css.typeBadge,background:tm.bg,color:tm.text}}>{disc.type?`${disc.type}·${tm.label.split(" ")[0]}`:tm.label}</span>
          {converged && <span style={css.convBadge}>⬡ CONV</span>}
          {typeof valueScore === "number" && (
            <span style={css.vsBadge} title="ValueScore (ratified weights)">VS {valueScore.toFixed(2)}</span>
          )}
          <span style={{marginLeft:"auto",fontSize:"0.75rem",fontWeight:"700",color:sm.color}}>{disc.priorityScore}</span>
        </div>
        <div style={css.cardTitle}>{disc.title}</div>
        <div style={css.cardMeta}>
          <span style={{color:"#6b7590"}}>{disc.sourceAgent}</span>
          <span style={{color:"#3a3d4a"}}>·</span>
          <span style={{color:sm.color}}>{sm.label}</span>
          {disc.owner && <><span style={{color:"#3a3d4a"}}>·</span><span style={{color:"#6b7590"}}>{disc.owner}</span></>}
        </div>
        {disc.nextAction && (
          <div style={css.nextAction}>→ {disc.nextAction}</div>
        )}
      </div>
    </div>
  );
}

// ─── Detail View ────────────────────────────────────────────
function DetailView({ disc, allItems, onBack, onUpdate }) {
  const sm = STATUS_META[disc.status] || STATUS_META.emitted;
  const tm = typeMetaOf(disc.type);
  // S2-6: geometric convergence over the full corpus + nullable-safe ValueScore.
  const converged = useMemo(
    () => convergentDiscoveryIds(allItems).has(String(disc.id)),
    [allItems, disc.id]
  );
  const valueScore = useMemo(() => {
    const v = valueScoreMap([disc]).get(String(disc.id));
    return typeof v === "number" ? v : null;
  }, [disc]);
  const [editField, setEditField] = useState(null);
  const [editVal, setEditVal]   = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis]   = useState(null);
  const [relTo, setRelTo]     = useState("");
  const [relKind, setRelKind] = useState(RELATION_KIND[0]);

  function startEdit(f, v="") { setEditField(f); setEditVal(v); }
  function saveEdit() {
    let v = editVal;
    // domains[] is stored as [{name, primary}] — parse the comma string, first = primary
    if (editField === "domains") {
      v = editVal ? editVal.split(",").map((s,i)=>({name:s.trim(),primary:i===0})).filter(d=>d.name) : [];
    }
    onUpdate(disc.id, {[editField]: v});
    setEditField(null);
  }
  function cancelEdit() { setEditField(null); }

  // Typed relations[] — additive; the untyped relatedIds[] is left untouched.
  function setFacet(k, val) { onUpdate(disc.id, {[k]: val || null}); }
  function addRelation() {
    if (!relTo) return;
    onUpdate(disc.id, {relations:[...(disc.relations||[]), {toId:relTo, kind:relKind}]});
    setRelTo("");
  }
  function removeRelation(i) {
    onUpdate(disc.id, {relations:(disc.relations||[]).filter((_,idx)=>idx!==i)});
  }
  const domainsStr = (disc.domains||[]).map(d=>d.name).join(", ");

  async function analyze() {
    setAnalyzing(true); setAnalysis(null);
    const ctx = allItems.filter(d=>d.id!==disc.id).map(d=>`${d.id}: ${d.title} [${d.type}]`).join("\n");
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          model:"claude-sonnet-4-20250514", max_tokens:800,
          messages:[{ role:"user", content:
            `Analyze this serendipitous discovery for an early-stage venture.

DISCOVERY:
Title: ${disc.title}
Type: ${disc.type||"—"} (${typeMetaOf(disc.type).label})
Agent: ${disc.sourceAgent}
Priority: ${disc.priorityScore}
Summary: ${disc.summary}
Notes: ${disc.refinementNotes||"none"}

OTHER REGISTRY ITEMS:
${ctx||"none"}

Respond ONLY with valid JSON, no markdown:
{"timeHorizon":"Immediate|Near-term|Mid-term|Long-term","complexity":"Low|Medium|High","keyQuestion":"string","nextSteps":["string","string","string"],"risks":["string","string"],"crossLinks":["string"]}`
          }]
        })
      });
      const data = await r.json();
      const txt = data.content?.find(c=>c.type==="text")?.text||"{}";
      setAnalysis(JSON.parse(txt.replace(/```json|```/g,"").trim()));
    } catch { setAnalysis({error:"Analysis failed."}); }
    setAnalyzing(false);
  }

  const relatedItems = (disc.relatedIds||[]).map(id=>allItems.find(d=>d.id===id)).filter(Boolean);

  return (
    <div style={css.root}>
      <style>{fonts + scrollbar}</style>

      {/* Back bar */}
      <div style={{display:"flex",alignItems:"center",gap:"0.75rem",marginBottom:"1rem"}}>
        <button style={css.backBtn} onClick={onBack}>← back</button>
        <span style={css.discId}>{disc.id}</span>
        <span style={{marginLeft:"auto",...css.statusPill, background:`${sm.color}18`, borderColor:`${sm.color}44`, color:sm.color}}>{sm.label}</span>
      </div>

      {/* Badges */}
      <div style={{display:"flex",gap:"0.4rem",alignItems:"center",marginBottom:"0.65rem",flexWrap:"wrap"}}>
        <span style={{...css.typeBadge,background:tm.bg,color:tm.text,fontSize:"0.65rem",padding:"0.2rem 0.55rem"}}>{disc.type?`Type ${disc.type} · ${tm.label}`:tm.label}</span>
        <span style={{fontSize:"0.65rem",fontFamily:"'DM Mono',monospace",color:"#ffd166",letterSpacing:"0.04em"}}>Priority {disc.priorityScore}</span>
        {valueScore != null && <span style={css.vsBadge} title="ValueScore (ratified weights)">VS {valueScore.toFixed(2)}</span>}
        {converged && <span style={css.convBadge}>⬡ Convergence event</span>}
      </div>

      <h2 style={{fontSize:"0.95rem",fontWeight:"700",lineHeight:"1.35",marginBottom:"0.5rem"}}>{disc.title}</h2>

      <div style={{fontSize:"0.6rem",fontFamily:"'DM Mono',monospace",color:"#6b7590",marginBottom:"1.125rem",display:"flex",gap:"0.6rem",flexWrap:"wrap"}}>
        <span>{disc.sourceAgent}</span><span>·</span>
        <span>{disc.discoveredDate}</span><span>·</span>
        <span>by {disc.discoveredBy}</span>
        {disc.owner && <><span>·</span><span>owner: {disc.owner}</span></>}
      </div>

      <DSection label="Summary">
        <p style={css.bodyText}>{disc.summary}</p>
      </DSection>

      <DSection label="Refinement notes" onEdit={() => startEdit("refinementNotes", disc.refinementNotes||"")}>
        {editField==="refinementNotes"
          ? <EditBox val={editVal} multi onChange={setEditVal} onSave={saveEdit} onCancel={cancelEdit} />
          : <p style={{...css.bodyText, color:disc.refinementNotes?"#c8cad4":"#4a4d5e", fontStyle:disc.refinementNotes?"normal":"italic"}}>
              {disc.refinementNotes||"tap edit to add notes"}
            </p>
        }
      </DSection>

      <DSection label="Next action" onEdit={() => startEdit("nextAction", disc.nextAction||"")}>
        {editField==="nextAction"
          ? <EditBox val={editVal} onChange={setEditVal} onSave={saveEdit} onCancel={cancelEdit} onEnter={saveEdit} />
          : <p style={{...css.bodyText, color:disc.nextAction?"#4ade80":"#4a4d5e", fontStyle:disc.nextAction?"normal":"italic"}}>
              {disc.nextAction ? `→ ${disc.nextAction}` : "no next action set"}
              {disc.nextActionDate && <span style={{color:"#6b7590",marginLeft:"0.5rem",fontSize:"0.65rem"}}>{disc.nextActionDate}</span>}
            </p>
        }
      </DSection>

      <DSection label="Decision" onEdit={() => startEdit("decision", disc.decision||"")}>
        {editField==="decision"
          ? <EditBox val={editVal} onChange={setEditVal} onSave={saveEdit} onCancel={cancelEdit} onEnter={saveEdit} />
          : <p style={{...css.bodyText, color:disc.decision?"#ffd166":"#4a4d5e", fontStyle:disc.decision?"normal":"italic"}}>
              {disc.decision||"no decision recorded"}
              {disc.decisionReason && <span style={{display:"block",fontSize:"0.68rem",color:"#6b7590",marginTop:"0.25rem",fontStyle:"normal"}}>{disc.decisionReason}</span>}
            </p>
        }
      </DSection>

      {disc.status === "banked" && (
        <DSection label="Reactivation trigger" onEdit={() => startEdit("reactivationTrigger", disc.reactivationTrigger||"")}>
          {editField==="reactivationTrigger"
            ? <EditBox val={editVal} onChange={setEditVal} onSave={saveEdit} onCancel={cancelEdit} onEnter={saveEdit} />
            : <p style={{...css.bodyText, color:disc.reactivationTrigger?"#f5a623":"#4a4d5e", fontStyle:disc.reactivationTrigger?"normal":"italic"}}>
                {disc.reactivationTrigger||"set a trigger condition"}
              </p>
          }
        </DSection>
      )}

      {/* ── S1-0 characterization (facets) ── */}
      <DSection label="Characterization">
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"0.35rem"}}>
          <span style={{...css.sectionLabel,fontSize:"0.55rem"}}>Domains · first = primary</span>
          {editField!=="domains" && <button onClick={()=>startEdit("domains",domainsStr)} style={css.editBtn}>edit</button>}
        </div>
        {editField==="domains"
          ? <EditBox val={editVal} onChange={setEditVal} onSave={saveEdit} onCancel={cancelEdit} onEnter={saveEdit} />
          : (disc.domains||[]).length
            ? <div style={{display:"flex",flexWrap:"wrap",gap:"0.3rem",marginBottom:"0.65rem"}}>
                {disc.domains.map((d,i)=>(
                  <span key={i} style={{...css.tag, ...(d.primary?{background:"rgba(167,139,250,0.16)",color:"#a78bfa"}:{})}}>
                    {d.primary?"★ ":""}{d.name}
                  </span>
                ))}
              </div>
            : <p style={{...css.bodyText,color:"#4a4d5e",fontStyle:"italic",marginBottom:"0.65rem"}}>no domains set</p>
        }
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.5rem 0.75rem"}}>
          <FacetSelect label="Surprise (1–5)" value={disc.surprise} options={[1,2,3,4,5]}
            onChange={v=>setFacet("surprise", v?parseInt(v):null)} />
          <FacetSelect label="Generality" value={disc.generality} options={GENERALITY}
            onChange={v=>setFacet("generality", v)} />
          <FacetSelect label="Capture mode" value={disc.captureMode} options={CAPTURE_MODE}
            onChange={v=>setFacet("captureMode", v)} />
          <FacetSelect label="Distance band" value={disc.distanceBand} options={DISTANCE_BAND}
            onChange={v=>setFacet("distanceBand", v)} />
        </div>
        {disc.domainDistance!=null && (
          <div style={{marginTop:"0.45rem",fontSize:"0.6rem",fontFamily:"'DM Mono',monospace",color:"#6b7590"}}>
            raw domainDistance: {disc.domainDistance}
          </div>
        )}
      </DSection>

      {(disc.tags||[]).length > 0 && (
        <div style={{display:"flex",flexWrap:"wrap",gap:"0.3rem",marginBottom:"1rem"}}>
          {disc.tags.map(t => <span key={t} style={css.tag}>#{t}</span>)}
        </div>
      )}

      {relatedItems.length > 0 && (
        <DSection label="Related discoveries">
          {relatedItems.map(r => (
            <div key={r.id} style={{fontSize:"0.7rem",color:"#4d9fff",marginBottom:"0.25rem"}}>↗ {r.id}: {r.title}</div>
          ))}
        </DSection>
      )}

      {/* ── S1-0 typed relations[] (additive over untyped relatedIds[]) ── */}
      <DSection label="Typed relations">
        {(disc.relations||[]).length > 0
          ? disc.relations.map((r,i)=>{
              const t = allItems.find(d=>d.id===r.toId);
              return (
                <div key={i} style={{display:"flex",alignItems:"center",gap:"0.4rem",fontSize:"0.68rem",color:"#c8cad4",marginBottom:"0.3rem"}}>
                  <span style={{...css.tag,color:"#4d9fff"}}>{r.kind}</span>
                  <span style={{color:"#6b7590"}}>→</span>
                  <span>{r.toId}{t?`: ${t.title}`:""}</span>
                  <button onClick={()=>removeRelation(i)} style={{...css.editBtn,marginLeft:"auto"}}>✕</button>
                </div>
              );
            })
          : <p style={{...css.bodyText,color:"#4a4d5e",fontStyle:"italic",marginBottom:"0.4rem"}}>no typed relations</p>
        }
        <div style={{display:"flex",gap:"0.3rem",marginTop:"0.45rem",flexWrap:"wrap"}}>
          <select value={relKind} onChange={e=>setRelKind(e.target.value)} style={{width:"auto",fontSize:"0.66rem"}}>
            {RELATION_KIND.map(k=><option key={k} value={k}>{k}</option>)}
          </select>
          <select value={relTo} onChange={e=>setRelTo(e.target.value)} style={{flex:1,minWidth:"8rem",fontSize:"0.66rem"}}>
            <option value="">select target…</option>
            {allItems.filter(d=>d.id!==disc.id).map(d=><option key={d.id} value={d.id}>{d.id}: {d.title.slice(0,36)}</option>)}
          </select>
          <button onClick={addRelation} style={css.saveBtn}>+ link</button>
        </div>
      </DSection>

      {/* Move to */}
      <DSection label={disc.status==="emitted" ? "Triage" : "Move to stage"}>
        {disc.status==="emitted" && (
          <p style={{...css.bodyText,color:"#7c8598",fontStyle:"italic",marginBottom:"0.5rem",fontSize:"0.68rem"}}>
            Pre-triage ambient capture — contributes 0 to density &amp; the captured funnel until triaged.
            Set the facets above, then promote to New to bind the profile and start it counting.
          </p>
        )}
        {/* S3-3 TIER 1: a cheap, offline PROVISIONAL suggestion + one-click confirm.
            Computed inline (deterministic, no clock/RNG); clearly labelled a guess so
            it never masquerades as a human-confirmed fact. Nullable-safe. */}
        {disc.status==="emitted" && (() => {
          let sug = null;
          try { sug = autoFacets(disc, allItems || []); } catch { sug = null; }
          if (!sug) return null;
          const onConfirm = () =>
            onUpdate(disc.id, confirmTriage(disc, sug, { date: new Date().toISOString().split("T")[0] }));
          return (
            <div style={{marginBottom:"0.6rem",padding:"0.5rem 0.6rem",border:"1px dashed #7c859855",borderRadius:"0.4rem",background:"#7c859810"}}>
              <div style={{fontSize:"0.58rem",fontFamily:"'DM Mono',monospace",color:"#a78bfa",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:"0.35rem"}}>
                ◇ Tier-1 provisional suggestion <span style={{color:"#7c8598"}}>(a guess — review before confirming)</span>
              </div>
              <div style={{fontSize:"0.66rem",color:"#b8c0cc",marginBottom:"0.45rem"}}>
                band <b>{sug.distanceBand}</b> · d≈<b>{sug.domainDistance.toFixed(2)}</b> ·
                surprise <b>{sug.surprise}/5</b> · impact <b>{sug.impact}/10</b>
                <span style={{color:"#7c8598"}}> — {sug.rationale?.distance}</span>
              </div>
              <button onClick={onConfirm}
                style={{...css.moveBtn, background:"#a78bfa1e", borderColor:"#a78bfa55", color:"#a78bfa"}}
                title="Bind these provisional facets and promote emitted → New">
                ✓ Confirm suggestion → Triage
              </button>
            </div>
          );
        })()}
        <div style={{display:"flex",gap:"0.4rem",flexWrap:"wrap"}}>
          {(STATUS_META[disc.status]?.next||[]).map(s => {
            const m = STATUS_META[s];
            // S2-4 triage promotion: `emitted → New` binds the facet profile AT
            // TRIAGE time (captureMode-aware) and stamps triagedDate — the moment
            // the item gains a ValueScore. Other transitions are unchanged.
            const onMove = () =>
              (disc.status==="emitted" && s==="new")
                ? onUpdate(disc.id, triagePromotionPatch(disc, {}, new Date().toISOString().split("T")[0]))
                : onUpdate(disc.id, {status:s});
            return (
              <button key={s} onClick={onMove}
                style={{...css.moveBtn, background:`${m.color}14`, borderColor:`${m.color}40`, color:m.color}}>
                → {disc.status==="emitted" && s==="new" ? "Triage → New" : m.label}
              </button>
            );
          })}
        </div>
      </DSection>

      {/* AI Analysis */}
      <div style={css.analysisPanel}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:analysis?"0.875rem":0}}>
          <span style={{fontSize:"0.6rem",fontFamily:"'DM Mono',monospace",color:"#00d4aa",letterSpacing:"0.1em",textTransform:"uppercase"}}>◈ AI Analysis</span>
          <button onClick={analyze} disabled={analyzing}
            style={{...css.analyzeBtn, opacity:analyzing?0.5:1}}>
            {analyzing ? "analyzing…" : "Analyze →"}
          </button>
        </div>
        {analysis && !analysis.error && (
          <div style={{fontSize:"0.72rem",lineHeight:"1.55"}}>
            <div style={{display:"flex",gap:"1rem",marginBottom:"0.5rem",flexWrap:"wrap"}}>
              <Kv k="Horizon" v={analysis.timeHorizon} />
              <Kv k="Complexity" v={analysis.complexity} />
            </div>
            <div style={{background:"rgba(255,209,102,0.07)",border:"1px solid rgba(255,209,102,0.15)",borderRadius:"6px",padding:"0.5rem 0.65rem",marginBottom:"0.5rem",color:"#ffd166",fontSize:"0.7rem"}}>
              <span style={{fontFamily:"'DM Mono',monospace",fontSize:"0.58rem",color:"#b89a30",display:"block",marginBottom:"0.2rem",textTransform:"uppercase",letterSpacing:"0.08em"}}>Key question</span>
              {analysis.keyQuestion}
            </div>
            {analysis.nextSteps?.length > 0 && <AList label="Next steps" items={analysis.nextSteps} color="#c8cad4" prefix="→" />}
            {analysis.risks?.length > 0 && <AList label="Risks" items={analysis.risks} color="#ff6b6b" prefix="⚠" />}
            {analysis.crossLinks?.length > 0 && <AList label="Cross-links" items={analysis.crossLinks} color="#4d9fff" prefix="↗" />}
          </div>
        )}
        {analysis?.error && <div style={{fontSize:"0.7rem",color:"#ff6b6b",marginTop:"0.5rem"}}>{analysis.error}</div>}
      </div>
    </div>
  );
}

// ─── Add Form ─────────────────────────────────────────────
function AddForm({ items, onAdd, onBack }) {
  const [f, setF] = useState({ title:"", type:"B", sourceAgent:"Manual entry", priorityScore:"",
    owner:"", summary:"", nextAction:"", tags:"", teamVisible:true,
    domains:"", surprise:"", generality:"", captureMode:"manual", distanceBand:"" });

  function submit() {
    if (!f.title.trim()) return;
    const n = items.length + 1;
    onAdd({
      id:`DISC-${String(n).padStart(3,"0")}`,
      title:f.title, type:f.type, sourceAgent:f.sourceAgent,
      discoveredDate:new Date().toISOString().split("T")[0],
      discoveredBy:f.owner||"Manual", priorityScore:parseInt(f.priorityScore)||0,
      status:"new", owner:f.owner, teamVisible:f.teamVisible, convergence:false,
      summary:f.summary, refinementNotes:"", decision:"", decisionReason:"",
      nextAction:f.nextAction, nextActionDate:"", reactivationTrigger:"",
      relatedIds:[], tags:f.tags?f.tags.split(",").map(t=>t.trim()).filter(Boolean):[],
      // ── S1-0 ontology delta (additive, nullable) ──
      domains: f.domains
        ? f.domains.split(",").map((s,i)=>({name:s.trim(),primary:i===0})).filter(d=>d.name)
        : [],
      surprise: f.surprise ? parseInt(f.surprise) : null,
      generality: f.generality || null,
      captureMode: f.captureMode || null,
      distanceBand: f.distanceBand || null,
      domainDistance: null,   // embedding-computed downstream (S1-2)
      relations: []
    });
  }

  const set = (k,v) => setF(p=>({...p,[k]:v}));

  return (
    <div style={css.root}>
      <style>{fonts + scrollbar}</style>
      <div style={{display:"flex",alignItems:"center",gap:"0.75rem",marginBottom:"1.25rem"}}>
        <button style={css.backBtn} onClick={onBack}>← back</button>
        <h2 style={{fontSize:"0.95rem",fontWeight:"700"}}>Add Discovery</h2>
      </div>
      <Field label="Title *"><input value={f.title} onChange={e=>set("title",e.target.value)} placeholder="One-line discovery title" /></Field>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.65rem"}}>
        <Field label="Type">
          <select value={f.type} onChange={e=>set("type",e.target.value)}>
            {Object.entries(TYPE_META).map(([k,v])=><option key={k} value={k}>{k} · {v.label}</option>)}
          </select>
        </Field>
        <Field label="Priority score"><input type="number" value={f.priorityScore} onChange={e=>set("priorityScore",e.target.value)} placeholder="0–40" /></Field>
      </div>
      <Field label="Source agent">
        <select value={f.sourceAgent} onChange={e=>set("sourceAgent",e.target.value)}>
          {AGENTS.map(a=><option key={a} value={a}>{a}</option>)}
        </select>
      </Field>
      <Field label="Owner"><input value={f.owner} onChange={e=>set("owner",e.target.value)} placeholder="Your name" /></Field>
      <Field label="Summary"><textarea value={f.summary} onChange={e=>set("summary",e.target.value)} rows={4} placeholder="What was discovered and why it matters" style={{resize:"vertical"}} /></Field>
      <Field label="Next action"><input value={f.nextAction} onChange={e=>set("nextAction",e.target.value)} placeholder="Specific next step" /></Field>
      <Field label="Tags (comma-separated)"><input value={f.tags} onChange={e=>set("tags",e.target.value)} placeholder="hull, biomimicry, IP" /></Field>

      {/* ── S1-0 characterization (all optional) ── */}
      <Field label="Domains (comma-separated · first = primary)">
        <input value={f.domains} onChange={e=>set("domains",e.target.value)} placeholder="01 · Physics Bridge, 11 · Mission Systems" />
      </Field>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.65rem"}}>
        <Field label="Surprise (1–5)">
          <select value={f.surprise} onChange={e=>set("surprise",e.target.value)}>
            <option value="">—</option>
            {[1,2,3,4,5].map(n=><option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
        <Field label="Generality">
          <select value={f.generality} onChange={e=>set("generality",e.target.value)}>
            <option value="">—</option>
            {GENERALITY.map(g=><option key={g} value={g}>{g}</option>)}
          </select>
        </Field>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0.65rem"}}>
        <Field label="Capture mode">
          <select value={f.captureMode} onChange={e=>set("captureMode",e.target.value)}>
            {CAPTURE_MODE.map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Distance band">
          <select value={f.distanceBand} onChange={e=>set("distanceBand",e.target.value)}>
            <option value="">—</option>
            {DISTANCE_BAND.map(b=><option key={b} value={b}>{b}</option>)}
          </select>
        </Field>
      </div>

      <div style={{display:"flex",gap:"0.5rem",marginTop:"0.75rem"}}>
        <button onClick={submit} style={css.submitBtn}>Add discovery</button>
        <button onClick={onBack} style={css.cancelBtn}>Cancel</button>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────
function DSection({ label, children, onEdit }) {
  return (
    <div style={css.dsection}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"0.35rem"}}>
        <span style={css.sectionLabel}>{label}</span>
        {onEdit && <button onClick={onEdit} style={css.editBtn}>edit</button>}
      </div>
      {children}
    </div>
  );
}

function EditBox({ val, onChange, onSave, onCancel, onEnter, multi }) {
  return (
    <div>
      {multi
        ? <textarea value={val} onChange={e=>onChange(e.target.value)} rows={3} style={{resize:"vertical",width:"100%",...css.input}} />
        : <input value={val} onChange={e=>onChange(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&onEnter&&onEnter()} style={{...css.input,width:"100%"}} />
      }
      <div style={{display:"flex",gap:"0.4rem",marginTop:"0.35rem"}}>
        <button onClick={onSave} style={css.saveBtn}>save</button>
        <button onClick={onCancel} style={css.cancelBtn}>cancel</button>
      </div>
    </div>
  );
}

function Kv({ k, v }) {
  return (
    <div style={{display:"flex",gap:"0.35rem",alignItems:"baseline"}}>
      <span style={{fontSize:"0.58rem",fontFamily:"'DM Mono',monospace",color:"#6b7590",textTransform:"uppercase",letterSpacing:"0.06em"}}>{k}</span>
      <span style={{color:"#c8cad4"}}>{v}</span>
    </div>
  );
}

function FacetSelect({ label, value, options, onChange, placeholder }) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:"0.2rem"}}>
      <span style={{fontSize:"0.55rem",fontFamily:"'DM Mono',monospace",color:"#6b7590",textTransform:"uppercase",letterSpacing:"0.06em"}}>{label}</span>
      <select value={value ?? ""} onChange={e=>onChange(e.target.value)} style={{fontSize:"0.68rem"}}>
        <option value="">{placeholder||"—"}</option>
        {options.map(o=><option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function AList({ label, items, color, prefix }) {
  return (
    <div style={{marginTop:"0.45rem",marginBottom:"0.3rem"}}>
      <div style={{fontSize:"0.58rem",fontFamily:"'DM Mono',monospace",color:"#6b7590",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:"0.3rem"}}>{label}</div>
      {items.map((s,i)=><div key={i} style={{color,marginBottom:"0.2rem",paddingLeft:"0.5rem"}}>{prefix} {s}</div>)}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{marginBottom:"0.65rem"}}>
      <label style={css.fieldLabel}>{label}</label>
      {children}
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────
const css = {
  root: { background:"#0a0e14", minHeight:"100vh", color:"#e8eaf0", padding:"1.125rem 1rem 3rem", fontFamily:"'Syne',system-ui,sans-serif" },
  loader: { background:"#0a0e14", minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center" },
  eyebrow: { fontSize:"0.6rem", fontFamily:"'DM Mono',monospace", color:"#6b7590", letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:"0.15rem" },
  h1: { fontSize:"1.05rem", fontWeight:"700", margin:0 },
  addBtn: { background:"rgba(167,139,250,0.14)", border:"1px solid rgba(167,139,250,0.35)", borderRadius:"8px", color:"#a78bfa", padding:"0.4rem 0.8rem", fontSize:"0.7rem", fontFamily:"'DM Mono',monospace", letterSpacing:"0.05em", cursor:"pointer", flexShrink:0 },
  emitBtn: { background:"rgba(124,133,152,0.16)", border:"1px solid rgba(124,133,152,0.4)", borderRadius:"8px", color:"#a7afc0", padding:"0.4rem 0.9rem", fontSize:"0.7rem", fontFamily:"'DM Mono',monospace", letterSpacing:"0.05em", cursor:"pointer", flexShrink:0 },
  statCard: { background:"#111620", border:"1px solid rgba(255,255,255,0.07)", borderRadius:"9px", padding:"0.6rem 0.5rem", textAlign:"center" },
  statLabel: { fontSize:"0.58rem", fontFamily:"'DM Mono',monospace", color:"#6b7590", letterSpacing:"0.08em", textTransform:"uppercase", marginTop:"0.15rem" },
  tabRow: { display:"flex", gap:"0.3rem", overflowX:"auto", marginBottom:"0.65rem", paddingBottom:"0.2rem" },
  tab: { flexShrink:0, padding:"0.26rem 0.6rem", borderRadius:"100px", fontSize:"0.6rem", fontFamily:"'DM Mono',monospace", letterSpacing:"0.04em", background:"transparent", border:"1px solid rgba(255,255,255,0.09)", color:"#6b7590", cursor:"pointer", transition:"all 0.15s" },
  typeBtn: { padding:"0.2rem 0.5rem", borderRadius:"6px", fontSize:"0.6rem", fontFamily:"'DM Mono',monospace", cursor:"pointer", transition:"all 0.15s", border:"1px solid", flexShrink:0 },
  countLabel: { fontSize:"0.6rem", fontFamily:"'DM Mono',monospace", color:"#6b7590", marginBottom:"0.5rem", letterSpacing:"0.06em" },
  card: { background:"#111620", border:"1px solid rgba(255,255,255,0.07)", borderRadius:"10px", padding:"0.875rem", cursor:"pointer", transition:"border-color 0.15s", position:"relative", overflow:"hidden" },
  cardAccent: { position:"absolute", top:0, left:0, bottom:0, width:"3px", opacity:0.75 },
  typeBadge: { fontSize:"0.58rem", padding:"0.14rem 0.38rem", borderRadius:"4px", fontFamily:"'DM Mono',monospace", letterSpacing:"0.04em", flexShrink:0 },
  convBadge: { fontSize:"0.55rem", padding:"0.12rem 0.35rem", borderRadius:"4px", background:"rgba(255,209,102,0.14)", color:"#ffd166", fontFamily:"'DM Mono',monospace" },
  vsBadge: { fontSize:"0.55rem", padding:"0.12rem 0.35rem", borderRadius:"4px", background:"rgba(0,212,170,0.12)", color:"#00d4aa", fontFamily:"'DM Mono',monospace", letterSpacing:"0.03em" },
  cardTitle: { fontSize:"0.78rem", fontWeight:"600", lineHeight:"1.35", marginBottom:"0.3rem" },
  cardMeta: { display:"flex", alignItems:"center", gap:"0.4rem", flexWrap:"wrap", fontSize:"0.6rem", fontFamily:"'DM Mono',monospace" },
  nextAction: { marginTop:"0.4rem", fontSize:"0.62rem", color:"#6b7590", borderTop:"1px solid rgba(255,255,255,0.04)", paddingTop:"0.35rem" },
  empty: { textAlign:"center", padding:"2rem", fontSize:"0.72rem", color:"#6b7590", fontFamily:"'DM Mono',monospace" },
  backBtn: { background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:"6px", color:"#6b7590", padding:"0.28rem 0.6rem", fontSize:"0.68rem", fontFamily:"'DM Mono',monospace", cursor:"pointer" },
  discId: { fontSize:"0.6rem", fontFamily:"'DM Mono',monospace", color:"#6b7590", letterSpacing:"0.08em" },
  statusPill: { fontSize:"0.58rem", padding:"0.15rem 0.5rem", borderRadius:"100px", fontFamily:"'DM Mono',monospace", border:"1px solid" },
  bodyText: { fontSize:"0.75rem", lineHeight:"1.6", color:"#c8cad4", margin:0 },
  dsection: { background:"#111620", border:"1px solid rgba(255,255,255,0.07)", borderRadius:"8px", padding:"0.7rem 0.875rem", marginBottom:"0.65rem" },
  sectionLabel: { fontSize:"0.57rem", fontFamily:"'DM Mono',monospace", color:"#6b7590", letterSpacing:"0.1em", textTransform:"uppercase" },
  editBtn: { background:"transparent", border:"none", color:"#6b7590", fontSize:"0.6rem", fontFamily:"'DM Mono',monospace", cursor:"pointer", padding:0 },
  tag: { fontSize:"0.58rem", padding:"0.14rem 0.42rem", borderRadius:"4px", background:"rgba(255,255,255,0.05)", color:"#6b7590", fontFamily:"'DM Mono',monospace" },
  moveBtn: { padding:"0.32rem 0.7rem", borderRadius:"7px", fontSize:"0.63rem", fontFamily:"'DM Mono',monospace", cursor:"pointer", border:"1px solid" },
  analysisPanel: { background:"rgba(0,212,170,0.04)", border:"1px solid rgba(0,212,170,0.18)", borderRadius:"10px", padding:"0.875rem" },
  analyzeBtn: { padding:"0.28rem 0.7rem", borderRadius:"6px", fontSize:"0.62rem", fontFamily:"'DM Mono',monospace", background:"rgba(0,212,170,0.1)", border:"1px solid rgba(0,212,170,0.3)", color:"#00d4aa", cursor:"pointer" },
  input: { background:"#1a2030", border:"1px solid rgba(255,255,255,0.12)", borderRadius:"6px", color:"#e8eaf0", fontFamily:"inherit", padding:"0.4rem 0.6rem", fontSize:"0.75rem", outline:"none" },
  saveBtn: { background:"rgba(74,222,128,0.1)", border:"1px solid rgba(74,222,128,0.3)", borderRadius:"5px", color:"#4ade80", padding:"0.25rem 0.6rem", fontSize:"0.62rem", fontFamily:"'DM Mono',monospace", cursor:"pointer" },
  cancelBtn: { background:"transparent", border:"1px solid rgba(255,255,255,0.1)", borderRadius:"5px", color:"#6b7590", padding:"0.25rem 0.6rem", fontSize:"0.62rem", fontFamily:"'DM Mono',monospace", cursor:"pointer" },
  fieldLabel: { display:"block", fontSize:"0.58rem", fontFamily:"'DM Mono',monospace", color:"#6b7590", letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:"0.3rem" },
  submitBtn: { flex:1, padding:"0.55rem", borderRadius:"8px", fontSize:"0.72rem", fontFamily:"'DM Mono',monospace", background:"rgba(167,139,250,0.14)", border:"1px solid rgba(167,139,250,0.35)", color:"#a78bfa", fontWeight:"600", cursor:"pointer" },
  // ── S3-2 board-UI wiring: native-capture panel ──
  nativePanel: { background:"#111620", border:"1px solid rgba(0,212,170,0.16)", borderRadius:"10px", padding:"0.7rem 0.8rem", marginBottom:"1.125rem" },
  nativeTitle: { fontSize:"0.6rem", fontFamily:"'DM Mono',monospace", color:"#00d4aa", letterSpacing:"0.1em", textTransform:"uppercase" },
  nativeState: { fontSize:"0.55rem", fontFamily:"'DM Mono',monospace", letterSpacing:"0.04em" },
  optInBtn: { padding:"0.28rem 0.7rem", borderRadius:"7px", fontSize:"0.62rem", fontFamily:"'DM Mono',monospace", cursor:"pointer", border:"1px solid", flexShrink:0 },
  nativeNote: { fontSize:"0.6rem", color:"#8b93a6", lineHeight:1.5, marginTop:"0.45rem" },
  logToggle: { background:"transparent", border:"none", color:"#a7afc0", fontSize:"0.62rem", fontFamily:"'DM Mono',monospace", cursor:"pointer", padding:0, letterSpacing:"0.04em" },
  purgeBtn: { padding:"0.24rem 0.6rem", borderRadius:"6px", fontSize:"0.6rem", fontFamily:"'DM Mono',monospace", background:"rgba(220,38,38,0.1)", border:"1px solid rgba(220,38,38,0.3)", color:"#fca5a5", cursor:"pointer" },
  purgeConfirmBtn: { padding:"0.24rem 0.6rem", borderRadius:"6px", fontSize:"0.6rem", fontFamily:"'DM Mono',monospace", background:"rgba(220,38,38,0.2)", border:"1px solid rgba(220,38,38,0.5)", color:"#fca5a5", cursor:"pointer" },
  captureRow: { background:"#0d121b", border:"1px solid rgba(255,255,255,0.06)", borderRadius:"7px", padding:"0.5rem 0.6rem" },
  captureMeta: { display:"flex", alignItems:"center", gap:"0.4rem", flexWrap:"wrap", fontSize:"0.55rem", fontFamily:"'DM Mono',monospace", color:"#6b7590", marginTop:"0.35rem" },
  nativeEmpty: { fontSize:"0.62rem", color:"#6b7590", fontFamily:"'DM Mono',monospace", padding:"0.4rem 0", textAlign:"center" },
};

const fonts = `@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@400;600;700&display=swap');
*{box-sizing:border-box}
input,textarea,select{background:#1a2030;border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:#e8eaf0;font-family:inherit;padding:0.4rem 0.6rem;font-size:0.75rem;width:100%;outline:none}
input:focus,textarea:focus,select:focus{border-color:rgba(255,255,255,0.28)}
`;

const scrollbar = `::-webkit-scrollbar{width:3px;height:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px}`;
