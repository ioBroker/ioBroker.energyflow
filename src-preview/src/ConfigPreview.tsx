/**
 * The attribute editor as vis-2, ioBroker.devices and an adapter's configuration page show it, next to
 * the value it would store -- which is the part a host actually sees and the easiest one to get wrong.
 */
import React from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';

import { DiagramAttribute, usePersistentState, type EditorContext } from '@energyflow/editor';

export function ConfigPreview(props: { context: EditorContext; instance: number }): React.JSX.Element {
    const { context, instance } = props;
    // Kept per browser, so the attribute survives a reload the way a saved widget would
    const [value, setValue] = usePersistentState<{ attribute: unknown }>('energyflow.preview.attribute', {
        attribute: null,
    });

    return (
        <Stack
            direction="row"
            spacing={3}
            sx={{ height: '100%', p: 2, overflow: 'hidden' }}
        >
            <Box sx={{ width: 380, flexShrink: 0, overflowY: 'auto' }}>
                <Typography
                    variant="overline"
                    color="text.secondary"
                >
                    Attribute editor
                </Typography>
                <DiagramAttribute
                    value={value.attribute}
                    onChange={attribute => setValue({ attribute })}
                    context={context}
                    instance={instance}
                />
            </Box>
            <Stack sx={{ flex: 1, minWidth: 0 }}>
                <Stack
                    direction="row"
                    sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                >
                    <Typography
                        variant="overline"
                        color="text.secondary"
                    >
                        Stored value
                    </Typography>
                    <Button
                        size="small"
                        onClick={() => setValue({ attribute: null })}
                    >
                        Reset
                    </Button>
                </Stack>
                <Box
                    component="pre"
                    sx={{
                        flex: 1,
                        m: 0,
                        p: 1.5,
                        overflow: 'auto',
                        fontSize: 12,
                        borderRadius: 1,
                        border: theme => `1px solid ${theme.palette.divider}`,
                    }}
                >
                    {JSON.stringify(value.attribute, null, 2)}
                </Box>
            </Stack>
        </Stack>
    );
}
