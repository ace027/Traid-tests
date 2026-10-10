import type { Action, GameEvent, GameState, Player, Stats } from './types';
import { nextFloat } from './rng';
import { CLASSES } from './data/classes';
import { BOSS_ID, getMonster, monsterXp } from './data/monsters';
import { applyConsumable } from './inventory';

export type BattleAction = Extract<Action, { type: 'battleAction' }>;

export interface BattleResult {
  state: GameState;
  events: GameEvent[];
}

export const CRIT_MULT = 1.5;
export const KNIGHT_SKILL_MULT = 1.8;
export const CLERIC_HEAL_RATE = 0.35;
export const ROGUE_STEAL_RATE = 0.1;
export const PVP_WIN_GOLD_RATE = 0.2;
export const PVP_LOSS_GOLD_RATE = 0.3;
export const MONSTER_LOSS_GOLD_RATE = 0.2;
export const BASE_DROP_CHANCE = 0.25;

function clone(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

function findPlayer(state: GameState, id: string): Player | undefined {
  return state.players.find((p) => p.id === id);
}

// ---------- pure math helpers (exported for tests and UI previews) ----------

/** Raw damage: max(1, atk*variance*mult - def/2), def ignored when ignoreDef. Crits multiply by 1.5. */
export function computeDamage(
  atk: number,
  def: number,
  variance: number,
  opts: { mult?: number; ignoreDef?: boolean; crit?: boolean } = {},
): number {
  const mult = opts.mult ?? 1;
  let dmg = atk * variance * mult - (opts.ignoreDef ? 0 : def / 2);
  if (opts.crit) dmg *= CRIT_MULT;
  return Math.max(1, Math.round(dmg));
}

/** Damage after the defend action: halved, never below 1. */
export function defendedDamage(dmg: number): number {
  return Math.max(1, Math.round(dmg / 2));
}

export function fleeChance(runnerSpd: number, chaserSpd: number): number {
  const p = 0.4 + (runnerSpd - chaserSpd) * 0.02;
  return Math.min(0.9, Math.max(0.1, p));
}

export function critChance(luck: number): number {
  return luck * 0.01;
}

export function xpToNextLevel(level: number): number {
  return 100 * level;
}

export function pvpXp(loser: Player): number {
  return 30 + 20 * loser.level;
}

/** Grant xp and apply any level-ups (class growth) in place. Returns level-up events. */
export function grantXp(player: Player, xp: number): GameEvent[] {
  const events: GameEvent[] = [];
  player.xp += xp;
  const growth = CLASSES[player.classId].growth;
  while (player.xp >= xpToNextLevel(player.level)) {
    player.xp -= xpToNextLevel(player.level);
    player.level += 1;
    for (const k of Object.keys(growth) as (keyof Stats)[]) {
      player.stats[k] += growth[k] ?? 0;
    }
    player.stats.hp = Math.min(player.stats.hp, player.stats.maxHp);
    events.push({ type: 'level-up', playerId: player.id, level: player.level });
  }
  return events;
}

// ---------- battle start ----------

export function startMonsterBattle(state: GameState, playerId: string, monsterId: string): GameState {
  const player = findPlayer(state, playerId);
  if (!player) throw new Error(`Unknown player ${playerId}`);
  if (player.defeated) throw new Error(`${player.name} is defeated and cannot fight`);
  const monster = getMonster(monsterId);
  if (!monster) throw new Error(`Unknown monster ${monsterId}`);
  if (state.battle) throw new Error('A battle is already in progress');
  if (state.phase === 'game-over') throw new Error('The game is over');
  const next = clone(state);
  next.battle = {
    attackerId: playerId,
    defender: { kind: 'monster', id: monsterId },
    monsterHp: monster.stats.maxHp,
    round: 1,
  };
  next.phase = 'battle';
  next.log.push(`${player.name} encounters ${monster.name}!`);
  return next;
}

export function startPlayerBattle(state: GameState, attackerId: string, defenderId: string): GameState {
  if (attackerId === defenderId) throw new Error('A player cannot battle themselves');
  const a = findPlayer(state, attackerId);
  const d = findPlayer(state, defenderId);
  if (!a) throw new Error(`Unknown player ${attackerId}`);
  if (!d) throw new Error(`Unknown player ${defenderId}`);
  if (a.defeated) throw new Error(`${a.name} is defeated and cannot fight`);
  if (d.defeated) throw new Error(`${d.name} is already defeated`);
  if (state.battle) throw new Error('A battle is already in progress');
  if (state.phase === 'game-over') throw new Error('The game is over');
  const next = clone(state);
  next.battle = { attackerId, defender: { kind: 'player', id: defenderId }, round: 1 };
  next.phase = 'battle';
  next.log.push(`${a.name} challenges ${d.name}!`);
  return next;
}

// ---------- battle resolution ----------

interface Fighter {
  id: string;
  name: string;
  stats: Stats;
  getHp(): number;
  setHp(v: number): void;
}

export function resolveBattleAction(state: GameState, action: BattleAction): BattleResult {
  if (!state.battle || state.phase !== 'battle') throw new Error('No battle in progress');
  const next = clone(state);
  const battle = next.battle!;
  const events: GameEvent[] = [];
  let rng = next.rngState;
  const roll = (): number => {
    const [v, s] = nextFloat(rng);
    rng = s;
    return v;
  };

  const actor = findPlayer(next, battle.attackerId);
  if (!actor) throw new Error(`Unknown player ${battle.attackerId}`);
  const actorF: Fighter = {
    id: actor.id,
    name: actor.name,
    stats: actor.stats,
    getHp: () => actor.stats.hp,
    setHp: (v) => (actor.stats.hp = v),
  };

  let enemyF: Fighter;
  let enemyPlayer: Player | undefined;
  if (battle.defender.kind === 'monster') {
    const m = getMonster(battle.defender.id);
    if (!m) throw new Error(`Unknown monster ${battle.defender.id}`);
    if (battle.monsterHp === undefined) battle.monsterHp = m.stats.maxHp;
    enemyF = {
      id: m.id,
      name: m.name,
      stats: m.stats,
      getHp: () => battle.monsterHp!,
      setHp: (v) => (battle.monsterHp = v),
    };
  } else {
    const ep = findPlayer(next, battle.defender.id);
    if (!ep) throw new Error(`Unknown player ${battle.defender.id}`);
    enemyPlayer = ep;
    enemyF = {
      id: ep.id,
      name: ep.name,
      stats: ep.stats,
      getHp: () => ep.stats.hp,
      setHp: (v) => (ep.stats.hp = v),
    };
  }

  const strike = (
    from: Fighter,
    to: Fighter,
    opts: { mult?: number; ignoreDef?: boolean; halved?: boolean; label?: string } = {},
  ): void => {
    const variance = 0.9 + roll() * 0.2;
    const crit = roll() < critChance(from.stats.luck);
    let dmg = computeDamage(from.stats.atk, to.stats.def, variance, { ...opts, crit });
    if (opts.halved) dmg = defendedDamage(dmg);
    to.setHp(Math.max(0, to.getHp() - dmg));
    events.push({ type: 'damage', source: from.id, target: to.id, amount: dmg, crit, label: opts.label ?? 'attack' });
    next.log.push(`${from.name} hits ${to.name} for ${dmg}${crit ? ' (critical)' : ''}`);
  };

  let defending = false;
  let lootMult = 1;

  switch (action.action) {
    case 'attack':
      strike(actorF, enemyF);
      break;
    case 'defend':
      defending = true;
      events.push({ type: 'defend', playerId: actor.id });
      next.log.push(`${actor.name} braces for impact`);
      break;
    case 'skill': {
      const skill = CLASSES[actor.classId].skill.name;
      switch (actor.classId) {
        case 'knight':
          strike(actorF, enemyF, { mult: KNIGHT_SKILL_MULT, label: skill });
          break;
        case 'mage':
          strike(actorF, enemyF, { ignoreDef: true, label: skill });
          break;
        case 'rogue':
          strike(actorF, enemyF, { label: skill });
          if (enemyPlayer) {
            const stolen = Math.floor(enemyPlayer.gold * ROGUE_STEAL_RATE);
            enemyPlayer.gold -= stolen;
            actor.gold += stolen;
            events.push({ type: 'steal', from: enemyPlayer.id, to: actor.id, amount: stolen });
            next.log.push(`${actor.name} pilfers ${stolen} gold from ${enemyPlayer.name}`);
          } else {
            lootMult = 2;
          }
          break;
        case 'cleric': {
          const heal = Math.min(
            Math.floor(actor.stats.maxHp * CLERIC_HEAL_RATE),
            actor.stats.maxHp - actor.stats.hp,
          );
          actor.stats.hp += heal;
          events.push({ type: 'heal', playerId: actor.id, amount: heal, label: skill });
          next.log.push(`${actor.name} casts ${skill} and recovers ${heal} HP`);
          break;
        }
      }
      break;
    }
    case 'item': {
      if (!action.itemId) throw new Error('No item specified');
      const err = applyConsumable(next, actor.id, action.itemId);
      if (err) throw new Error(err);
      events.push({ type: 'item', playerId: actor.id, itemId: action.itemId });
      break;
    }
    case 'flee': {
      const chance = fleeChance(actor.stats.spd, enemyF.stats.spd);
      if (roll() < chance) {
        events.push({ type: 'battle-end', result: 'fled', playerId: actor.id });
        next.log.push(`${actor.name} escapes from ${enemyF.name}`);
        next.battle = null;
        next.phase = 'end-turn';
        next.rngState = rng;
        return { state: next, events };
      }
      events.push({ type: 'flee-failed', playerId: actor.id });
      next.log.push(`${actor.name} fails to escape`);
      break;
    }
    default:
      throw new Error('Unknown battle action');
  }

  if (enemyF.getHp() <= 0) {
    finishBattle(next, actor, enemyPlayer, true, lootMult, roll, events);
  } else {
    strike(enemyF, actorF, { halved: defending });
    if (actorF.getHp() <= 0) {
      finishBattle(next, actor, enemyPlayer, false, 1, roll, events);
    } else {
      battle.round += 1;
    }
  }
  next.rngState = rng;
  return { state: next, events };
}

function finishBattle(
  next: GameState,
  actor: Player,
  enemyPlayer: Player | undefined,
  actorWon: boolean,
  lootMult: number,
  roll: () => number,
  events: GameEvent[],
): void {
  const battle = next.battle!;
  next.battle = null;
  next.phase = 'end-turn';

  if (!enemyPlayer) {
    const m = getMonster(battle.defender.id)!;
    if (actorWon) {
      const gold = m.goldReward * lootMult;
      const xp = monsterXp(m);
      actor.gold += gold;
      events.push({ type: 'battle-end', result: 'win', winnerId: actor.id, loserId: m.id, gold, xp });
      next.log.push(`${actor.name} defeats ${m.name} and gains ${gold} gold, ${xp} XP`);
      if (m.drops.length > 0 && roll() < BASE_DROP_CHANCE * lootMult) {
        const itemId = m.drops[Math.floor(roll() * m.drops.length)];
        actor.inventory.push(itemId);
        events.push({ type: 'loot', playerId: actor.id, itemId });
        next.log.push(`${actor.name} finds ${itemId}`);
      }
      events.push(...grantXp(actor, xp));
      if (m.id === BOSS_ID) {
        next.phase = 'game-over';
        next.winnerId = actor.id;
        events.push({ type: 'boss-defeated', playerId: actor.id });
        next.log.push(`${actor.name} has slain the ${m.name}!`);
      }
    } else {
      const lost = Math.floor(actor.gold * MONSTER_LOSS_GOLD_RATE);
      actor.gold -= lost;
      actor.stats.hp = 0;
      actor.defeated = true;
      events.push({ type: 'battle-end', result: 'loss', winnerId: m.id, loserId: actor.id, goldLost: lost });
      next.log.push(`${actor.name} falls to ${m.name} and drops ${lost} gold`);
    }
    return;
  }

  const winner = actorWon ? actor : enemyPlayer;
  const loser = actorWon ? enemyPlayer : actor;
  const transfer = Math.floor(loser.gold * PVP_WIN_GOLD_RATE);
  const lost = Math.floor(loser.gold * PVP_LOSS_GOLD_RATE);
  loser.gold -= lost;
  winner.gold += transfer;
  loser.stats.hp = 0;
  loser.defeated = true;
  const xp = pvpXp(loser);
  events.push({ type: 'battle-end', result: actorWon ? 'win' : 'loss', winnerId: winner.id, loserId: loser.id, gold: transfer, goldLost: lost, xp });
  next.log.push(`${winner.name} defeats ${loser.name} and takes ${transfer} gold`);
  events.push(...grantXp(winner, xp));
}
