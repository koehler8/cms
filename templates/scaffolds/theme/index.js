import manifest from './theme.config.js';
// Side-effect import (not `?inline`): @koehler8/cms >= 1.0.0-beta.8 bundles
// theme.css as a sync <link rel="stylesheet">, applied during the initial
// paint instead of injected via JS after Vue hydrates.
import './theme.css';

export default { manifest };
export { manifest };
