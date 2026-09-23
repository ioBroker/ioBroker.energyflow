/**
 * React and MUI from the host of a device manager widget.
 *
 * ioBroker.devices does not hand its React to a plugin through module federation -- its own bundle
 * shares nothing at all. It publishes the instances it renders with on a global instead:
 *
 * ```js
 * window.__iobrokerShared__ = { react, 'react-dom', '@mui/material', '@mui/icons-material', ... }
 * ```
 *
 * and `@iobroker/dm-widgets` says as much in its typings ("Host's React instance -- use this instead
 * of importing 'react' directly in plugins"). A plugin that imports `react` normally gets whichever
 * copy the shared scope happens to hold -- in a page with two widget plugins that is the *other*
 * adapter's bundled fallback. Its hooks then run against a React that is not rendering the tree, and
 * the widget dies with `Cannot read properties of null (reading 'useContext')`.
 *
 * So every import of `react`, `react-dom`, the JSX runtime and `@mui/material` in this bundle is
 * routed through a small module that prefers the host's instance and falls back to the federated one.
 * The fallback matters: the same bundle's `./Config` is loaded by `@iobroker/json-config` in an
 * adapter's configuration page, where that global does not exist but the admin *does* register its
 * React as a federation singleton (see `ConfigCustom.js` there).
 *
 * The export lists are read from the real packages at build time, so nothing has to be kept in sync
 * by hand.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** The global the device manager publishes its instances on */
const GLOBAL = '__iobrokerShared__';

/** Module ids that are routed through a shim, and the key of the host instance they belong to */
const HOSTED: Record<string, string> = {
    react: 'react',
    'react-dom': 'react-dom',
    '@mui/material': '@mui/material',
};

/** The JSX runtimes: the host publishes no runtime, so it is built from its `createElement` */
const JSX_RUNTIMES = ['react/jsx-runtime', 'react/jsx-dev-runtime'];

const PREFIX = '\0ef-host:';

/**
 * The names a package exports, as its CommonJS build reports them.
 *
 * @param id the package
 * @returns every export that can be re-exported by name
 */
function exportNames(id: string): string[] {
    const module = require(id) as Record<string, unknown>;
    return Object.keys(module).filter(name => name !== 'default' && /^[A-Za-z_$][\w$]*$/.test(name));
}

/**
 * The shim for a package: the host's instance if the page has one, else the federated module.
 *
 * @param id the package
 * @returns the module source
 */
function shimSource(id: string): string {
    const names = exportNames(id);
    return [
        `import * as federated from ${JSON.stringify(id)};`,
        `const host = typeof globalThis !== 'undefined' && globalThis.${GLOBAL} && globalThis.${GLOBAL}[${JSON.stringify(id)}];`,
        `const impl = host || federated;`,
        `export default impl.default !== undefined ? impl.default : impl;`,
        ...names.map(name => `export const ${name} = impl.${name};`),
    ].join('\n');
}

/**
 * The shim for a JSX runtime. `jsx(type, props, key)` is `createElement` with the children taken out
 * of the props again -- the compiler put them there, and `createElement` expects them as arguments.
 *
 * @param id `react/jsx-runtime` or `react/jsx-dev-runtime`
 * @returns the module source
 */
function jsxSource(id: string): string {
    return [
        `import * as federated from ${JSON.stringify(id)};`,
        `const host = typeof globalThis !== 'undefined' && globalThis.${GLOBAL} && globalThis.${GLOBAL}.react;`,
        `const build = react => (type, props, key) => {`,
        `    const { children, ...rest } = props || {};`,
        `    const own = key === undefined ? rest : { ...rest, key };`,
        `    return children === undefined ? react.createElement(type, own) : react.createElement(type, own, children);`,
        `};`,
        `const jsxOfHost = host ? build(host) : undefined;`,
        `export const Fragment = host ? host.Fragment : federated.Fragment;`,
        `export const jsx = jsxOfHost || federated.jsx;`,
        `export const jsxs = jsxOfHost || federated.jsxs;`,
        `export const jsxDEV = jsxOfHost || federated.jsxDEV || federated.jsx;`,
        // The federation fallback imports a default from the runtime, which the real one does not have
        `export default federated.default !== undefined ? federated.default : federated;`,
    ].join('\n');
}

/**
 * The Vite plugin. It resolves the hosted ids to virtual modules -- except when the shim itself
 * imports them, which is what keeps the federated module reachable as the fallback.
 *
 * @returns the plugin
 */
export function hostShim(): {
    name: string;
    enforce: 'pre';
    resolveId: (source: string, importer?: string) => string | null;
    load: (id: string) => string | null;
} {
    const ids = [...Object.keys(HOSTED), ...JSX_RUNTIMES];
    return {
        name: 'energyflow-host-shim',
        enforce: 'pre',
        resolveId(source: string, importer?: string): string | null {
            // Not from the shim itself -- there the import has to reach the federated module, which
            // is the fallback -- and not from federation's own modules, whose copy *is* that fallback
            const internal =
                importer?.startsWith(PREFIX) ||
                importer?.includes('virtual:mf:') ||
                importer?.includes('__mfe_internal__');
            if (!ids.includes(source) || internal) {
                return null;
            }
            return `${PREFIX}${source}`;
        },
        load(id: string): string | null {
            if (!id.startsWith(PREFIX)) {
                return null;
            }
            const source = id.slice(PREFIX.length);
            return JSX_RUNTIMES.includes(source) ? jsxSource(source) : shimSource(HOSTED[source]);
        },
    };
}
