/**
 * The symbol the designer shows for a node kind.
 *
 * Not the abstract one of `KIND_ICONS` -- the one a node of that kind really gets in this diagram.
 * In a water diagram a source is a well and a store is a tank, and a list that answers "Quelle" with
 * a sun is telling the user something that is not true. Only the kinds that draw no icon at all (a
 * junction, a caption, an image) fall back to the abstract symbol.
 */
import React from 'react';

import { defaultIcon, renderBuiltinIcon, type FlowConfig, type NodeKind } from '@flow/core';

import { KIND_ICONS } from './optionIcons';

/**
 * @param kind the node kind
 * @param config the diagram, for its medium
 * @param override an icon the node (or the palette entry) names itself
 * @returns an element for a list or a button
 */
export function kindIcon(kind: NodeKind, config: FlowConfig | undefined, override?: string): React.ReactNode {
    const name = override || defaultIcon(kind, config);
    if (!name) {
        return KIND_ICONS[kind];
    }
    // A URL rather than one of the built-in names: shown as the picture it is
    if (name.startsWith('http') || name.startsWith('data:') || name.startsWith('/')) {
        return (
            <img
                src={name}
                alt=""
                width={22}
                height={22}
                style={{ display: 'block', objectFit: 'contain' }}
            />
        );
    }
    return (
        <svg
            viewBox="0 0 40 40"
            width={22}
            height={22}
            style={{ display: 'block' }}
        >
            {renderBuiltinIcon(name, { x: 20, y: 20, size: 34, color: 'currentColor' })}
        </svg>
    );
}
