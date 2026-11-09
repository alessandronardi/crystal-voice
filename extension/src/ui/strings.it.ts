// Centralised Italian UI strings (AGENTS.md §8, §9). Never inline UI text.
export const strings = {
  appName: 'VoiceCrystal',
  pages: {
    sidepanel: { title: 'VoiceCrystal', heading: 'VoiceCrystal' },
    collection: { title: 'Collezione · VoiceCrystal', heading: 'Collezione' },
    permission: { title: 'Microfono · VoiceCrystal', heading: 'Autorizzazione del microfono' },
  },
  placeholder: 'In costruzione.',
} as const;

export type PageKey = keyof typeof strings.pages;
