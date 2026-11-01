import Constants from 'expo-constants';
import { createTransitousClient, transitousUserAgent } from './transitous';

/**
 * App-wide Transitous client. The User-Agent carries only the app name, the public app version
 * and the public repository URL, as the Transitous API policy requires; no device or user data.
 * Kept out of `index.ts` so fixture tests can import the client without Expo runtime modules.
 */
export const transitous = createTransitousClient({ userAgent: transitousUserAgent(Constants.expoConfig?.version) });
