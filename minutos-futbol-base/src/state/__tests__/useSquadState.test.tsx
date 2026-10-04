import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { createSquadService, type SquadService, type SquadServiceDeps } from '../../app-services/squadService';
import type { Player, Team, TeamDraft } from '../../core/team';
import { useSquadState } from '../useSquadState';

// El tipo del repositorio llega a través del servicio: `state` no importa de `db` ni para tipos.
type SquadRepository = SquadServiceDeps['repo'];

/**
 * El hook refleja el estado del servicio y se repinta en cada notificación.
 * El repositorio es un doble mínimo en memoria: `state` no puede importar de
 * `db` (fronteras) y aquí solo hace falta que las escrituras se confirmen.
 * Nombres inventados.
 */

function stubRepository(): SquadRepository {
  let team: Team | null = null;
  const players = new Map<string, Player>();
  return {
    getTeam: async () => team,
    saveTeam: async (t) => {
      team = t;
    },
    listPlayers: async (teamId) => [...players.values()].filter((p) => p.teamId === teamId && p.deletedAt === null),
    getPlayer: async (id) => players.get(id) ?? null,
    savePlayer: async (p) => {
      players.set(p.id, p);
    },
    savePlayers: async (list) => {
      for (const p of list) players.set(p.id, p);
    },
  };
}

const TEAM_DRAFT: TeamDraft = {
  name: 'CD Prueba',
  category: null,
  defaultFormat: 'F7',
  defaultFormation: null,
  periodsCount: 2,
  periodDurationMs: 25 * 60_000,
  displayNameMode: 'full',
};

function makeService(): SquadService {
  let n = 0;
  return createSquadService({ repo: stubRepository(), now: () => 1_700_000_000_000, newId: () => `id-${++n}` });
}

function Probe({ service }: { service: SquadService }) {
  const state = useSquadState(service);
  const players = state.players.map((p) => p.firstName).join(',');
  return <Text testID="squad">{`${state.status}:${state.team?.name ?? '-'}:${players}`}</Text>;
}

describe('useSquadState', () => {
  it('muestra el estado inicial y se actualiza con cada cambio del servicio', async () => {
    const service = makeService();
    const screen = await render(<Probe service={service} />);
    expect(screen.getByTestId('squad')).toHaveTextContent('loading:-:');

    await act(async () => {
      await service.load();
    });
    expect(screen.getByTestId('squad')).toHaveTextContent('ready:-:');

    await act(async () => {
      await service.createTeam(TEAM_DRAFT);
      await service.addPlayer({
        firstName: 'Ana',
        lastName: null,
        shirtNumber: 1,
        isGoalkeeper: true,
        isActive: true,
        photoUri: null,
        photoConsent: false,
      });
    });
    expect(screen.getByTestId('squad')).toHaveTextContent('ready:CD Prueba:Ana');
    await screen.unmount();
  });

  it('al cambiar de servicio se suscribe al nuevo y suelta el anterior', async () => {
    const first = makeService();
    const second = makeService();
    await second.load();
    await second.createTeam({ ...TEAM_DRAFT, name: 'CD Segundo' });

    const screen = await render(<Probe service={first} />);
    expect(screen.getByTestId('squad')).toHaveTextContent('loading:-:');

    await screen.rerender(<Probe service={second} />);
    expect(screen.getByTestId('squad')).toHaveTextContent('ready:CD Segundo:');

    // El primero ya no repinta la pantalla.
    await act(async () => {
      await first.load();
    });
    expect(screen.getByTestId('squad')).toHaveTextContent('ready:CD Segundo:');
    await screen.unmount();
  });
});
