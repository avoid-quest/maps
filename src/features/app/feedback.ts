import { useCallback, useState } from 'react';
import { Linking } from 'react-native';
import { openExternalLink, openInOtherApp } from './external-link';
import type { Place } from '../../domain/types';
import { createFeatureContext } from './feature-context';

export interface AppFeedback {
  /** The latest app-level failure, separate from location status. */
  message: string;
  report(message: string): void;
  dismiss(): void;
  /** Opens web and telephone links only, reporting failures in Italian. */
  openLink(url: string): Promise<void>;
  /** Offers a place to the other map apps on the device through Android's geo: intent. */
  openInOtherApp(place: Pick<Place, 'name' | 'coordinate'>): Promise<void>;
}

export function useAppFeedback(): AppFeedback {
  const [message, setMessage] = useState('');
  const dismiss = useCallback(() => setMessage(''), []);
  const openLink = useCallback((url: string) => openExternalLink(url, target => Linking.openURL(target), setMessage), []);
  const handOff = useCallback((place: Pick<Place, 'name' | 'coordinate'>) => openInOtherApp(place, target => Linking.openURL(target), setMessage), []);
  return { message, report: setMessage, dismiss, openLink, openInOtherApp: handOff };
}

export const [FeedbackProvider, useFeedback] = createFeatureContext<AppFeedback>('Feedback');
