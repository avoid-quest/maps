import type { IconName } from '../../ui';

/** Category shortcuts offered inside the empty search interaction. */
export const SEARCH_CATEGORIES: { label: string; query: string; icon: IconName }[] = [
  { label: 'Negozi', query: 'negozi', icon: 'bag-handle-outline' },
  { label: 'Farmacie', query: 'farmacie', icon: 'medical-outline' },
  { label: 'Supermercati', query: 'supermercato', icon: 'basket-outline' },
  { label: 'Ristoranti', query: 'ristoranti', icon: 'restaurant-outline' },
  { label: 'Caffè e bar', query: 'bar', icon: 'cafe-outline' },
];
export const categoryTitle = (category: string) => SEARCH_CATEGORIES.find(item => item.query === category)?.label;
