import packageJsonRaw from '../../package.json?raw';

const packageJson = JSON.parse(packageJsonRaw);

const envVersion = import.meta?.env?.VITE_APP_VERSION;

export const APP_VERSION = (typeof envVersion === 'string' && envVersion.trim())
  ? envVersion.trim()
  : packageJson?.version || '0.0.0';
