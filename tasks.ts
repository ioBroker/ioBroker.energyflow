/*!
 * Build tasks for ioBroker.energyflow.
 *
 * Two bundles come out of one repository, each going to a place its host looks in:
 *
 * - `src-widgets/` -> `widgets/energyflow/`, declared in `io-package.json` as
 *   `common.visWidgets.energyflowWidgets.url`. This is what vis-2 loads.
 * - `src-dm-widgets/` -> `admin/dm-widgets/`, declared as `common.deviceWidgets.url`. This is what
 *   `pluginLoader.ts` of ioBroker.devices loads, and what `@iobroker/json-config` fetches the
 *   designer from.
 *
 * Executed with `tsx` (see the scripts in package.json), so this file is type checked by the root
 * tsconfig like the rest of the sources.
 *
 * There is no npm-install step per bundle: this is an npm workspace, so a single `npm install` at the
 * root installs both and hoists the shared copies of react, MUI and `@iobroker/gui-components` -- which
 * it *must*, because `packages/core` and `packages/editor` are compiled into both bundles and would
 * otherwise see a different React than the bundle around them.
 */
import { buildReact, copyFiles, deleteFoldersRecursive } from '@iobroker/build-tools';
import { existsSync, rmSync } from 'node:fs';

const VIS_SRC = 'src-widgets/';
const DM_SRC = 'src-dm-widgets/';

/** Where vis-2 expects the widget set; must match `common.visWidgets.*.url` */
const VIS_DEST = 'widgets/energyflow/';

/** Where ioBroker.devices expects the plugin; must match `common.deviceWidgets.url` */
const DM_DEST = 'admin/dm-widgets/';

/**
 * Remove one bundle's build and its published copy.
 *
 * Every build has to start from an empty destination, the single-bundle ones included: Vite names its
 * chunks by content hash, so a rebuild writes *new* files next to the old ones instead of over them,
 * and the stale chunks would be published with the next release.
 */
function cleanBundle(src: string, dest: string): void {
    deleteFoldersRecursive(`${__dirname}/${src}build`);
    deleteFoldersRecursive(`${__dirname}/${dest}`);
}

function clean(): void {
    cleanBundle(VIS_SRC, VIS_DEST);
    cleanBundle(DM_SRC, DM_DEST);
    deleteFoldersRecursive(`${__dirname}/widgets`);
}

/** Render the palette previews with the real renderer, so they cannot go stale */
async function previews(): Promise<void> {
    // Imported rather than spawned, so a failure is an exception here and not a silent non-zero exit
    await import('./tools/generatePreviews');
}

function compile(src: string): Promise<void> {
    return buildReact(`${__dirname}/${src}`, { rootDir: __dirname, vite: true });
}

/**
 * Copy a Vite build to where its host reads it.
 *
 * `mf-manifest.json` is deliberately **not** excluded from either: vis-2 reads it to decide whether a
 * widget set may be loaded at all (it checks that `react/jsx-runtime` is shared), and
 * `@iobroker/json-config` reads it to decide whether the designer may run (it checks which component
 * library the bundle was built against). Dropping it silently disables the thing it describes.
 */
function copyBuild(src: string, dest: string): void {
    copyFiles(
        [
            `${src}build/**/*`,
            // Entry page of the stand-alone dev server, not part of the published bundle
            `!${src}build/index.html`,
            // Statistics of the federation build; only `mf-manifest.json` is needed at runtime
            `!${src}build/mf-stats.json`,
            `!${src}build/*.ssr.js`,
        ],
        dest,
    );
}

function copyVis(): void {
    copyBuild(VIS_SRC, VIS_DEST);
    // The standalone dictionary next to the widgets. vis-2 loads the translations through the
    // federated `./translations` module, but the files are small and having them as plain JSON is what
    // lets `translate-adapter` and a human reviewer see what the set actually ships.
    copyFiles(['packages/i18n/src/*.json'], `${VIS_DEST}i18n`);
}

function copyDm(): void {
    copyBuild(DM_SRC, DM_DEST);
    // The icon `common.deviceWidgets.components[].icon` points at, resolved by the device manager
    // relative to `admin/dm-widgets/`
    copyFiles(['admin/energyflow.svg'], DM_DEST);
}

function fail(what: string, error: unknown): never {
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
    console.error(`Cannot ${what}: ${message}`);
    process.exit(2);
}

async function main(): Promise<void> {
    const argv = process.argv;

    if (argv.includes('--clean')) {
        clean();
        return;
    }
    if (argv.includes('--previews')) {
        await previews();
        return;
    }
    if (argv.includes('--vis')) {
        cleanBundle(VIS_SRC, VIS_DEST);
        await compile(VIS_SRC);
        copyVis();
        return;
    }
    if (argv.includes('--dm')) {
        cleanBundle(DM_SRC, DM_DEST);
        await compile(DM_SRC);
        copyDm();
        return;
    }

    clean();
    await previews();
    await compile(VIS_SRC);
    copyVis();
    await compile(DM_SRC);
    copyDm();

    // A missing bundle would only show up when somebody installs the adapter, so check it here
    for (const file of [`${VIS_DEST}customWidgets.js`, `${DM_DEST}customDevices.js`]) {
        if (!existsSync(`${__dirname}/${file}`)) {
            fail('build', new Error(`${file} was not produced`));
        }
    }
    // `copyFiles` creates the destination even for patterns that match nothing; drop an empty leftover
    // rather than publishing a directory that suggests there is something in it
    for (const folder of [`${VIS_DEST}_socket`, `${DM_DEST}_socket`]) {
        rmSync(`${__dirname}/${folder}`, { recursive: true, force: true });
    }

    console.log(`Built ${VIS_DEST} and ${DM_DEST}`);
}

main().catch((error: unknown) => fail('build', error));
