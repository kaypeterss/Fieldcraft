# Architecture

## Purpose and scope

Fieldcraft is a browser-based, system-agnostic 2D tabletop for precise competitive wargaming practice. It initially provides manual geometry, positioning, and measurement rather than a rules-heavy videogame. The current prototype supports one 60 × 44 inch battlefield, circular models, normalized units, allowance-limited movement sessions, selection, and measurement.

React owns the application chrome and ordinary UI. PixiJS owns the high-frequency tabletop rendering and pointer surface. Pure TypeScript owns authoritative state transitions and geometry. This split keeps core behavior usable in tests and, later, on a multiplayer server or replay worker.

## Coordinates and precision

- Canonical spatial units are tabletop inches, never screen pixels.
- The battlefield origin is its top-left; +X points right and +Y points down.
- Rotation is stored in radians, increasing clockwise in this coordinate convention.
- JavaScript number precision is retained in state. Values are rounded only when formatted for display.
- Millimeter/inch conversion is centralized in `src/engine/units.ts` using 25.4 mm per inch.
- Geometry contact uses one centralized `GEOMETRY_EPSILON` (`1e-9` tabletop inches) to absorb floating-point noise. It is not a gameplay gap: exact touching remains legal, and no visible clearance is added.
- The Pixi world container applies the camera translation and pixels-per-inch scale. Pan, zoom, viewport size, and device pixel ratio therefore do not alter gameplay coordinates.
- Pointer intent is the deliberate exception to tabletop-unit geometry: a four-screen-pixel threshold distinguishes a click from a drag consistently at every zoom level. Crossing it may begin movement; sub-threshold jitter never does.

## Domain and state ownership

Authoritative `GameState` is a plain, JSON-serializable object containing the schema version, battlefield, models, units, unit definitions, and optional active movement session. A model has stable IDs for itself, its unit, and owner; position; rotation; base geometry; and an optional label. Base geometry is a discriminated object (`shape: "circle"`) so additional shapes can be added without changing the model concept.

Units reference canonical models by stable `modelIds`; they never duplicate model objects. A `UnitDefinition` describes what a unit type is and supplies prototype game data such as movement allowance. A `Unit` is one match instance with owner, definition reference, and model membership. This makes future coherency a Unit→Models query and keeps mutable match state separate from reusable game data.

Selection, active tool, camera, drag gesture, and measurement workflow are transient UI state. They are deliberately excluded from `GameState`. Pixi display objects, React components, DOM nodes, and callbacks never enter authoritative state.

Transient references to derived views follow the same rule: the measurement tool stores only the two measured model IDs. Its current distance is recomputed from authoritative positions and base geometry, so moving either model cannot leave a stale numeric result in UI state.

State changes use explicit actions and a pure reducer. Movement-session start, request, confirm, and cancel are deterministic state transitions. This lightweight approach leaves room for action IDs, actors, validation, history, and server transport without introducing event sourcing now.

## Movement sessions and policy

A movement session captures participating model IDs, starting positions, per-model movement used, compact accepted paths, and a stable reference point. The reference is the geometric centroid of participant centers at session start; its accepted path is translated by the same offsets as the rigid formation and is never recomputed from changing positions. Only accepted tabletop segments add distance; rejected cursor travel does not. Straight collinear path points are merged without changing travelled distance. Confirm retains positions and clears the session; Cancel restores captured starting positions and clears temporary movement state.

Movement session lifecycle deliberately separates three operations: Confirm commits the active session, Cancel discards only the active session and restores its captured start, and Undo Last Confirmed Movement restores the immediately preceding pre-confirm authoritative model snapshot. The current undo slot is one-level, serializable movement state in `GameState`; a real confirmed change replaces it, a cancelled or no-op session does not, and consuming it clears the slot without creating redo behavior. This temporary slot is an extensible boundary for a future general reversible action history, not that history itself.

Movement allowance is resolved from Model→Unit→UnitDefinition. The generic engine consumes the resulting inch value without interpreting why it applies. Every participating model tracks usage independently, even when models belong to the same unit.

Input submits requested tabletop destinations. One bounded rigid-translation solver handles both individual and multi-model movement. It finds the earliest continuous contacts across every moving-model/non-moving-model pair, advances every participant by one shared offset, and projects the untravelled requested vector into the directions allowed by all active contact normals. Contacts whose travel fractions differ by no more than the centralized tabletop tolerance are handled as one deterministic, ID-sorted constraint set. If no shared legal component remains, movement stops.

Selected models never slide independently. Every accepted straight or tangent segment is applied identically to the entire selected formation, preserving exact relative positions. Its length is charged to every participant, and the first participant to exhaust its remaining allowance limits the group. Per-model pass-over capability suppresses that model's path contact while destination overlap remains illegal. Additional constraint sources such as terrain can later join this resolver without moving policy into PixiJS.

Battlefield edges participate in the same movement-constraint philosophy as model contacts. A circular base's legal center rectangle is inset by its actual radius; the center alone never defines edge validity. At first contact, each active edge contributes an inward normal, so outward movement is removed while tangential or away movement remains available. Rejected outward travel contributes no movement distance. A rigid group uses one shared edge constraint from whichever selected base reaches an edge first, preserving formation.

