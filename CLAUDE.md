# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## What this repository is

An ioBroker adapter of type `visualization-widgets` (`onlyWWW: true`, `mode: none`) that ships **no
Node.js runtime code**. It delivers one diagram in two places:

- a **vis-2 widget set** (`src-widgets/` → `widgets/energyflow/`), loaded by vis-2 through Vite module
  federation, declared in `io-package.json` under `common.visWidgets.energyflowWidgets`;
- a **ioBroker.devices plugin** (`src-dm-widgets/` → `admin/dm-widgets/`), loaded by the widget
  manager of ioBroker.devices, declared under `common.deviceWidgets`;
- an **admin tab** (`src-admin/` → `admin/tab.html` + `admin/tab-assets/`), declared as
  `common.adminTab`, where stored diagrams are edited without opening vis.

Both are thin. Everything that decides what a diagram *is* and how it looks lives in three shared
source packages that are compiled into both bundles:

| Package | Contents | Rule |
|---|---|---|
| `packages/core` | model, value resolution, geometry, runtime, SVG renderer | **No MUI, no socket, no icon package.** Only React. |
| `packages/editor` | the designer dialog | MUI + `@iobroker/gui-components`; host-agnostic via `EditorContext` |
| `packages/i18n` | the dictionary | used by both bundles |

They are consumed through the aliases `@energyflow/core`, `@energyflow/editor`, `@energyflow/i18n`,
declared in each `vite.config.ts` (`resolve.alias`) and each `tsconfig.json` (`paths`). They are *not*
built or published separately — the bundles compile their TypeScript directly.

## Commands

```bash
npm install          # AT THE ROOT. This is a workspace; see "Why a workspace" below.
npm run build        # previews + both bundles
npm run build-vis    # only src-widgets -> widgets/energyflow/
npm run build-dm     # only src-dm-widgets -> admin/dm-widgets/
npm run build-admin  # only src-admin -> admin/tab.html + admin/tab-assets/
npm run dev          # src-preview on :3100 -- admin tab, widget and attribute editor with hot reload
npm run previews     # re-render the palette preview and the README pictures (light + dark) from the real renderer
npm run gallery      # render every template in both themes to tmp/gallery.html and look at it
npm run check        # tsc over packages/, tasks.ts, tools/, test/
npm run lint
npm test             # mocha: the core unit tests plus the ioBroker package checks
```

`npm run check` does **not** cover the bundles. Type check those with
`cd src-widgets && npx tsc --noEmit -p tsconfig.json` (same for `src-dm-widgets`, `src-admin` and
`src-preview`); they
have their own tsconfig because they need `@iobroker/types` globals and their own `paths`. `npm run
lint` does cover them: the project service resolves each file against its nearest `tsconfig.json`.

## The development preview

`src-preview/` is a dev server and nothing else: not built by `tasks.ts`, not in `files`. It imports the
admin tab's `DiagramManager` straight from `src-admin/src` and the shared packages through the usual
aliases, so it always shows the current sources.

- The admin address is one constant, `ADMIN_URL` in `src-preview/vite.config.ts` (env
  `IOBROKER_ADMIN` overrides it). It reaches the page through `define` (`__ADMIN_HOST__` etc., declared
  in `src/globals.d.ts`) and `index.html` through a `%ADMIN_ORIGIN%` placeholder, because the socket.io
  client must load before any module runs.
- It deliberately avoids port 3000. `@iobroker/socket-client` only guesses "admin is on 8081" on
  3000, and 3000 is where the vis-2 dev server usually runs; the preview passes the address
  explicitly instead and runs on 3100.

## Selection and the keyboard

