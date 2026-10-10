# Phase 1: Rules engine and project foundation -- Context

## Phase Goal
Shared pure-TypeScript rules engine for Realm Rush: state types, seeded RNG, map graph, dice movement, tile effects, combat math, items/shops, calendar, boss and win condition, with vitest tests and a headless full-game simulation.

## Requirements Covered
- REQ-03
- REQ-04
- REQ-06
- REQ-08
- REQ-10

## What Already Exists (from prior phases)
- Repository is empty apart from .planning/; greenfield

## Key Design Decisions
- Single npm package, TypeScript strict, ESM, vitest; engine in src/engine/ with no Node or DOM imports so server and client can share it
- Engine is deterministic: all randomness through a seeded mulberry32 RNG whose state lives in GameState
- Public API: createGame(config), applyAction(state, action) => {state, events}; state is plain JSON (serialisable) and never mutated in place
- 4 classes (knight, mage, rogue, cleric), 3 equipment slots (weapon, armor, charm) plus consumables
- Calendar: 7 days per week, 4 weeks; boss tile unlocks in week 4; game ends when boss is defeated or week 4 day 7 ends; winner = most gold plus town value plus boss bonus (assumed)
- Original names and content only; no Dokapon assets or terms

## Plan Structure
- **Plan 01-01 (Wave 1)**: Project scaffold, core types and seeded RNG -- Create the npm/TypeScript/vitest scaffold and the shared engine type definitions plus a deterministic RNG that every later plan builds on.
- **Plan 01-02 (Wave 2)**: Map graph, movement, tile effects and calendar -- Provide the default branching board map, dice movement with path choices, tile resolution outcomes and the day/week calendar with town income.
- **Plan 01-03 (Wave 2)**: Content data, combat math and shops -- Define the original classes, monsters, items and boss, and implement battle resolution (monster and player), leveling, loot and the shop/inventory operations with tuned numbers.
- **Plan 01-04 (Wave 3)**: Game reducer and headless full-game simulation -- Wire movement, combat, inventory and calendar into createGame/applyAction and prove a bot-driven headless game completes.
