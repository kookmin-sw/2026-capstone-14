# Quality Gate Authority Consolidation — Design Spec

**Date:** 2026-04-22
**Status:** Approved (Architecture-Only)
**Related:** [Runtime Evaluation Spec v3](./2026-04-21-runtime-evaluation-spec-v3.md)

---

## Core Design Sentence

> All final authority over input-quality gating resides exclusively in the common gate within `scoring-engine.js`; `scoring-engine.js` more broadly integrates gate outcomes with exercise-performance results to resolve final rep state; every other module in the workout pipeline is a signal producer, metadata provider, or UX orchestrator — never a final decision-maker on quality or withholding.

---

## 1. Problem Statement

The current workout evaluation pipeline distributes quality-related decision logic across multiple modules. Exercise modules (e.g., `push-up-exercise.js`) sometimes emit reason codes such as `low_confidence` or `view_mismatch` that are fundamentally input-quality concerns, not exercise-performance concerns. This creates three problems:

1. **Authority ambiguity** — It is unclear which module owns the final "can we score or not?" decision.
2. **Reason-code pollution** — Input-quality reasons leak into exercise-module outputs, making downstream classification and UX mapping fragile.
3. **Duplication risk** — The same quality check may be implemented differently across exercise modules, leading to inconsistent behavior.

This design consolidates all final quality-gate authority into one place and clearly defines what every other module may and may not do.

---

## 2. Target Architecture

The pipeline flows as follows:

```
pose-engine.js
    ↓ (raw quality signals)
scoring-engine.js  ← common quality gate (final authority)
    ↓ (pass → exercise evaluation; withhold → skip)
push-up-exercise.js (or other exercise module)
    ↓ (performance result only)
scoring-engine.js  ← state integration & rep-state application
    ↓ (resolved state + reason)
session-controller.js  ← UX message mapping & pipeline orchestration
```

### Module Roles

| Module | Role | May Emit Final Quality/Withhold Decision? |
|---|---|---|
| `pose-engine.js` | Produces raw quality signals (landmarks, visibility, confidence, view estimate, stability) | **No** — signal producer only |
| `scoring-engine.js` | Hosts the common quality gate (final `pass` / `withhold` decision); integrates gate outcome with exercise results to resolve final rep state (`scored`, `withheld`, `hard_fail`, `soft_fail`) | **Yes** — sole final authority (gate for quality; engine for rep-state integration) |
| `push-up-exercise.js` (and other exercise modules) | Provides exercise requirement metadata (required view, important joints) and motion-semantic evaluation (depth, lockout, body line) | **No** — metadata + performance semantics only |
| `session-controller.js` | Orchestrates the pipeline and maps resolved states/reasons to UX messages | **No** — orchestration & UX only |

---

## 3. Authority Rules

### 3.1 Sole Authority of the Common Gate (`scoring-engine.js`)

The common quality gate inside `scoring-engine.js` is the **only** place in the codebase that may:

- Decide `pass` vs. `withhold` for a given frame or rep window.
- Assign a final withhold reason code.
- Determine whether the exercise module should be invoked at all.

Note: rep-state resolution (`scored`, `withheld`, `hard_fail`, `soft_fail`) is performed by `scoring-engine.js` more broadly, *after* the common gate and exercise evaluation have both produced their outputs. The gate itself does not own exercise-performance decisions; it only owns the input-quality pass/withhold decision.

### 3.2 Prohibited Exercise-Module Behaviors

Exercise modules **must not**:

- Emit `withhold` as a result state.
- Emit any of the following reason codes (these are gate-owned exclusively):
  - `out_of_frame`
  - `tracked_joints_low`
  - `view_unstable`
  - `view_mismatch`
  - `low_confidence`
  - `joints_missing`
- Decide whether scoring should be skipped or deferred.
- Apply final rep state to any session-level data structure.

### 3.3 Permitted Exercise-Module Behaviors

Exercise modules **may**:

- Declare **requirement metadata**: required view(s), important joint sets, minimum visibility expectations.
- Evaluate **motion semantics** after the gate has passed: depth reached, lockout complete, body line maintained, tempo control, etc.
- Return performance-oriented result states (`hard_fail`, `soft_fail`, `pass`) with **exercise-specific** reason codes (e.g., `depth_not_reached`, `lockout_incomplete`, `body_line_broken`).
- Provide feedback strings or structured hints for the UX layer.

### 3.4 `pose-engine.js` — Signal Producer

`pose-engine.js` produces raw signals that the common gate consumes. It does **not** make any gating decisions. Its outputs include:

- Landmark coordinates and presence flags.
- Per-joint visibility scores.
- Detection and tracking confidence values.
- Estimated view classification and confidence.
- Stability metrics over recent frame windows.

### 3.5 `session-controller.js` — Orchestrator & UX Mapper

`session-controller.js` is responsible for:

- Invoking the pipeline in the correct order.
- Consuming the resolved state and reason from `scoring-engine.js`.
- Mapping reason codes to user-facing messages.
- Managing session lifecycle (start, pause, end, export).

It does **not** interpret raw quality signals or make gating decisions.

---

## 4. Practical Data Contract

### 4.1 Input from `pose-engine.js` → `scoring-engine.js`

