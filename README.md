# Realm Rush

An original board-game RPG inspired by the classic genre: roam a map, fight monsters, trade, and capture towns. Built for private use with friends.

## Requirements

- Node 20 or newer

## Run

```
npm install
npm start
```

The game is served from one port, 8787 by default. Set `PORT` to change it (for example `PORT=9000 npm start`).

For development (client and server with reload): `npm run dev:all`.

Tests: `npm test` for unit tests, `npm run e2e` for browser tests.

## Play with friends

- Same network (LAN): friends open `http://<your-ip>:8787`.
- Over the internet: start a tunnel, then share its URL.
  - `cloudflared tunnel --url http://localhost:8787`
  - or `ngrok http 8787`

Share the tunnel URL first, then the room code shown in the lobby.

## Rules in brief

- Each player picks a class and takes turns rolling to move around the board.
- Land on tiles to fight monsters, shop, visit towns, or collect gold.
- Battles are turn based: attack, defend, use a skill or item, or flee.
- Towns can be captured and upgraded; they add to your score.
- When the calendar runs out, the highest score (gold plus town value) wins. Ties are shared.
