import { checkInvariants } from '../invariants';
import { EventFactory, STARTERS, T0, run, typicalMatch } from './helpers';

describe('checkInvariants', () => {
  it('no encuentra nada en estados generados por el reducer', () => {
    const { events } = typicalMatch();
    for (let n = 0; n <= events.length; n++) expect(checkInvariants(run(events.slice(0, n)))).toEqual([]);
  });

  it('detecta estados corruptos (los que la comprobación al abrir un partido debe avisar)', () => {
    const ev = new EventFactory();
    const running = run([ev.lineup(T0, STARTERS), ev.start(T0)]);
    const lucas = running.intervals.find((i) => i.playerId === 'lucas');
    if (!lucas) throw new Error('falta el intervalo de lucas');

    const twoOpen = { ...running, intervals: [...running.intervals, { ...lucas }] };
    expect(checkInvariants(twoOpen).join(' ')).toMatch(/lucas tiene 2 intervalos abiertos/);

    const benchWithOpenInterval = {
      ...running,
      players: { ...running.players, lucas: { ...running.players.lucas!, location: 'BENCH' as const, position: null } },
    };
    expect(checkInvariants(benchWithOpenInterval).join(' ')).toMatch(/lucas está en BENCH pero tiene intervalo abierto/);

    const twoSegments = { ...running, clockSegments: [...running.clockSegments, { period: 1, startedAt: T0, endedAt: null }] };
    expect(checkInvariants(twoSegments).join(' ')).toMatch(/2 segmentos de reloj abiertos/);

    const pausedWithOpenClock = { ...running, status: 'PAUSED' as const };
    expect(checkInvariants(pausedWithOpenClock).join(' ')).toMatch(/Estado PAUSED con 1 segmentos/);

    const finishedOpen = { ...running, status: 'FINISHED' as const, endReason: 'NORMAL' as const };
    expect(checkInvariants(finishedOpen).join(' ')).toMatch(/finalizado con 7 intervalos y 1 segmentos abiertos/);

    const overflow = { ...running, config: { ...running.config, playersOnField: 6 } };
    expect(checkInvariants(overflow).join(' ')).toMatch(/Hay 7 jugadores en el campo y el máximo es 6/);
  });
});