## Geometry and rendering

Geometry in `src/engine/geometry` has no React, PixiJS, or browser dependency. It owns distances and battlefield constraints; it does not interpret game rules. Group movement calculates one allowed delta for all selected models, preserving relative positions while keeping every base inside the battlefield.

Placement validity is also generic geometry: circular bases may touch but may not overlap. The reducer clamps proposed positions to the battlefield, then rejects a batched move if any moving model overlaps a non-moving model. Models in the same move are intentionally excluded from collision checks so their captured formation is preserved. PixiJS only proposes tabletop positions; it is never the authority for collision validity.

Movement distinguishes **path validity** from **destination validity**. A continuous center-segment query treats each moving center as a point against an obstacle expanded by `movingRadius + blockingRadius`; no base-size special cases exist. Normal models resolve to first contact instead of tunneling. `canPassOverModels` is a generic capability on the model, not an Age of Sigmar rule: capable models skip path blocking but still must finish in a non-overlapping destination.

Contact handling is directional and independent of circular base radius. If a model starts touching, or is within the geometry epsilon of a tiny accidental overlap, its normalized radial movement component is compared with the centralized tabletop tolerance. Movement meaningfully inward is blocked while movement away, tangent, or only numerically inward remains available. This prevents repeated near-zero contact with the same expanded circle from consuming the iteration budget and trapping larger or unequal bases.

Multiple active constraints may combine model contacts and battlefield boundaries. Near-simultaneous contacts are collected within the same centralized tolerance and projected together; corners therefore stop cleanly when no shared legal vector remains, while movement away from either active edge resumes immediately. This is constraint projection, not automatic pathfinding or routing.

Individual collision response uses the contact normal only to project out inward travel; it adds no impulse or automatic detour. A direct center-line push therefore remains stopped, a diagonal push can continue along the local tangent, and a second blocker or battlefield edge can stop that tangent attempt. Final placement validation remains authoritative, so the bounded response cannot squeeze through an illegal gap.

Translation accounting is intentionally separate from future rotation. Geometric orientation, swept rotation geometry, and a game system's rotation movement-cost policy are three distinct concerns; this milestone implements none of the latter two and does not assume they share translation-distance rules.

The Pixi adapter reads domain state, projects inches through the camera, draws models, and translates pointer gestures into actions or UI callbacks. A regular click resolves to one model, Shift toggles model membership, and Ctrl/Cmd selects the clicked model's whole unit. Ctrl/Cmd has precedence if Shift is also held; no fourth combination mode exists. Unit selection is a click-only gesture and never arms movement. One non-interactive movement overlay renders the session reference path for either an individual or rigid group. It shows accepted movement—not the raw pointer request—and is derived only from serializable tabletop coordinates. Rendering order is explicit: board/grid, models, then non-interactive analysis overlays. This ordering is presentation-only and is not part of gameplay logic. Future terrain must similarly separate visual artwork from collision/gameplay geometry.

Enter dispatches the same confirm action as the existing button, while Escape dispatches the same cancel action. Ctrl/Cmd+Z dispatches the movement undo action only outside editable controls; text inputs, textareas, selects, and contenteditable surfaces retain normal browser editing behavior. Keyboard repeat is safe because the reducer requires an active session for confirmation and consumes the one-level undo slot exactly once.

## Extension boundaries

- **Game systems:** Generic state must not hardcode Age of Sigmar terms or statistics. A later game-system module can supply definitions, terminology, data version, and optional rule validators.
- **Army import:** External formats belong in adapters that produce a normalized internal army list. List composition, game-data definitions, and the resolved playable army remain separate concepts.
- **Game-data versions:** Saved games and replays must retain a version reference or immutable snapshot so later balance changes cannot rewrite history.
- **Multiplayer:** The eventual server is authoritative. Clients submit actions; the server validates pure state transitions and broadcasts resulting state. Stable IDs and JSON-safe state are prerequisites already enforced here.
- **Replay:** Deterministic actions and state snapshots can later support undo, replay, inspection, and branching. Random results must eventually be explicit or generated through controlled RNG.
- **Smart Move:** Pathfinding operates only on serializable state, geometry, and game-system policies. It must not depend on React, PixiJS, frame timing, or pixels. Current manual group sliding is rigid translation only; future formation solving or Smart Move may reposition members under coherency rules and is a distinct system.

## Performance principles

PixiJS handles pointer-frequency visual work and large tabletop scenes; React is limited to normal UI and authoritative state coordination. Optimize from profiling rather than adding premature spatial indexes or generalized rule frameworks. The current renderer redraws this small prototype scene after state changes; model-level reconciliation or spatial indexing can be introduced when measured scale requires it.

## Deliberate omissions

No Army, GameSystem, importer, terrain, coherency, networking, replay, rotation, or pathfinding implementation is included. Their boundaries are recorded above, while creating unused abstractions now would obscure the working core. Circular bases are the only implemented shape.