`EditorSelection` has `node` for one and `nodes` for several (built with `selectNodes`, read with
`selectedNodeIds` in `packages/editor/src/selection.ts`); the inspector shows the single-node panel only
for `node`. In `Canvas.tsx` a press on the empty drawing starts a frame, Shift/Ctrl/⌘+click toggles a
node, and a plain press on one of several selected nodes moves them all -- it narrows the selection to
that node only on release without movement (`clickSelects`), since at the press it may still be a drag.
`moveNodes` shifts the waypoints of connections with both ends in the moved set.

Copy, paste and delete are in `useEditorShortcuts.ts`; the clipboard format is `clipboard.ts` in the
core (`iobroker.energyflow/nodes`, plain JSON text). Two constraints shaped it:

- **Focus decides.** Shortcuts act only while the focus is inside the designer's root element (or on
  the body / the dialog around it) and not in a text field. A press on the canvas focuses the SVG
  (`tabIndex -1`) for exactly this reason. vis-2 has its own Ctrl+C/V for widgets, but only when the
  focus is on `<body>`; the handler also stops propagation of what it handles.
- **Plain http.** ioBroker usually runs without TLS, where `navigator.clipboard` does not exist. Writing
  therefore goes through `execCommand('copy')` and a one-shot `copy` listener, reading through the
  browser's `paste` event. A module-level copy covers browsers that raise no `paste` event outside
  text fields; it is only used when the system clipboard did not receive the copy or no event came.

The shortcuts are disabled while a drag is in progress (`draft !== null`): a paste on top of a draft
would be overwritten by the next pointer move.

Arrow keys move the selected nodes by one grid step, Shift+arrow keys resize them around their centre
(`resizeNodes`; a circle has one size, so either direction changes its diameter). Every key press is
a commit with a `merge` key: presses with the same key within `MERGE_WINDOW_MS` replace the top of the
undo stack instead of pushing, so holding a key is one undo step. Undo, redo, save and any unkeyed
commit end the merge.

## Moving the middle of a line

An `orthogonal` route whose two ends leave in the same orientation has a middle segment (vertical
between two horizontal ends, horizontal between two vertical ones). `edgeGeometry` reports it as
`geometry.segment`, and the canvas puts a drag handle on it: a transparent line above the edge's own
hit area, below the node hit areas. Dragging stores `edge.bend`, the segment's position as a fraction
of the way from the start to the end (`bendAt`), so it keeps its place when a node moves; a double
click or the inspector's button removes it. No segment -- and no handle -- for curves, straight lines,
single-corner routes, waypoint routes, and routes whose ends are level (the segment would have length
zero).

## Fill levels and "same as value"

`NodeRuntime.level` (0..100) is how full a node's body is drawn: the state of charge for a storage
node, otherwise the shown value's amount against `node.levelMax` (in the value's unit, before kW/MW
scaling). The battery icon shows the same level (`IconDefinition.level` swaps its fixed bar for a
fill); other icons ignore it. The clip path of the fill is named with `React.useId()`, never the node
id -- two widgets on one page share node ids, and a clip path is looked up document-wide.

