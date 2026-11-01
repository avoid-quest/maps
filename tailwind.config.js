// Semantic colours resolve through CSS variables supplied by src/theme/ThemeProvider.tsx
// (light fallbacks live in global.css). Names must match src/theme/palette.ts; palette.test.ts checks this.
const semantic = name => `rgb(var(--color-${name}) / <alpha-value>)`;
const roles = [
  'surface', 'surface-raised', 'surface-muted', 'divider',
  'action', 'on-action', 'action-subtle',
  'caution', 'caution-subtle', 'danger', 'danger-subtle', 'success', 'success-subtle',
  'live', 'scheduled', 'stale', 'cancelled',
];

module.exports = {
  content: ['./App.tsx', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: Object.fromEntries(roles.map(name => [name, semantic(name)])),
      // Text-only roles: `text-primary`, `text-secondary` (no bg-primary).
      textColor: { primary: semantic('text-primary'), secondary: semantic('text-secondary') },
    },
  },
  plugins: [],
};
