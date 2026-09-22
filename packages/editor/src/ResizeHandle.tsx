/**
 * The strip between two panels that changes the width of one of them.
 *
 * It reports widths, not deltas: every move is computed from the width the drag started with, so the
 * panel does not drift when the pointer crosses the clamp and comes back. Pointer capture keeps the
 * drag alive when the pointer leaves the thin strip, which it does on the first fast move.
 */
import React from 'react';
import { Box, Tooltip } from '@mui/material';

export interface ResizeHandleProps {
    /** Current width of the panel this handle resizes */
    width: number;
    onChange: (width: number) => void;
    /**
     * Which side of the handle the panel is on. `left`: the panel is left of it and grows when the
     * handle moves right. `right`: the panel is right of it and grows when the handle moves left.
     */
    panel: 'left' | 'right';
    min: number;
    max: number;
    /** Width a double click returns to */
    defaultWidth: number;
    tooltip?: string;
}

export function ResizeHandle(props: ResizeHandleProps): React.JSX.Element {
    const { width, onChange, panel, min, max, defaultWidth, tooltip } = props;
    const drag = React.useRef<{ startX: number; startWidth: number } | null>(null);
    const [active, setActive] = React.useState(false);
    /**
     * The tooltip is driven by hand. Left to MUI, it opens on hover and never closes after a drag: the
     * pointer capture swallows the "leave" event it waits for, and the hint stays on screen until the
     * next time the pointer happens to cross the strip. A finished drag therefore just drops it.
     */
    const [hover, setHover] = React.useState(false);
    /**
     * `enterDelay` of the tooltip only works while MUI drives it, so the delay is kept here: the hint
     * is for someone who stops on the strip, not for every pointer that crosses it on the way.
     */
    const hoverTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const endHover = (): void => {
        if (hoverTimer.current) {
            clearTimeout(hoverTimer.current);
            hoverTimer.current = null;
        }
        setHover(false);
    };

    // A pending timer must not fire into an unmounted handle -- hiding the panel unmounts it
    React.useEffect(
        () => () => {
            if (hoverTimer.current) {
                clearTimeout(hoverTimer.current);
            }
        },
        [],
    );

    const clamp = (value: number): number => Math.round(Math.min(Math.max(value, min), max));

    const handle = (
        <Box
            role="separator"
            aria-orientation="vertical"
            aria-valuenow={width}
            aria-valuemin={min}
            aria-valuemax={max}
            onPointerEnter={() => {
                if (!drag.current && !hoverTimer.current) {
                    hoverTimer.current = setTimeout(() => {
                        hoverTimer.current = null;
                        setHover(true);
                    }, 800);
                }
            }}
            onPointerLeave={endHover}
            onPointerDown={event => {
                // Only the primary button; a right click must not start a drag it can never end
                if (event.button !== 0) {
                    return;
                }
                endHover();
                event.preventDefault();
                try {
                    event.currentTarget.setPointerCapture(event.pointerId);
                } catch {
                    // The pointer can already be gone -- a touch that was cancelled before the handler
                    // ran. The drag still works without capture, it just ends when the pointer leaves
                }
                drag.current = { startX: event.clientX, startWidth: width };
                setActive(true);
            }}
            onPointerMove={event => {
                if (!drag.current) {
                    return;
                }
                const dx = event.clientX - drag.current.startX;
                onChange(clamp(drag.current.startWidth + (panel === 'left' ? dx : -dx)));
            }}
            onPointerUp={event => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                }
                drag.current = null;
                setActive(false);
                endHover();
            }}
            onPointerCancel={() => {
                drag.current = null;
                setActive(false);
                endHover();
            }}
            onDoubleClick={() => onChange(clamp(defaultWidth))}
            sx={{
                // A 7px target around a 1px line: easy to hit, invisible until needed
                width: 7,
                flexShrink: 0,
                cursor: 'col-resize',
                position: 'relative',
                zIndex: 1,
                // Overlap the neighbours by 3px each, so the strip costs no layout width
                mx: '-3px',
                touchAction: 'none',
                '&::after': {
                    content: '""',
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: 3,
                    width: active ? 3 : 1,
                    ml: active ? '-1px' : 0,
                    backgroundColor: theme => (active ? theme.palette.primary.main : theme.palette.divider),
                    transition: 'background-color 120ms',
                },
                '&:hover::after': {
                    width: 3,
                    ml: '-1px',
                    backgroundColor: theme => theme.palette.primary.main,
                },
            }}
        />
    );

    return tooltip ? (
        <Tooltip
            title={tooltip}
            placement={panel === 'left' ? 'right' : 'left'}
            // Next to the pointer: the strip is as tall as the page, and its middle can be far away
            followCursor
            open={hover && !active}
        >
            {handle}
        </Tooltip>
    ) : (
        handle
    );
}

export default ResizeHandle;