`SrcSame` (`{ same: 'value', ...scaling }`) is a source that refers to the node's own value, as shown
(`resolveSrc`'s third argument). The charge level and the extra values offer it; on the value itself
and on connections it resolves to nothing, so there is no cycle to guard against.

## Rules, status texts, stale values, key figures, colour scales

All in step 3 of `computeRuntime`, with the pure parts in `packages/core/src/rules.ts`:

- **Order matters.** The colour scale (`node.colorScale`, green to red via `scaleColor`) is applied
  first, rules (`node.rules`, first match wins, `firstMatchingRule`) last -- they are the user's word
  over every automatism. A text node's rules compare its raw value; every other node's the number it
  shows. Numbers compare numerically, anything else only with `==` / `!=` as text (`rawText`).
- **Lines follow.** Edges are coloured in step 2, before node values exist; step 3c recolours every
  edge whose colour is inherited (`EdgeRuntime.inheritsColor`) from the final node colours.
- **Status texts** need the raw state value, which the `ValueGetter` (numbers only) does not carry:
  the hosts pass `raw` in the options (`useLiveStates`, and `efTimes[oid].raw` in both widgets).
- **Stale** compares the newest `ts` of the value's states with `now`. The hosts must keep `now`
  moving while anything can turn stale -- `needsClock(config)` says when -- or nothing ever gets old.
- **Key figures** (`node.kpi`) run after all nodes (step 3b): production is the sum of producers that
  no other producer feeds (MPPT strings and the box they feed must not count twice), grid and storage
  are signed as their nodes show them. See `autarky` / `selfConsumption`.
- `parseColorString` understands `hsl()` because the colour scale produces it; without that the tint
  and the muted line colour would fall back to opaque/grey.
- `.ef-blink` is paused with the rest of the animation and off under `prefers-reduced-motion`.

## Detail view, energy of today

The click action `chart` opens `HistoryDialog` (editor package, but imported **by path** from the
widgets, because the package index would pull the designer into their first chunk). It must not
import `@mui/icons-material`: vis-2 does not share it, and one icon costs ~70 kB of MUI internals in
the widget's sync chunk -- the close cross is drawn with the shared `SvgIcon`. `detailTarget` picks the
state (the action's own, else the value's) and the value's rescaling; `readDetail` reads it.

`node.energyToday` integrates the value since local midnight with the history adapter's
`aggregate: 'integral', integralUnit: 3600` (`loadEnergyToday`), shown as Wh -> kWh in the second
line. Host readers spread the request options **after** their defaults, so `integral` survives.

## Picture export and the assistant

`exportImage.ts` clones the designer's `svg.ef-root`, drops what the renderer marks as editor-only
(`.ef-overlay`, `.ef-background`, `.ef-selection`), writes the page font and a background in, and
serialises it; PNG draws that onto a canvas at 2x.

The assistant (`DeviceWizard.tsx`, logic in `packages/core/src/assistant.ts`) scans all states,
keeps those with a power unit (the unit decides over the role -- `value.power.consumption` is used
for kWh meters too), guesses the kind from the **name first**, then the last part of the id, then the
path (`guessDevice` returns a confidence), and pre-ticks only confident guesses up to
`PRESELECT_LIMITS` per kind. `buildFromDevices` binds the states to the lines, not the nodes, and a
"house" consumption state becomes the house node's own value.

## History charts

`node.history` (`15m` ... `24h`) draws the recorded past of the value into the lower part of the body
(`packages/core/src/history.ts`). Only a value that is a plain state has one. The hosts read from the
installation's default history adapter (`system.config` -> `common.defaultHistory`) with
`getHistory(..., { aggregate: 'average', step: period / 60 })`; `loadHistory` caches per page and
decides what is stale (`historyRefreshMs`), the hosts just call it every 30--60 s. The devices card
reaches `getHistory` through the `socket` of its state context, which is `protected` in the typings
only -- without it the card draws no charts. The scale is anchored at zero only when the values come
near it (power), otherwise it is the values' own range (a voltage around 53 V would be a flat line).

## Last change / last update

`node.timestamp` (`lc` or `ts`) shows under the value when its state last changed or was last written;
for a formula the most recent of its states. The hosts keep `{ ts, lc }` per state next to the value
(`useLiveStates` in the editor, `efTimes` in both widgets) and pass them as `times` in the options of
`computeRuntime`, together with `now`. The text is `formatTimestamp` in `format.ts`: `Intl`
(`RelativeTimeFormat`, `toLocaleString`) writes it, so no dictionary entries are needed and every
language comes with its plural rules. A relative time has to advance without a state change, so the
hosts re-render every 30 s while a node shows one (`useClock`, `efClock`).

## Units

`packages/core/src/units.ts`. The unit a number is in comes from, in this order: the element's own
`unit`, the unit of its source's state object (`common.unit`, via `sourceUnit`), the diagram's
default. The same read also caches `common.max` (`cachedMax`, `sourceMax`), which is what a node
fills against when it has no `levelMax` of its own -- converted from the object's unit into the one
the value is shown in, since a meter in kW declares its maximum in kW. `levelMax: 0` is the way to
say "no fill" against a declaring object, so the field keeps a typed 0. The hosts read the objects (`loadUnits` with their `getObject`, cached per page) and pass
`cachedUnit` -- or the editor's `useObjectUnits` -- as `units` in the options of `computeRuntime`.

- A `factor` on a state source, or a formula with `*`, `/`, `^`, `%`, has no object unit: the object's
  unit no longer describes the number.
- **Edge values are converted to the base unit** (`unitScale`: kW -> W times 1000) before anything
  compares or adds them. `EdgeRuntime.value`/`magnitude` and a derived `NodeRuntime.value` are in the
  base unit, so the threshold, the dot speed (`refPower` is watts) and the sums of a node work across
  meters in W and kW. Display converts back (`value / factor`) and lets the auto-scaling pick the
  prefix. The edge `threshold` is therefore in the base unit too.
- A derived node shows the base unit its connections agree on (`commonEdgeUnit`); if they disagree,
  the diagram's default.

## Why a workspace

## Why a workspace

`npm install` must run at the root. `packages/core` and `packages/editor` are compiled *into* both
bundles, so they must resolve the same copy of React, MUI and `@iobroker/gui-components` as the bundle
around them. Without workspace hoisting, TypeScript sees two `@types/react` and rejects every
`ReactNode`, and at runtime a second React means a second context registry. If you ever see
`Two different types with this name exist, but they are unrelated`, a package got duplicated.

## Contracts with the two hosts

These were read out of the host sources; none of them is checked at build time, so breaking one shows
up only as a widget that does not appear.

### vis-2

- `common.visWidgets.energyflowWidgets.url` = `energyflow/customWidgets.js`, and `bundlerType` **must**
  be `"module"` for a Vite build (the opposite of the CRA template).
- Three lists must stay in sync: `exposes` in `src-widgets/vite.config.ts`,
  `common.visWidgets.*.components` in `io-package.json`, and the module file itself.
- `mf-manifest.json` is deliberately published: vis-2 reads it and refuses a widget set that does not
  share `react/jsx-runtime`. Never exclude it from the copy step.
- The shared list comes from `moduleFederationShared()` of `@iobroker/types-vis-2`. Do not hand-write it.
- vis-2 does **not** share `@iobroker/gui-components`, so it is bundled here. That is why
  `src-widgets/src/DiagramField.tsx` is behind `React.lazy` — see "Bundle size" below.

### ioBroker.devices

- Discovery is via the **instance objects**: the backend collects `common.deviceWidgets` from every
  `system.adapter.*` instance (`src/widget-utils/WidgetsManagement.ts` there). An instance must exist.
- `pluginLoader.ts` there loads `./translations` and then `./Components`, and picks the widget out of
  the **default export** of `./Components` by the name in `common.deviceWidgets.components[].name`.
- The settings dialog is a `jsonConfig` form. The designer reaches it as an item of `type: 'custom'`:
  - `url` must start with `./` to escape the adapter-relative default — `./adapter/energyflow/dm-widgets/customDevices.js`;
  - `name` is `<remote alias>/<exposed module>/<exported name>`, here `energyflow/Config/Designer`. The
    alias is `energyflow` on purpose, matching what `pluginLoader.ts` already registered;
  - the exposed module is read as `(await loadRemote(...)).default[<exported name>]` -- by the copy of
    `ConfigCustom` inside the device manager as well as by the current `@iobroker/json-config`. So
    `Config.tsx` **must** have a default export holding the components; with named exports only, the
    dialog shows "Component energyflow/Config/Designer not found ... Found:" and nothing else;
  - `guiApi: 2` declares React 19 / MUI 9. `@iobroker/json-config` also sniffs `mf-manifest.json` and
    refuses a bundle that shares `@iobroker/adapter-react-v5`.
- **The size field is the widget's, if it wants the big one.** The host prepends `size` with 1x1,
  2x1 and 2x1/2 only; `2x2` exists but its own widgets declare it themselves, so `getConfigSchema()`
  repeats the field with the fourth option. The host then dispatches `2x0.5` to `renderWide()`,
  `2x1` to `renderWideTall()` and `2x2` to **`renderHuge()`** -- a method `@iobroker/dm-widgets`
  2.0.1 does not declare yet, so it overrides nothing and has to be written out.
- **A tile is square, and the settings button is part of it.** `renderSettingsButton()` comes from
  the host as an element in the flow: a card that lets it follow the content is 145 x 167 in a grid
  of 145 x 145 tiles, and the button hangs below the frame. The card itself carries the
  `aspectRatio`, the content is absolutely positioned inside it, and the button is laid over the
  bottom edge.
- **The icon of the catalogue entry is resolved against `admin/dm-widgets/`**, not the adapter root:
  `common.deviceWidgets.components[].icon` must name a file that `tasks.ts` copies there.
- **The host does not share React through federation.** Its own bundle shares nothing at all; it
  publishes the instances it renders with on `window.__iobrokerShared__` (`react`, `react-dom`,
  `@mui/material`, `@mui/icons-material`, `@iobroker/gui-components`, `moment`), which is what
  `@iobroker/dm-widgets` means by "Host's React instance -- use this instead of importing 'react'".
  A plugin that just imports `react` gets whatever the shared scope holds, and with a second widget
  plugin on the page that is *its* bundled copy: the hooks then run against a React that is not
  rendering the tree and the widget dies with `Cannot read properties of null (reading 'useContext')`.
  `src-dm-widgets/hostShim.ts` therefore routes `react`, `react-dom`, the JSX runtime and
  `@mui/material` through a shim that prefers the host's instance. The federated module stays the
  fallback, because the same bundle's `./Config` is also loaded by an adapter's configuration page,
  where that global does not exist but the admin *does* register its React as a singleton.
- `getConfigSchema()` is typed against `@iobroker/dm-utils`, not `@iobroker/json-config` — the base
  class in `@iobroker/dm-widgets` uses that copy of the schema types, and the two are unrelated
  declarations to TypeScript.

### Any adapter's admin configuration

`src-dm-widgets/src/Config.tsx` is not devices-specific. An adapter's config page uses the same
`@iobroker/json-config`, so the same `type: 'custom'` item works there (the README has the snippet).
Two consequences for that file:

- **How a value is written back depends on `props.custom`**, exactly as `ConfigGeneric` of
  `@iobroker/json-config` does it: a per-object *custom settings* page takes `onChange(attr, value)`,
  every other form -- an adapter's configuration page and the device manager's widget settings --
  expects the whole `data` object back: `onChange({ ...data, [attr]: value })`. Handed only the
  attribute, those forms store nothing and merely light up the save button; a diagram chosen in the
  device manager fell back to "in this widget" and was gone after saving. The third argument is a
  callback for `oContext.forceUpdate([attr], data)`, without which this item keeps rendering the
  value it was mounted with.
- It **registers its own translations** at module load. The devices plugin loader does it beforehand,
  an adapter's config page does not, and without it the designer renders raw `energyflow_*` keys.
- The `url` must keep its leading `./`. `ConfigCustom` resolves a bare path against *the adapter being
  configured*; only `./` escapes to an absolute one.

## Where a diagram lives

`packages/core/src/storage.ts`. A widget attribute holds **either** a diagram (inline) **or** a
reference `{ "$ref": "energyflow.0.diagrams.<id>" }` to one stored as a state in the adapter's
namespace. The admin tab only ever edits stored ones.

- **States, not objects**, because both hosts already subscribe to states: an edit saved in the admin
  tab reaches every open widget through the same subscription that delivers the readings. The widget's
  `efOnStateChange` routes the reference's id to "parse as diagram, then resync subscriptions" and
  everything else to "number".
- **`readDiagramAttribute()` must be asked before `normalizeConfig()`**, which turns a reference into an
  empty diagram without complaint (a reference has none of a diagram's keys).
- **References are only followed into `energyflow.<n>.diagrams.*`** (`isDiagramId`), so a widget cannot
  be pointed at an arbitrary state and have its value parsed; a stored diagram that is itself a
  reference is refused rather than followed.
- Written with **`ack: true`**: the adapter is web-only, nothing would ever acknowledge the value.
- Renaming changes `common.name` only. The id is what every widget refers to.

The UI for choosing between the two is `DiagramAttribute` in the editor package, used by both hosts
(`src-widgets/src/DiagramField.tsx` and `src-dm-widgets/src/Config.tsx` are thin wrappers). The admin
tab is `src-admin/src/DiagramManager.tsx`, which runs the designer in its `inline` variant: fills the
page, stays open after saving, "discard" remounts it from the stored state. Everything that leaves the
current diagram goes through one `guard()` so unsaved changes are never thrown away silently.

Admin shows the tab of every instance with `common.adminTab`, running or not (the adapter never runs:
`onlyWWW`). It loads `adapter/energyflow/tab.html`; `patchHtmlFile` needs the socket loader's
`var script` to be the first statement of its `<script>`, so keep comments out of it in `index.html`.

## Bundle size

A shared federation module is bundled **as a whole namespace**; rolldown cannot tree-shake something it
has to hand over complete. Two decisions follow, and both have a measured reason:

- `src-dm-widgets/vite.config.ts` narrows `moduleFederationShared()` to a `SINGLETONS` list. Taking it
  as it came put 6.5 MB of fallback copies into `admin/dm-widgets/` — 4.3 MB of it `@mui/icons-material`
  for a dozen icons. Only things that genuinely break as a second copy stay shared.
- Because `@iobroker/gui-components` is therefore bundled, importing *anything* from its barrel in a
  module that the widget loads eagerly drags in all 620 kB of it. `EnergyFlowDm.tsx` gets `I18n` from
  `AdapterReact` in `@iobroker/dm-widgets` (the host's copy) instead, and `DiagramField.tsx` on the
  vis-2 side is lazy for the same reason.

Check after a change: `node -e` over `build/mf-manifest.json`, comparing `exposes[].assets.js.sync`
against `.async`. The vis-2 widget's sync set should stay around 100 kB.

## Design decisions worth not re-litigating

- **The document is a graph, not a drawing.** Edge routes are computed in `geometry.ts` on every
  render; nothing geometric is stored except optional `waypoints`. The predecessor
  (`iobroker.energiefluss-erweitert`) stores finished SVG paths, which is why moving a node there
  breaks every line that touches it.
- **A node with no source of its own derives its value from its connections** (`deriveNodeValue` in
  `runtime.ts`). That is why the classic four-node template needs three state ids and not seven. Which
  sum is the right one depends on the node kind, and the difference only appears once a node has flows
  in both directions: a `source` shows what leaves it (the net would be its conversion loss), a `sink`
  the net of what arrives, `grid`/`storage` the net as an outflow so the sign carries the meaning, a
  `bus` what passes through. The rule is derived twice in the tests for exactly this reason.
- **`icon: undefined` and `icon: ''` mean different things.** Undefined takes the icon of the node
  kind; an empty string means no icon, and the value then centres itself in the node. Collapsing the
  two would make it impossible to remove the icon a kind implies.
- **The icon goes beside the value in a wide box.** `iconPlacement`: from a width-to-height ratio of
  1.4 on (the default rounded box, 124 x 84, is one) the icon sits left and the text is centred in the
  room to its right; circles, squares and tall boxes keep it above. `node.iconPosition` overrides.
- **Label sizes are two settings, one of them relative.** `defaults.labelSize` is the diagram's
  (node labels and connection values; empty means three quarters of `fontSize`), `node.labelScale` a
  factor on it, shown as a percentage. Relative so that "all labels larger" stays one field. Use
  `pageLabelSize` / `nodeLabelSize`, never the numbers directly; `fitCanvas` reserves room below the
  nodes from them.
- **Decimal places follow the unit prefix, not the magnitude** (`defaultDecimals` in `format.ts`).
  Whole watts, two decimals once it is kilowatts — a magnitude rule prints "40,0 W" and "0,00 W", and
  no meter reads like that.
- **An edge with no colour takes the colour of wherever the energy comes from**, which flips with the
  direction. This is what makes a new connection readable without configuring anything.
- **Edge labels show the magnitude, node values show the sign.** A minus next to an arrow reads wrong;
  a battery at −2.1 kW is charging, and that is information worth keeping.
- **The animation is CSS on a second dashed copy of each line**, not JavaScript. `--ef-shift` is one
  gap, so a cycle ends where it started. The host decides *whether* it runs (`animate`) because only
  the host knows about hidden tabs, off-screen widgets and `prefers-reduced-motion`; when it is off,
  an active edge draws a static arrow instead.
- **A style adjusts the host theme, it never replaces it** (`styles.ts`). `styledTheme()` runs first
  in `computeRuntime`, so the colour a node or a muted line is computed with is the one it is drawn
  with; the renderer asks the `DiagramStyle` for decisions (`cards`, `shadow`, `labelInside`, ...),
  never for its name. A new style is an entry there plus a `style_<id>` sentence. `npm run gallery`
  draws every style light and dark -- look at both before calling one done, a shadow that works on
  white can vanish on a dark surface.
- **Glow is three filters, not one** (neon). The lines glow as *one* blurred copy of all active lines
  under them, in `userSpaceOnUse` over the canvas -- a straight line has a zero-height box, and a
  region relative to it would be empty; the copy holds no dots, so the running animation does not
  recompute it. Outlines use a wide halo, icons a narrow one: the wide one fills an icon in to a blob.
  Every filter region relative to a box is `-100%`/`300%`, because a card of 40 units cut off the
  3D shadow with a hard edge at `-40%`.
- **Separate renders need an `identifierPrefix`.** Filter and clip ids come from `React.useId()`,
  which is unique within one React root but restarts at zero in every `renderToStaticMarkup`. The
  gallery renders each card on its own, so it passes a prefix; without it every card draws the
  shadows of the first one.
- **Text fits its box by estimate, not by measurement** (`fitFontSize`). The renderer also runs in
  node for the previews and the gallery, where there is nothing to measure with; the character widths
  are measured once on system-ui, and a value never shrinks below half its size.
- **The core never reads a MUI theme.** Each host flattens its own into `EnergyFlowTheme` once
  (`themeFromMui`). The node accents deliberately do not come from the palette — photovoltaics must not
  turn blue because somebody picked a blue primary colour.
- **`expr.ts` is a hand-written parser, not `new Function`.** A widget configuration is data that
  travels through view exports; and the parser is what makes `null` propagate instead of producing
  `NaN kW`.

## Importing energiefluss-erweitert

`packages/core/src/importEnergiefluss.ts`. The one thing worth knowing before touching it: that format
has **no nodes**. A box is a `rect`, an `icon` and two `text` elements that merely overlap, with nothing
tying them together. The graph, however, is explicit in an unexpected place — a connection is stored
under the key `path_<a>_<b>`, where the two numbers are the element ids of the rectangles it runs
between. The importer therefore takes those rectangles as nodes and assigns every other element to the
box whose rectangle contains its centre, smallest box first.

Semantics taken from `main.js` of that adapter, not guessed:

- `elements[].source` is an **index into `datasources`**, not a state id; `-1` means unbound.
- The value is `source + sum(add) - sum(subtract)`, optionally `abs()` via `convert` — which is why
  anything beyond a bare state becomes a formula here.
- `calculate_kw`: `'auto'` is this widget's auto-scaling, `'calc'`/`true` divides by 1000 and prints
  kW, `'none'`/`false` **blanks the unit** over there (it really does), anything else keeps the
  configured unit. For `'auto'` and `'none'` the import leaves the unit unset, so the state object's
  unit shows; `'none'` keeps the raw number without scaling, and the `unit-blanked` warning says the
  unit now appears.
- An empty unit (`""`) counts as unset everywhere (`||`, not `??`): earlier imports wrote one, and it
  would otherwise hide the object's unit for good.
- `animation_properties` is only `positive` or `negative`; negative means the same reading flows the
  other way, which becomes `invert` on the source.
- Icons are matched by **keyword**, not by exact name (`ICON_PATTERNS`). The original lets the user
  pick from all of Iconify, so an exact lookup table misses most names. Order matters there:
  `electric-car` has to reach `car` before any electricity rule claims it.

`test/fixtures/energiefluss-default.json` is that adapter's own default layout, copied verbatim. It is
the document every user of it starts from, so it is the right regression input; `npm run gallery`
renders the conversion of it next to the templates.

## Files in and out

`packages/core/src/exchange.ts` reads every file and every pasted text, in both places that take one
(the designer's `< >` dialog and the admin tab's import), so a text that works in one works in the other.
`readImport()` tells three shapes apart: a **bundle** (`format: 'iobroker.energyflow/diagrams'`, what
"export all" writes), an **energiefluss-erweitert** configuration (checked before our own format: it
has none of our keys and would otherwise read as an empty diagram), and a **diagram**, which must at
least have a `nodes` array. Anything laxer accepts any JSON file as an empty diagram, which is how a
wrong file silently replaces a real one.

- A single-diagram file is **exactly what a widget stores** -- no name, no wrapper. The name comes from
  the file name (`nameFromFileName`), so the same file pastes into any designer.
- The core returns **codes** (`ImportErrorCode`, `ImportWarning.code` + `args`), never sentences for the
  user; `importErrorText()` and `ImportSummary` in the editor package translate them. Every warning
  code needs a `json_ef_warn_<code>` sentence in `en.json`, with one `%s` per arg -- a test reads the
  union from the source and checks both dictionaries.
- Import only ever **creates** diagrams, one after the other (`createDiagram` looks for a free id, and
  two parallel creations of "PV" would both pick `pv`).
- `downloadText` / `pickFiles` in `fileTransfer.ts` use throw-away elements; `pickFiles` resolves `[]`
  on `cancel` where the browser reports it and simply never settles where it does not.

## Unicode escapes in the sources

Keep backslash-u escapes as escapes. Twice now a tool on the way to the file decoded one into the
literal character: the object-view range end (U+9999) became a CJK ideograph in `storedDiagrams.ts`, and
the combining-mark range (U+0300 to U+036F) in `slugify` became two invisible characters. Both still
worked, which is exactly why they went unnoticed. If a script has to write an escape, build the
backslash with `chr(92)` and check the bytes afterwards.

## Tests

`test/core.test.ts` covers the pure parts, including the documents in `examples/` -- those are shipped
artifacts, so a test keeps them valid, unbound and free of icons that no longer exist.

It also covers the expression language, the unit scaling, the geometry, the direction/colour/derivation
logic in `runtime.ts`, and the document normalisation. Those are the places where a mistake is
invisible in a screenshot — a wrong sign or a unit off by a factor of 1000 looks perfectly fine until
somebody compares the diagram with their meter. Run `npm run gallery` for everything that is not:
it renders every template and every example in both themes into `tmp/gallery.html`.
