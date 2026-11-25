# Navi – Voice-guided 3D Indoor Navigation

Navi guides visitors through a building. A visitor speaks or types where they want to go (e.g. "Take me to the Conference hall") and Navi shows the route as a 3D walk-through with spoken directions, in English or Chichewa.

The project has two parts:

- **Visitor app** – public voice and 3D wayfinding interface.
- **Admin app (ODeL NavAdmin)** – protected area where administrators build the map (floors, nodes, connections, rooms, viewpoints) and publish it.

Built with Next.js 16, React 19, Three.js and [Convex](https://convex.dev). A sample building model is included at `public/floor/ODeL_Building.glb`.

## Requirements

- Node.js 20.9 or newer (`node -v`) and npm
- Git (only if you clone the repository)
- A modern browser with WebGL (Chrome or Edge recommended); microphone for voice, camera for the QR page
- Accounts / API keys:
  - **Convex** (convex.dev) – free account, database and backend
  - **Groq** (groq.com) – API key, language model
  - **Deepgram** (deepgram.com) – API key, speech-to-text
  - **ElevenLabs** (elevenlabs.io) – *optional*, API key and Voice ID for a Malawian-accent voice

## Installation

### 1. Get the code and install dependencies

```bash
git clone https://github.com/indoor-navi/navi.git
cd navi
npm install
```

### 2. Create the Convex backend

```bash
npx convex dev
```

Log in when the browser opens and create a new project. Convex uploads the functions in `convex/` and writes `NEXT_PUBLIC_CONVEX_URL` to `.env.local`. Leave this terminal running and open a second one.

### 3. Configure environment variables

**Web app** – add to `.env.local` in the project root (restart the app after any change):

```env
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
NEXT_PUBLIC_GROQ_API_KEY=your_groq_key
NEXT_PUBLIC_DEEPGRAM_API_KEY=your_deepgram_key

# Optional – natural voice
ELEVENLABS_API_KEY=your_elevenlabs_key
ELEVENLABS_VOICE_ID=your_voice_id
```

**Backend (Convex)** – set these in Convex, *not* in `.env.local`:

```bash
npx convex env set ADMIN_EMAIL "you@example.com"
npx convex env set ADMIN_PASSWORD "a-long-one-time-password-16+"
```

- `ADMIN_EMAIL` is optional (default: `admin@navi.local`).
- `ADMIN_PASSWORD` is required and must be at least 16 characters.

### 4. Create the first administrator

```bash
npx convex run seed:seedAdmin
```

`created: true` means success; `created: false` means an administrator already exists. To change the seeded password later, update `ADMIN_PASSWORD` and run:

```bash
npx convex run seed:rotateSeededAdminPassword
```

### 5. Start the app

```bash
npm run dev
```

Or run `npm run dev:all` to start Convex and the web app together (also reachable from other devices on your network).

| Address | Page |
| --- | --- |
| http://localhost:3000 | Visitor app |
| http://localhost:3000/admin/login | Admin sign-in |
| http://localhost:3000/admin | Admin dashboard |
| http://localhost:3000/directions | 3D walk-through |
| http://localhost:3000/continue | QR-code scanner |

## Build and publish your first map

A new database is empty, so visitors see no destinations until a map is published.

1. Sign in at `/admin/login` with `ADMIN_EMAIL` and `ADMIN_PASSWORD` (sessions last 24 hours).
2. Open **Building Maps**, choose the building and floor, and add a **Main Entrance** node. Every route starts there.
3. Place nodes along corridors, junctions, stairs and doors, and connect neighbours so all nodes form one network.
4. Add rooms (with optional aliases) so visitors can ask for them by name.
5. Test a route, make every item on the **Dashboard** health checklist green, then click **Publish**.

Extra users (admin, editor, viewer) can be added under **Manage Settings**.

## Deployment

1. Deploy the backend: `npx convex deploy`. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` on the production deployment, then run `npx convex run seed:seedAdmin --prod`.
2. Deploy the web app to Vercel (or run `npm run build` and `npm run start`) with the same environment variables, using the production `NEXT_PUBLIC_CONVEX_URL`.
3. Serve over **HTTPS** – browsers only allow microphone and camera access on HTTPS or localhost.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "NEXT_PUBLIC_CONVEX_URL is not set" or page stuck on Loading | Run `npx convex dev` (keep it running) and restart `npm run dev`. |
| `seedAdmin` says "Set ADMIN_PASSWORD…" or cannot sign in | Set a 16+ character `ADMIN_PASSWORD` in the same Convex deployment; use the exact `ADMIN_EMAIL`; run `rotateSeededAdminPassword` if forgotten. |
| No destinations, or "No route" in the editor | Add rooms and Publish; connect disconnected nodes and add a Main Entrance. |
| Microphone or AI not working | Allow the microphone, use HTTPS or localhost, check the Deepgram and Groq keys. |
| "Malawian voice is not configured" | Set both ElevenLabs variables and restart (optional feature). |
| Black 3D scene / install fails / port 3000 busy | Enable WebGL; update Node.js to 20.9+ and reinstall; run `npx next dev -p 3001`. |

## Security notes

- `NEXT_PUBLIC_` variables (including the Groq and Deepgram keys) are visible to anyone who opens the app. Use usage-limited keys and rotate them if leaked.
- Keep `ADMIN_PASSWORD` secret. After first sign-in, create a personal admin account and optionally remove the seeded one.
- Never commit `.env.local` to Git.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the web app |
| `npm run dev:all` | Start Convex and the web app together |
| `npm run build` / `npm run start` | Build and run for production |
| `npm run lint` | Lint the code |
