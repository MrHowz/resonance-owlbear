import type { Track } from './model';
export function sampleTracks(): Track[] {
  const data: [string, string, Track['kind'], string[]][] = [
    ['The Amber Archive', 'archive', 'music', ['exploration', 'mysterious']],
    ['A Quiet Place', 'quiet', 'music', ['rest', 'peaceful']],
    ['Into the Unknown', 'unknown', 'music', ['exploration', 'dark']],
    ['Last Light', 'lastlight', 'music', ['combat', 'tense']],
    ['Rain on the Rooftops', 'rain', 'ambience', ['weather', 'rain']],
    ['Whispering Woods', 'woods', 'ambience', ['nature', 'forest']],
    ['Distant Thunder', 'thunder', 'sfx', ['weather', 'impact']],
    ['A Little Magic', 'magic', 'sfx', ['spell', 'magic']],
  ];
  return data.map(([title, file, kind, tags], i) => ({
    id: `sample-${file}`,
    title,
    url: new URL(`/audio/${file}.wav`, location.origin).href,
    tags: ['demo', ...tags],
    kind,
    favorite: i === 0 || i === 4,
  }));
}
