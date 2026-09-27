# Firebase (online rooms)

Online play goes through a Firebase **Realtime Database** on the free Spark plan. The game talks to it with
the plain REST API (no SDK, no API key): rooms at `rooms/<hash of the room code>`, a nearby-games list at
`lobby/<hash of the Wi-Fi's public address>`. Everything stored is AES-GCM ciphertext.

## Set up (once)
1. https://console.firebase.google.com → **Create a project** (e.g. `pooket-tabks`). Google Analytics: off.
2. **Build → Realtime Database → Create Database**. Pick a location near the players; start in **locked mode**.
3. **Rules** tab → replace everything with the contents of `database.rules.json` → **Publish**.
4. **Data** tab → copy the database URL at the top (`https://<name>-default-rtdb.<region>.firebasedatabase.app`)
   into `FIREBASE_DATABASE_URL` in `src/net/config.ts`.

## Limits (Spark)
1 GB stored, 10 GB/month downloaded, 100 simultaneous connections. A match is a few MB of traffic and
leaves almost nothing behind (read messages are deleted; the host clears the room when it closes).
