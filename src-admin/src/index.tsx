import React from 'react';
import { createRoot } from 'react-dom/client';

import '@iobroker/gui-components/index.css';
import App from './App';

declare global {
    interface Window {
        adapterName: string | undefined;
    }
}

window.adapterName = 'energyflow';

const container = document.getElementById('root');
if (container) {
    createRoot(container).render(<App />);
}
