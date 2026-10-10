import type { GameState, Player } from './types';

export const DAYS_PER_WEEK = 7;
export const LAST_WEEK = 4;
export const TOWN_SCORE = 150;

export function computeScore(state: GameState, playerId: string): number {
  const p = state.players.find((x) => x.id === playerId);
  if (!p) return 0;
  let score = p.gold;
  for (const t of Object.values(state.towns)) {
    if (t.ownerId === playerId) score += TOWN_SCORE * t.level;
  }
  return score;
}

/** Highest score wins; ties go to the lowest player index. */
export function determineWinner(state: GameState): string | null {
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const p of state.players) {
    const sc = computeScore(state, p.id);
    if (sc > bestScore) {
      best = p.id;
      bestScore = sc;
    }
  }
  return best;
}

function gameOver(state: GameState): GameState {
  return {
    ...state,
    phase: 'game-over',
    battle: null,
    pendingMoves: 0,
    winnerId: determineWinner(state),
  };
}

/** Single source of truth for the start tile: the tile of kind 'start'. */
export function getStartTileId(tiles: GameState['tiles']): string {
  const t = Object.values(tiles).find((tile) => tile.kind === 'start');
  if (!t) throw new Error('Map has no start tile');
  return t.id;
}

function respawn(p: Player, tiles: GameState['tiles']): Player {
  if (!p.defeated) return p;
  const startTileId = getStartTileId(tiles);
  return {
    ...p,
    defeated: false,
    tileId: startTileId,
    stats: { ...p.stats, hp: Math.max(1, Math.ceil(p.stats.maxHp / 2)) },
  };
}

function endOfDay(state: GameState): GameState {
  const players = state.players.map((p) => ({ ...p }));
  for (const t of Object.values(state.towns)) {
    if (t.ownerId === null) continue;
    const owner = players.find((p) => p.id === t.ownerId);
    if (owner) owner.gold += t.income * t.level;
  }
  let day = state.day + 1;
  let week = state.week;
  if (day > DAYS_PER_WEEK) {
    week += 1;
    day = 1;
  }
  return { ...state, players: players.map((p) => respawn(p, state.tiles)), day, week };
}

/**
 * Pass the turn to the next player (skipping defeated ones). When the order
 * wraps, the day ends: towns pay income, defeated players respawn, the
 * calendar advances. Game ends after week 4 or when the boss is defeated.
 */
export function advanceTurn(
  state: GameState,
  opts: { bossDefeated?: boolean } = {},
): GameState {
  if (state.phase === 'game-over' || state.players.length === 0) return state;
  if (opts.bossDefeated) return gameOver(state);

  let s: GameState = { ...state, battle: null, pendingMoves: 0 };
  let idx = s.turnIndex;
  for (;;) {
    idx += 1;
    if (idx >= s.players.length) {
      s = endOfDay(s);
      if (s.week > LAST_WEEK) return gameOver(s);
      idx = 0;
    }
    if (!s.players[idx].defeated) break;
  }
  return { ...s, turnIndex: idx, phase: 'roll' };
}

export function isBossEnabled(state: GameState): boolean {
  return state.week === LAST_WEEK;
}
