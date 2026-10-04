import type { GameFormatId } from './formats';

/**
 * Equipo y plantilla (hito M3, docs/02 §tablas `team` y `player`). Tipos puros:
 * sin React, sin SQLite. El MVP tiene un único equipo por instalación.
 */
export type DisplayNameMode = 'full' | 'first_initial' | 'first';

export interface Team {
  id: string;
  name: string;
  category: string | null;
  defaultFormat: GameFormatId;
  /** Dibujo por defecto de los titulares ('3-1-2'…); null = el de referencia del formato. */
  defaultFormation: string | null;
  periodsCount: number;
  periodDurationMs: number;
  displayNameMode: DisplayNameMode;
  createdAt: number;
  updatedAt: number;
}

export interface Player {
  id: string;
  teamId: string;
  firstName: string;
  lastName: string | null;
  shirtNumber: number | null;
  isGoalkeeper: boolean;
  /** Inactivo = sigue en la plantilla pero no cuenta para convocatorias ni titulares por defecto. */
  isActive: boolean;
  /** Foto: data URI (JPEG pequeño) o URI de archivo local. Solo puede existir con `photoConsent`. */
  photoUri: string | null;
  photoConsent: boolean;
  /** Orden manual en la plantilla (0..n-1). Es también el orden de convocatoria y de titulares por defecto. */
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  /** Eliminado (anonimizado): no se lista ni se convoca, pero sus minutos pasados siguen en la timeline. */
  deletedAt: number | null;
}

/** Lo que edita el entrenador en la ficha del jugador (P3). */
export type PlayerDraft = Pick<Player, 'firstName' | 'lastName' | 'shirtNumber' | 'isGoalkeeper' | 'isActive' | 'photoUri' | 'photoConsent'>;

/** Lo que edita en la pantalla Equipo (P4). */
export type TeamDraft = Pick<Team, 'name' | 'category' | 'defaultFormat' | 'defaultFormation' | 'periodsCount' | 'periodDurationMs' | 'displayNameMode'>;

/**
 * Proyección de un jugador para las pantallas de partido (ficha): nombre ya
 * resuelto según `displayNameMode`, dorsal (0 si no tiene) y foto opcional.
 * Es la misma forma que usa el equipo de prueba y el paquete de equipo.
 */
export interface PlayerInfo {
  id: string;
  name: string;
  number: number;
  isGoalkeeper?: boolean;
  photoUri?: string;
}
