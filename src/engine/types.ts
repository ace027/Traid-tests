export interface Stats {
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  spd: number;
  luck: number;
}

export type ClassId = 'knight' | 'mage' | 'rogue' | 'cleric';
export type Slot = 'weapon' | 'armor' | 'charm';

export interface Item {
  id: string;
  name: string;
  kind: 'equipment' | 'consumable';
  slot?: Slot;
  price: number;
  mods: Partial<Stats>;
  effect?: 'heal' | 'boost-atk' | 'warp';
}

export interface Monster {
  id: string;
  name: string;
  tier: 1 | 2 | 3 | 4;
  stats: Stats;
  goldReward: number;
  drops: string[];
}

export type TileKind =
  | 'start'
  | 'plain'
  | 'monster'
  | 'shop'
  | 'town'
  | 'event'
  | 'heal'
  | 'boss';

export interface Tile {
  id: string;
  kind: TileKind;
  x: number;
  y: number;
  next: string[];
}

export interface Player {
  id: string;
  name: string;
  classId: ClassId;
  stats: Stats;
  gold: number;
  tileId: string;
  inventory: string[];
  equipment: Partial<Record<Slot, string>>;
  level: number;
  xp: number;
  defeated: boolean;
}

export interface Town {
  tileId: string;
  ownerId: string | null;
  /** 1..3 */
  level: number;
  income: number;
}

export type Phase =
  | 'roll'
  | 'choose-path'
  | 'tile-resolve'
  | 'battle'
  | 'shop'
  | 'town'
  | 'end-turn'
  | 'game-over';

export interface BattleState {
  attackerId: string;
  defender: { kind: 'monster' | 'player'; id: string };
  monsterHp?: number;
  round: number;
}

export interface GameState {
  seed: number;
  rngState: number;
  players: Player[];
  turnIndex: number;
  day: number;
  week: number;
  phase: Phase;
  tiles: Record<string, Tile>;
  towns: Record<string, Town>;
  pendingMoves: number;
  battle: BattleState | null;
  log: string[];
  winnerId: string | null;
}

export type Action =
  | { type: 'roll' }
  | { type: 'choosePath'; tileId: string }
  | {
      type: 'battleAction';
      action: 'attack' | 'defend' | 'skill' | 'item' | 'flee';
      itemId?: string;
    }
  | { type: 'buy'; itemId: string }
  | { type: 'sell'; itemId: string }
  | { type: 'useItem'; itemId: string }
  | { type: 'equip'; itemId: string }
  | { type: 'leaveShop' }
  | { type: 'upgradeTown' }
  | { type: 'captureTown' }
  | { type: 'leaveTown' }
  | { type: 'endTurn' };

export type GameEvent = { type: string; [k: string]: unknown };
