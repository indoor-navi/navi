<div align="center">

# 🧭 Navi

### Voice-guided 3D indoor navigation

**📖 Installation Guide**

<br>

![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Three.js](https://img.shields.io/badge/Three.js-3D-049EF4?style=for-the-badge&logo=threedotjs&logoColor=white)
![Convex](https://img.shields.io/badge/Convex-Backend-F3694C?style=for-the-badge)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)

<br>

[✨ Features](#-features) · [📋 Requirements](#-requirements) · [🚀 Installation](#-installation) · [🗺️ First Map](#️-build-your-first-map) · [☁️ Deploy](#️-deployment) · [🛠️ Troubleshooting](#️-troubleshooting)

</div>

---

## ✨ Features

| 🎙️ Voice assistant | 🏢 3D walk-through | 🛠️ Admin studio |
| :--- | :--- | :--- |
| Speak or type *"Take me to the Conference hall"* and get spoken directions. | Follow the route inside a 3D model of the building, with spoken directions. | **ODeL NavAdmin**: build floors, nodes, rooms and viewpoints, then publish. |

- 📱 **Visitor app**: public wayfinding on phones, tablets and kiosks
- 🔐 **Admin app**: protected, with roles (`admin`, `editor`, `viewer`) and an audit log
- 📷 **QR continue**: scan QR markers in the building to resume a route
- 🏛️ **Sample model** included: `public/floor/ODeL_Building.glb`

---

## 📋 Requirements

**On your computer**

- 🟢 **Node.js 20.9+** and npm (check with `node -v`)
- 🔀 **Git** (only if you clone the repository)
- 🌐 A modern browser with **WebGL** (Chrome or Edge recommended). Microphone for voice, camera for the QR page.

**Accounts and API keys**

| Service | Used for | Required |
| :--- | :--- | :---: |
| 🟠 [**Convex**](https://convex.dev) | Database, backend, sessions, storage | ✅ |
| 🟣 [**Groq**](https://groq.com) | AI that understands requests and rewrites directions | ✅ |
| 🔵 [**Deepgram**](https://deepgram.com) | Speech-to-text | ✅ |
| 🟡 [**ElevenLabs**](https://elevenlabs.io) | Natural Malawian-accent voice (API key + Voice ID) | ➖ optional |

---

## 🚀 Installation

### 1️⃣ Get the code

```bash
git clone https://github.com/indoor-navi/navi.git
cd navi
npm install
```

### 2️⃣ Create the Convex backend

```bash
npx convex dev
```

Log in when the browser opens and create a new project. Convex uploads the functions in `convex/` and writes `NEXT_PUBLIC_CONVEX_URL` to `.env.local`.

> [!TIP]
> Leave this terminal running and open a second one for the next steps.

### 3️⃣ Configure environment variables

Create a file named `.env.local` in the project root with **all** of the following:

```env
# ── Convex (added automatically by `npx convex dev`) ──
CONVEX_DEPLOYMENT=dev:your-deployment-name
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud

# ── AI language model (Groq) ──
NEXT_PUBLIC_GROQ_API_KEY=your_groq_key

# ── Speech-to-text (Deepgram) ──
NEXT_PUBLIC_DEEPGRAM_API_KEY=your_deepgram_key

# ── Natural voice (ElevenLabs, optional) ──
ELEVENLABS_API_KEY=your_elevenlabs_key
ELEVENLABS_VOICE_ID=your_voice_id
```

Then set the **admin account** variables in Convex (these go in Convex, *not* in `.env.local`):

```bash
npx convex env set ADMIN_EMAIL "you@example.com"
npx convex env set ADMIN_PASSWORD "a-long-one-time-password-16+"
```

**Complete list of environment variables**

| Variable | Where | Required | Description |
| :--- | :--- | :---: | :--- |
| `CONVEX_DEPLOYMENT` | `.env.local` | ✅ | Your Convex deployment (written by `npx convex dev`) |
| `NEXT_PUBLIC_CONVEX_URL` | `.env.local` | ✅ | Your Convex deployment URL |
| `NEXT_PUBLIC_GROQ_API_KEY` | `.env.local` | ✅ | Groq API key |
| `NEXT_PUBLIC_DEEPGRAM_API_KEY` | `.env.local` | ✅ | Deepgram API key |
| `ELEVENLABS_API_KEY` | `.env.local` | ➖ | ElevenLabs API key |
| `ELEVENLABS_VOICE_ID` | `.env.local` | ➖ | ElevenLabs voice ID |
| `ADMIN_EMAIL` | Convex | ➖ | Admin email. Defaults to `admin@navi.local` |
| `ADMIN_PASSWORD` | Convex | ✅ | One-time admin password, at least 16 characters |

> [!IMPORTANT]
> Restart the web app after changing `.env.local`. Never commit this file to Git.

### 4️⃣ Create the first administrator

```bash
npx convex run seed:seedAdmin
```

`created: true` means success. `created: false` means an administrator already exists.

To change the seeded password later, update `ADMIN_PASSWORD`, then run:

```bash
npx convex run seed:rotateSeededAdminPassword
```

### 5️⃣ Start the app

```bash
npm run dev
```

> [!NOTE]
> `npm run dev:all` starts Convex and the web app together, and makes the app reachable from other devices on your network, which is handy for testing on a phone.

| 🔗 Address | 📄 Page |
| :--- | :--- |
| http://localhost:3000 | 🎙️ Visitor app |
| http://localhost:3000/admin/login | 🔐 Admin sign-in |
| http://localhost:3000/admin | 📊 Admin dashboard |
| http://localhost:3000/directions | 🏢 3D walk-through |
| http://localhost:3000/continue | 📷 QR scanner |

---

## 🗺️ Build Your First Map

> [!WARNING]
> A new database is empty. Visitors will see no destinations until a map is **published**.

1. 🔑 Sign in at `/admin/login` with `ADMIN_EMAIL` and `ADMIN_PASSWORD` (sessions last 24 hours).
2. 🏁 Open **Building Maps**, pick the building and floor, and add a **Main Entrance** node. Every route starts here.
3. 📍 Place nodes along corridors, junctions, stairs and doors. Connect neighbours so everything forms **one network**.
4. 🚪 Add **rooms** (with optional aliases) so visitors can ask for them by name.
5. ✅ Test a route and make every item on the **Dashboard** health checklist green.
6. 🚀 Click **Publish**. The map is now live in the visitor app.

👥 Need more users? Open **Manage Settings** to add admins, editors and viewers.

---

## ☁️ Deployment

1. **Backend**: run `npx convex deploy`. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` on production, then:
   ```bash
   npx convex run seed:seedAdmin --prod
   ```
2. **Web app**: deploy to [Vercel](https://vercel.com) (or `npm run build` then `npm run start`) with the same environment variables, using the **production** `NEXT_PUBLIC_CONVEX_URL`.
3. **HTTPS**: always serve over HTTPS. Browsers allow microphone and camera only on HTTPS or localhost.

---

## 🛠️ Troubleshooting

<details>
<summary><b>⚠️ "Convex URL is not set" or the page is stuck on Loading</b></summary>

Run `npx convex dev` and keep it running, then restart `npm run dev`.
</details>

<details>
<summary><b>🔐 <code>seedAdmin</code> fails, or I can't sign in</b></summary>

Set a 16+ character `ADMIN_PASSWORD` in the **same** Convex deployment, and use the exact `ADMIN_EMAIL`. If you forgot the password, update it and run `rotateSeededAdminPassword`.
</details>

<details>
<summary><b>🗺️ No destinations, or "No route" in the editor</b></summary>

Add rooms and click **Publish**. Connect any disconnected nodes and make sure a **Main Entrance** exists (the Dashboard shows what is missing).
</details>

<details>
<summary><b>🎙️ Microphone or AI not working</b></summary>

Allow microphone access, use HTTPS or localhost, and check the Deepgram and Groq keys in `.env.local`. Restart the app after editing it.
</details>

<details>
<summary><b>🔈 "Malawian voice is not configured"</b></summary>

Set both ElevenLabs variables and restart. This feature is optional.
</details>

<details>
<summary><b>🧱 Black 3D scene, install fails, or port 3000 is busy</b></summary>

Enable WebGL / hardware acceleration. Update Node.js to 20.9+ and reinstall. Use another port with `npx next dev -p 3001`.
</details>

---

## 🔒 Security Notes

- 🤫 Keep `ADMIN_PASSWORD` secret. After first sign-in, create a personal admin and optionally remove the seeded one.
- 🚫 Never commit `.env.local` or share your API keys.
- 📜 Review the audit log in **Manage Settings** regularly.

---

## ⌨️ Scripts

| Command | Purpose |
| :--- | :--- |
| `npm run dev` | Start the web app |
| `npm run dev:all` | Start Convex and the web app together |
| `npm run build` | Build for production |
| `npm run start` | Run the production build |
| `npm run lint` | Lint the code |

<div align="center">

<br>

**Made with 💙 for easier indoor wayfinding**

</div>
