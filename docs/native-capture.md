# Native Capture — the operating directive

**S3-2.** The Clairvoyance-native capture connector (`app/lib/native-capture.mjs`)
is implementation #1 of the S3-1 `CaptureSource` / `defineSource` contract
(`app/lib/ingest.mjs`). It lets a Staff member or agent, **as a byproduct of
doing its work**, drop a captured *surprise* into the board — where it lands as a
pre-triage `emitted` note and rides the existing S2-4 gate ("Emitted ≠ counted
(yet)").

This document is the **directive**: the rule an emitter follows when a genuine
surprise strikes. The connector enforces the privacy invariants structurally; the
directive covers the judgment the connector can't.

## The rule

> **When — and only when — a genuine surprise strikes during your work, emit a
> single distilled note: _what_ surprised you, _where_ it happened, and _why_ it
> was surprising. Never the raw conversation.**

- **Emit on surprise, not on schedule.** A capture is worth making when something
  genuinely violates your expectation — a coincidence, an unexpected reuse, a
  result that "shouldn't" have worked. Routine progress is not a surprise. If you
  find yourself capturing everything, you are capturing nothing.
- **Distill to three fields.** `what` (the surprise, one line), `where` (the
  locus — the task/surface you were in), `why` (why it defied expectation). That
  is the whole payload. It is a pointer for later triage, not a transcript.
- **Never store raw content.** Do not paste the conversation, the message body,
  the transcript, or the document text. The distilled *what/where/why* is enough
  to recognize the surprise later; the raw material stays where it already lives.

## Hard privacy invariants (ratified — enforced in code)

The connector guarantees these structurally, and `native-capture.smoke.mjs`
proves each:

1. **User-local, zero-network.** The connector does no remote I/O of any kind —
   no server calls, no telemetry, no phone-home. A capture goes **only** to the
   user's local board store, via the S3-1 `ingestCapture` path. Nothing leaves
   the user's environment.
2. **Distilled-only.** Only the distilled `what` / `where` / `why` (plus minimal
   provenance) are stored. Raw conversation content is dropped structurally — the
   distiller reads only the distilled fields and ignores everything else.
3. **Local adapter only.** Persistence rides the board's own local storage
   adapter (the `window.storage` / localStorage corpus). The connector adds no
   storage of its own.
4. **Never auto-public.** A capture is **private board state**. The connector sets
   no public flag ever, and marks native captures `teamVisible: false`
   (private-to-user). A capture becomes public **only** if the user later
   explicitly promotes a discovery through the existing, separate artifact
   flow — which this connector does not touch.
5. **Opt-in per surface.** Capture is **off by default**. It fires only for
   surfaces the user has explicitly enabled (`enableSurface` / `disableSurface`).
6. **View + purge anytime.** The user can list their native captures
   (`listNativeCaptures`) and delete them from the local store
   (`purgeNativeCaptures`) at any time. Purge is native-only — it never touches
   other discoveries.

## How it plugs in

`native-capture.mjs` calls S3-1's `defineSource({ id: 'clairvoyance-native',
normalize })` — no edit to `ingest.mjs`. The distilled payload flows through
`ingestCapture`, producing a standard `emitted` note that the S2-4 pipeline
(`board-scoring.mjs` / `board-metrics.mjs`) already knows how to gate: it counts
as unweighted emitter backlog and contributes zero to value-weighted density or
the funnel `captured` denominator until the user triages it.

### API surface

| Function | Purpose |
| --- | --- |
| `enableSurface(surface)` / `disableSurface(surface)` | Opt a surface in / out (default off). |
| `isSurfaceEnabled(surface)` / `enabledSurfaces()` | Inspect the opt-in registry. |
| `createSurfaceRegistry(initial?)` | An isolated registry (for tests / scoped call sites). |
| `captureSurprise(input, opts)` | Pure builder: gate + distill → a private `emitted` note, or `null` if the surface isn't opted in. |
| `recordCapture(store, input, opts)` | Gate + distill + persist onto the board's own corpus via its adapter. |
| `listNativeCaptures(store, opts)` | The user's capture log (native notes only). |
| `purgeNativeCaptures(store, opts)` | Delete native captures from the local store (native-only). |

`opts.now` supplies the capture timestamp — the module reads no clock (it stays
deterministic; the board reads the clock at the UI edge, exactly as the in-app
ambient emitter does).

## Deferred (not built in S3-2)

- **Board-UI surfacing.** A capture-log view, a purge button, and a per-surface
  opt-in toggle in `discovery-board.jsx` are a thin follow-up the SM wires **after
  S3-5 lands** (deferred to avoid a collision with the in-flight S3-5 board edit).
  The APIs above are what that wiring will call.
- **Group/team capture-sharing.** Explicitly out of scope. A native capture is
  private-to-user board state only.
- **Contract-level default.** Separately, S3-1's `ingestCapture` currently
  hardcodes `teamVisible: true` for all ingested captures; that default should
  later be reconsidered toward private-by-default. For now S3-2 overrides it
  per-note. Not an S3-2 change.
