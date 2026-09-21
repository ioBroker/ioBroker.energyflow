# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## What this repository is

An ioBroker adapter of type `visualization-widgets` (`onlyWWW: true`, `mode: none`) that ships **no
Node.js runtime code**. It delivers one diagram in two places:

- a **vis-2 widget set** (`src-widgets/` → `widgets/energyflow/`), loaded by vis-2 through Vite module
  federation, declared in `io-package.json` under `common.visWidgets.energyflowWidgets`;
- a **ioBroker.devices plugin** (`src-dm-widgets/` → `admin/dm-widgets/`), loaded by the widget
  manager of ioBroker.devices, declared under `common.deviceWidgets`.

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
npm run previews     # re-render widgets/.../img/prev_energyflow.svg from the real renderer
npm run gallery      # render every template in both themes to tmp/gallery.html and look at it
npm run check        # tsc over packages/, tasks.ts, tools/, test/
npm run lint
npm test             # mocha: the core unit tests plus the ioBroker package checks
```

`npm run check` does **not** cover the bundles. Type check those with
`cd src-widgets && npx tsc --noEmit -p tsconfig.json` (same for `src-dm-widgets`); they have their own
tsconfig because they need `@iobroker/types` globals and their own `paths`.

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
  - `guiApi: 2` declares React 19 / MUI 9. `@iobroker/json-config` also sniffs `mf-manifest.json` and
    refuses a bundle that shares `@iobroker/adapter-react-v5`.
- `getConfigSchema()` is typed against `@iobroker/dm-utils`, not `@iobroker/json-config` — the base
  class in `@iobroker/dm-widgets` uses that copy of the schema types, and the two are unrelated
  declarations to TypeScript.

### Any adapter's admin configuration

`src-dm-widgets/src/Config.tsx` is not devices-specific. An adapter's config page uses the same
`@iobroker/json-config`, so the same `type: 'custom'` item works there (the README has the snippet).
Two consequences for that file:

- It **registers its own translations** at module load. The devices plugin loader does it beforehand,
  an adapter's config page does not, and without it the designer renders raw `energyflow_*` keys.
- The `url` must keep its leading `./`. `ConfigCustom` resolves a bare path against *the adapter being
  configured*; only `./` escapes to an absolute one.

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
  kW, `'none'`/`false` **blanks the unit** (it really does; the `unit-blanked` warning exists because
  that surprises people), anything else keeps the configured unit.
- `animation_properties` is only `positive` or `negative`; negative means the same reading flows the
  other way, which becomes `invert` on the source.
- Icons are matched by **keyword**, not by exact name (`ICON_PATTERNS`). The original lets the user
  pick from all of Iconify, so an exact lookup table misses most names. Order matters there:
  `electric-car` has to reach `car` before any electricity rule claims it.

`test/fixtures/energiefluss-default.json` is that adapter's own default layout, copied verbatim. It is
the document every user of it starts from, so it is the right regression input; `npm run gallery`
renders the conversion of it next to the templates.

## Tests

`test/core.test.ts` covers the pure parts, including the documents in `examples/` -- those are shipped
artifacts, so a test keeps them valid, unbound and free of icons that no longer exist.

It also covers the expression language, the unit scaling, the geometry, the direction/colour/derivation
logic in `runtime.ts`, and the document normalisation. Those are the places where a mistake is
invisible in a screenshot — a wrong sign or a unit off by a factor of 1000 looks perfectly fine until
somebody compares the diagram with their meter. Run `npm run gallery` for everything that is not:
it renders every template and every example in both themes into `tmp/gallery.html`.