```
{
  landmarks: [...],
  jointVisibility: { jointName: number, ... },
  detectionConfidence: number,
  trackingConfidence: number,
  estimatedView: string,
  estimatedViewConfidence: number,
  stabilityWindow: { unstableRatio: number, stableStreak: number, ... }
}
```

### 4.2 Input from Exercise Module Metadata (declarative)

```
{
  exerciseType: "push-up",
  requiredViews: ["SIDE"],
  importantJoints: ["left_elbow", "right_elbow", "left_shoulder", "right_shoulder", ...],
  motionSemantics: {
    // phase definitions, angle thresholds, etc.
  }
}
```

### 4.3 Output from Common Gate (`scoring-engine.js`) → Downstream

```
{
  gateResult: "pass" | "withhold",
  withholdReason?: string,   // only present when gateResult === "withhold"
  // gate-owned reason codes only:
  //   out_of_frame, tracked_joints_low, view_unstable,
  //   view_mismatch, low_confidence, joints_missing, ...
}
```

### 4.4 Output from Exercise Module → `scoring-engine.js`

```
{
  result: "pass" | "hard_fail" | "soft_fail",
  reasons?: string[],   // exercise-specific codes only:
                        //   depth_not_reached, lockout_incomplete, body_line_broken, ...
  feedback?: string[]
}
```

### 4.5 Final Resolved State (`scoring-engine.js` → `session-controller.js`)

```
{
  repState: "scored" | "withheld" | "hard_fail" | "soft_fail",
  score?: number,
  reason?: string,       // single authoritative reason code
  feedback?: string[]
}
```

---

## 5. Current Code Implications

### 5.1 `scoring-engine.js`

- Must host the common quality gate logic that currently may be scattered.
- Must be the sole consumer of `pose-engine.js` signals for gating decisions.
- Must integrate exercise-module results only after the gate has passed.
- Must own the rep-state machine and its transitions.

### 5.2 `pose-engine.js`

- Should be audited to ensure it does not contain any gating or decision logic.
- Its responsibility is strictly signal production.

### 5.3 `push-up-exercise.js`

- Must be audited to remove any emission of gate-owned reason codes (`low_confidence`, `view_mismatch`, etc.).
- Must be refactored to return only exercise-performance results.
- Should expose its requirement metadata (required view, important joints) as declarative data that the common gate can consume.

### 5.4 `session-controller.js`

- Must be audited to ensure it does not interpret raw quality signals or make gating decisions.
- Should consume only the resolved state and reason from `scoring-engine.js`.
- Should focus on pipeline orchestration and UX message mapping.

---

## 6. Non-Goals

This design document explicitly **excludes** the following:

- **Migration plan** — How to move existing logic from exercise modules to the common gate is an implementation concern.
- **Detailed test specifications** — Test strategy is out of scope for this architecture document.
- **Threshold tuning** — Specific numeric thresholds for visibility, confidence, stability, etc. are covered in the Runtime Evaluation Spec v3 (Appendix A) and are not part of this authority-consolidation design.
- **New exercise additions** — This document assumes the existing exercise module pattern; adding new exercises follows the same authority rules but is not scoped here.
- **Database or storage changes** — This design is purely about in-process module authority and data contracts.
- **UI/UX design** — Message content and presentation are outside this document's scope.

---

## 7. Success Criteria

This design is considered successfully implemented when:

1. **Single authority** — `scoring-engine.js` is the only module that emits `withhold` decisions or gate-owned reason codes.
2. **Clean separation** — No exercise module emits `out_of_frame`, `tracked_joints_low`, `view_unstable`, `view_mismatch`, `low_confidence`, or `joints_missing`.
3. **Declarative metadata** — Exercise modules expose their requirements (view, joints) as data that the common gate consumes, not as embedded decision logic.
4. **Signal purity** — `pose-engine.js` produces only raw signals with no gating decisions.
5. **Orchestration clarity** — `session-controller.js` consumes only resolved states and reasons; it does not interpret raw signals.
6. **Reason-code integrity** — Every reason code in the system has a single, unambiguous owner (gate or exercise module), documented in the reason-code responsibility matrix (see Runtime Evaluation Spec v3, Appendix B).

---

## Appendix: Reason-Code Ownership Summary

| Reason Code | Owner | Category |
|---|---|---|
| `out_of_frame` | `scoring-engine.js` (gate) | Input quality |
| `tracked_joints_low` | `scoring-engine.js` (gate) | Input quality |
| `view_unstable` | `scoring-engine.js` (gate) | Input quality |
| `view_mismatch` | `scoring-engine.js` (gate) | Input quality |
| `low_confidence` | `scoring-engine.js` (gate) | Input quality |
| `joints_missing` | `scoring-engine.js` (gate) | Input quality |
| `depth_not_reached` | Exercise module | Performance |
| `lockout_incomplete` | Exercise module | Performance |
| `body_line_broken` | Exercise module | Performance |
| `tempo_uncontrolled` | Exercise module | Performance |

> **Rule of thumb:** If the reason describes a problem with the *input* (camera, tracking, visibility, view), it belongs to the gate. If the reason describes a problem with the *movement* (depth, form, tempo), it belongs to the exercise module.
