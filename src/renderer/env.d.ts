/// <reference types="vite/client" />
import type { AuraApi } from '../shared/api';

declare global {
  interface Window {
    aura: AuraApi;
  }
}

export {};
