// semantic-convergence.test.mjs — offline unit tests for the S2-2 engine.
// ============================================================================
// Plain-node tests, no framework, no network, no installs:
//     node app/lib/semantic-convergence.test.mjs
// Exits non-zero on any failure so it can gate CI.
//
// Fixtures use only the repo's generic sample vocabulary (warehouse robotics,
// cold-storage, SRE / incident reviews, biomimicry gait) — boundary-safe.
// The distance fixtures were calibrated against LocalHashEmbeddingProvider so
// the three bands are reproduced deterministically.
// ============================================================================

import {
  LocalHashEmbeddingProvider,
  cosineDistance, cosine, classifyBand, gDist,
  extractPoles, ideaDistance,
  domainCentroids, domainDistance, primaryDomain,
  detectConvergences, convergentDiscoveryIds, analyzeDiscoveries,
  BANDS, DEFAULTS,
} from './semantic-convergence.mjs';

// ── tiny assert harness ──────────────────────────────────────────────────────
let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
function eq(name, got, want) { check(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }

const provider = new LocalHashEmbeddingProvider();
const dist = (a, b) => cosineDistance(provider.embed(a), provider.embed(b));

// ── 1. Distance metric sanity ────────────────────────────────────────────────
console.log('\nDistance metric (d = 1 − cos):');
check('identical text → d ≈ 0', dist('warehouse robot', 'warehouse robot') < 1e-9);
check('cos(self) ≈ 1', Math.abs(cosine(provider.embed('a b c'), provider.embed('a b c')) - 1) < 1e-9);
check('disjoint vocab → d ≈ 1', Math.abs(dist('robot terrain gait', 'invoice payroll ledger') - 1) < 1e-9);
check('zero/empty text → cos 0, d 1', dist('', 'anything here') === 1);

// ── 2. Band classification: cliché→too-close, mid→serendipity, noise→too-far ──
console.log('\nBand classification (τ_lo=0.30, τ_hi=0.70):');

const CLICHE = dist(
  'distributed leg level feedback lets legged robots cross uneven terrain without central planning',
  'legged robots cross uneven terrain using distributed leg level feedback instead of central planning',
);
check(`cliché → too-close (d=${CLICHE.toFixed(3)})`, classifyBand(CLICHE) === BANDS.TOO_CLOSE, `band=${classifyBand(CLICHE)}`);

const MID = dist(
  'gait adaptation across uneven terrain uses distributed local feedback not central control',
  'safety incident review across teams uses distributed local learning not central blame',
);
check(`mid → serendipity-band (d=${MID.toFixed(3)})`, classifyBand(MID) === BANDS.SERENDIPITY, `band=${classifyBand(MID)}`);

const NOISE = dist(
  'cockroach gait feedback terrain robot mobility locomotion',
  'cold storage warehouse temperature margin labor shortage premium',
);
check(`noise → too-far (d=${NOISE.toFixed(3)})`, classifyBand(NOISE) === BANDS.TOO_FAR, `band=${classifyBand(NOISE)}`);

// Threshold edges (τ_lo ≤ d ≤ τ_hi is the band; strictly outside are the tails).
eq('just below τ_lo → too-close', classifyBand(0.2999), BANDS.TOO_CLOSE);
eq('exactly τ_lo → serendipity', classifyBand(0.30), BANDS.SERENDIPITY);
eq('exactly τ_hi → serendipity', classifyBand(0.70), BANDS.SERENDIPITY);
eq('just above τ_hi → too-far', classifyBand(0.7001), BANDS.TOO_FAR);

// ── 3. Peaked g_dist curve (S1-2 §4) ─────────────────────────────────────────
console.log('\ng_dist peaked value curve:');
check('peak = 1.0 at d=c', Math.abs(gDist(DEFAULTS.C) - 1) < 1e-9);
check('near tail floors at 0.20', Math.abs(gDist(0.0) - 0.20) < 1e-9, `got ${gDist(0)}`);
check('far tail floors at 0.15', Math.abs(gDist(1.0) - 0.15) < 1e-9, `got ${gDist(1)}`);
check('band center scores above both tails', gDist(0.5) > gDist(0.0) && gDist(0.5) > gDist(1.0));
check('never zero (no-exclusion)', gDist(0.0) > 0 && gDist(1.0) > 0 && gDist(2.0) > 0);

// ── 4. Idea-distance & pole extraction ───────────────────────────────────────
console.log('\nIdea-distance / pole extraction:');
check('splits title on → glyph',
  JSON.stringify(extractPoles({ title: 'Insect gait patterns → multi-terrain robot mobility' }))
  === JSON.stringify({ source: 'Insect gait patterns', target: 'multi-terrain robot mobility' }));
check('splits title on ↔ glyph', extractPoles({ title: 'A idea ↔ B idea' }).target === 'B idea');
check('explicit poles object wins', extractPoles({ poles: { source: 'x', target: 'y' }, title: 'a → b' }).source === 'x');
check('no separator → null poles', extractPoles({ title: 'a single flat title' }) === null);
{
  const r = ideaDistance({ title: 'warehouse robot mobility → warehouse robot mobility' }, provider);
  check('identical poles → too-close idea', r && r.band === BANDS.TOO_CLOSE, `d=${r && r.distance}`);
}

// ── 5. Domain-distance via centroids ─────────────────────────────────────────
console.log('\nDomain-distance (centroids):');
{
  const corpus = [
    { id: 'A1', domains: ['robotics'], summary: 'legged robot gait terrain mobility locomotion feedback control' },
    { id: 'A2', domains: ['robotics'], summary: 'robot mobility terrain locomotion legged gait control feedback' },
    { id: 'B1', domains: ['finance'], summary: 'invoice payroll ledger revenue margin accounting audit' },
  ];
  const cents = domainCentroids(corpus, provider);
  check('two domains get centroids', cents.has('robotics') && cents.has('finance'));
  const dd = domainDistance('robotics', 'finance', cents);
  check('unrelated domains → too-far', dd && dd.band === BANDS.TOO_FAR, `d=${dd && dd.distance.toFixed(3)}`);
  check('unknown domain → null', domainDistance('robotics', 'nope', cents) === null);
  eq('primaryDomain reads domains[]', primaryDomain(corpus[0]), 'robotics');
  eq('primaryDomain honors {primary} flag',
    primaryDomain({ domains: [{ id: 'sec' }, { id: 'main', primary: true }] }), 'main');
  eq('primaryDomain falls back to sourceAgent',
    primaryDomain({ sourceAgent: '01 · Physics Bridge' }), '01 · Physics Bridge');
}

// ── 6. Convergence: 3 distinct domains FIRES; 2 domains does NOT ──────────────
console.log('\nConvergence detection (≥3 discoveries, ≥3 distinct primary domains):');

// FIRES: three discoveries, three distinct domains, mutually converges-with.
const CONVERGE_3 = [
  { id: 'C1', domains: ['biomechanics'], relations: [{ toId: 'C2', kind: 'converges-with' }, { toId: 'C3', kind: 'converges-with' }] },
  { id: 'C2', domains: ['sre-culture'], relations: [{ toId: 'C1', kind: 'converges-with' }, { toId: 'C3', kind: 'converges-with' }] },
  { id: 'C3', domains: ['materials'],   relations: [{ toId: 'C1', kind: 'converges-with' }, { toId: 'C2', kind: 'converges-with' }] },
];
{
  const events = detectConvergences(CONVERGE_3);
  check('3-domain cluster fires exactly one Convergence', events.length === 1, `got ${events.length}`);
  if (events[0]) {
    eq('  event size', events[0].size, 3);
    eq('  distinct domain count', events[0].domainCount, 3);
    check('  members captured', JSON.stringify(events[0].members) === JSON.stringify(['C1', 'C2', 'C3']));
  }
}

// DOES NOT FIRE: three discoveries but only TWO distinct primary domains.
const CONVERGE_2DOM = [
  { id: 'D1', domains: ['robotics'], relations: [{ toId: 'D2', kind: 'converges-with' }, { toId: 'D3', kind: 'converges-with' }] },
  { id: 'D2', domains: ['robotics'], relations: [{ toId: 'D1', kind: 'converges-with' }, { toId: 'D3', kind: 'converges-with' }] },
  { id: 'D3', domains: ['demand'],   relations: [{ toId: 'D1', kind: 'converges-with' }, { toId: 'D2', kind: 'converges-with' }] },
];
check('2-domain agreement does NOT fire', detectConvergences(CONVERGE_2DOM).length === 0);

// DOES NOT FIRE: only two discoveries (size < 3), even across two domains.
const CONVERGE_SIZE2 = [
  { id: 'E1', domains: ['a'], relations: [{ toId: 'E2', kind: 'converges-with' }] },
  { id: 'E2', domains: ['b'], relations: [{ toId: 'E1', kind: 'converges-with' }] },
];
check('size-2 cluster does NOT fire', detectConvergences(CONVERGE_SIZE2).length === 0);

// Symmetry: edge declared on one side only still connects both.
const ONE_SIDED = [
  { id: 'F1', domains: ['x'], relations: [{ toId: 'F2', kind: 'converges-with' }, { toId: 'F3', kind: 'converges-with' }] },
  { id: 'F2', domains: ['y'], relations: [] },
  { id: 'F3', domains: ['z'], relations: [] },
];
check('one-sided edges connect symmetrically → fires', detectConvergences(ONE_SIDED).length === 1);

// Dangling edge (target not in corpus) is ignored, and non-converges kinds too.
const MIXED = [
  { id: 'G1', domains: ['x'], relations: [{ toId: 'G2', kind: 'converges-with' }, { toId: 'GHOST', kind: 'converges-with' }] },
  { id: 'G2', domains: ['y'], relations: [{ toId: 'G3', kind: 'bridges' }] },
  { id: 'G3', domains: ['z'], relations: [] },
];
check('dangling + non-converges edges do not manufacture a Convergence',
  detectConvergences(MIXED).length === 0);

// convergentDiscoveryIds convenience matches members of fired events.
check('convergentDiscoveryIds returns the 3 members',
  JSON.stringify(Array.from(convergentDiscoveryIds(CONVERGE_3)).sort()) === JSON.stringify(['C1', 'C2', 'C3']));

// ── 7. analyzeDiscoveries end-to-end ─────────────────────────────────────────
console.log('\nanalyzeDiscoveries (end-to-end):');
{
  const corpus = [
    ...CONVERGE_3.map((d, i) => ({ ...d, title: ['gait patterns → robot mobility', 'incident reviews → safety posture', 'material fatigue → maintenance schedule'][i], summary: 'x' })),
  ];
  const out = analyzeDiscoveries(corpus);
  check('reports one convergence', out.convergences.length === 1);
  check('convergentIds populated', out.convergences.length ? out.convergentIds.length === 3 : false);
  check('per-discovery band computed from title poles',
    out.perDiscovery.every((p) => p.distanceBand !== null));
  check('domain pair matrix built', out.domainPairs.length === 3); // C(3,2)
}

// ── summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
if (failures.length) {
  console.log(`FAILED: ${failures.length} failure(s), ${passed} passed.`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
} else {
  console.log(`PASSED: all ${passed} checks green.`);
  process.exit(0);
}
