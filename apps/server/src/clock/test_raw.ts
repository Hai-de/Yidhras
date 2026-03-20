import { ChronosEngine } from './engine.js';
import { CalendarConfig } from './types.js';

const testCalendars: CalendarConfig[] = [
  {
    id: 'earth_legacy',
    name: '地球旧历',
    tick_rate: 1000,
    units: [
      { name: 'second', ratio: 1 },
      { name: 'minute', ratio: 60 },
      { name: 'hour', ratio: 60 },
      { name: 'day', ratio: 24 },
      { name: 'month', ratio: 0, irregular_ratios: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] },
      { name: 'year', ratio: 12 }
    ]
  }
];

const engine = new ChronosEngine(testCalendars, 1_000_000_000_000n);

const printRaw = (label: string) => {
  console.log(`${label}: ${engine.getTicks().toString()}`);
};

printRaw('initial');
engine.tick(1n);
printRaw('after +1');
engine.tick(59n);
printRaw('after +59');
engine.tick(3_600n);
printRaw('after +3600');
engine.tick(86_400n);
printRaw('after +86400');

console.log('raw clock test finished');
