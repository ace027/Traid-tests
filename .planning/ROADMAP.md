# Realm Rush — Roadmap

## Phases

- [x] Phase 1: Rules engine and project foundation (3 plans)
- [ ] Phase 2: Multiplayer server and lobby (3 plans)
- [ ] Phase 3: Browser client (4 plans)
- [ ] Phase 4: Polish and playtest (2 plans)

## Phase Details

### Phase 1: Rules engine and project foundation
**Goal**: Shared pure-TypeScript rules engine: state types, map graph, dice movement, tile effects, combat math, items, calendar and tests.
**Requirements**: REQ-03, REQ-04, REQ-06, REQ-08, REQ-10
**Recommended Agents**: engineering-backend-architect, testing-qa-verification-specialist
**Success Criteria**:
- [ ] npm test passes for engine
- [ ] A scripted game can be simulated headless through a full week and boss
**Plans**: 3

### Phase 2: Multiplayer server and lobby
**Goal**: Authoritative WebSocket server with rooms, join codes, seats, reconnect, turn validation, and PvP/town rules wired to the engine.
**Requirements**: REQ-01, REQ-02, REQ-05, REQ-07
**Recommended Agents**: engineering-backend-architect, testing-api-tester
**Success Criteria**:
- [ ] Protocol tests with multiple simulated clients complete a game
- [ ] Reconnect restores seat
**Plans**: 3

### Phase 3: Browser client
**Goal**: Canvas/DOM client: lobby, board map, dice, combat screen, shop and inventory UI, town and PvP views, original placeholder art and animation.
**Requirements**: REQ-09, REQ-01
**Recommended Agents**: engineering-frontend-developer, design-ui-designer
**Success Criteria**:
- [ ] Vite build succeeds
- [ ] Two browser tabs can play a full game end to end
**Plans**: 4

### Phase 4: Polish and playtest
**Goal**: Balance tuning, end-to-end browser test, one-command run script, README for hosting with a tunnel.
**Requirements**: REQ-10
**Recommended Agents**: testing-qa-verification-specialist, engineering-frontend-developer
**Success Criteria**:
- [ ] Playwright e2e plays a 2-player game to the end
- [ ] npm start runs server and client
**Plans**: 2

## Progress

| Phase | Plans | Completed | Status |
|-------|-------|-----------|--------|
| 1 | 4 | 4 | Complete |
| 2 | 3 | 2 | In Progress |
| 3 | 4 | 0 | Pending |
| 4 | 2 | 0 | Pending |
