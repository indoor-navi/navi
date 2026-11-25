<div align="center">

# 🧭 NaviSense

### Intelligent indoor wayfinding for the MUBAS ODeL Building

**📖 Installation Guide**

<br>

![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Three.js](https://img.shields.io/badge/Three.js-3D-049EF4?style=for-the-badge&logo=threedotjs&logoColor=white)
![Convex](https://img.shields.io/badge/Convex-Backend-F3694C?style=for-the-badge)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)

<br>

[✨ About](#-about) · [📋 Requirements](#-requirements) · [🚀 Installation](#-installation) · [🗺️ First Map](#️-build-and-publish-the-map) · [🖥️ Kiosk Setup](#️-kiosk-setup) · [☁️ Deploy](#️-deployment) · [🛠️ Troubleshooting](#️-troubleshooting)

</div>

---

## ✨ About

NaviSense is a **kiosk-based** navigation prototype. Visitors speak or type where they want to go, and the kiosk previews the route in a 3D model of the building, with spoken, landmark-based directions, before they start walking.

| 🎙️ Ask | 🧠 Understand | 🏢 Show |
| :--- | :--- | :--- |
| Speak or type a request, e.g. *"Take me to the Conference hall"*. | Deepgram transcribes speech and a Groq language model finds the destination. | Dijkstra's algorithm finds the shortest route, shown as a guided 3D walk. |

- 🏛️ **Coverage:** the ground floor of the ODeL Building (`public/floor/ODeL_Building.glb`)
- 🔐 **Admin studio (ODeL NavAdmin):** build and publish the map from a protected area
- 🛡️ **Privacy:** no visitor requests or personal data are stored

---

## 📋 Requirements

**On your computer**

- 🟢 **Node.js 20.9+** and npm (check with `node -v`)
- 🔀 **Git** (only if you clone the repository)
- 🌐 A modern browser with **WebGL** (Chrome, Edge or Brave). Microphone for voice requests.
- 📶 An **internet connection** (speech and language services run in the cloud)

**Accounts and API keys**

| Service | Used for | Required |
| :--- | :--- | :---: |
| 🟠 [**Convex**](https://convex.dev) | Database, server functions, admin login, file storage | ✅ |
| 🟣 [**Groq**](https://groq.com) | Understands requests and writes the route briefing | ✅ |
| 🔵 [**Deepgram**](https://deepgram.com) | Speech-to-text and spoken directions | ✅ |
| 🟡 [**ElevenLabs**](https://elevenlabs.io) | Alternative natural voice (API key + Voice ID) | ➖ optional |

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

Log in when the browser opens and create a new project. Convex uploads the functions in `convex/`, creates the database tables and writes your deployment details to `.env.local`.

> [!TIP]
> Leave this terminal running and open a second one for the next steps.

### 3️⃣ Configure environment variables

Create or edit `.env.local` in the project root so it contains **all** of the following:

```env
# ── Convex (added automatically by `npx convex dev`) ──
CONVEX_DEPLOYMENT=dev:your-deployment-name
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud

# ── Request interpretation and route briefing (Groq) ──
NEXT_PUBLIC_GROQ_API_KEY=your_groq_key

# ── Speech-to-text and spoken directions (Deepgram) ──
NEXT_PUBLIC_DEEPGRAM_API_KEY=your_deepgram_key

# ── Alternative natural voice (ElevenLabs, optional) ──
ELEVENLABS_API_KEY=your_elevenlabs_key
ELEVENLABS_VOICE_ID=your_voice_id
```

Then set the **administrator account** in Convex (these go in Convex, *not* in `.env.local`):

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
> `npm run dev:all` starts Convex and the web app together and makes the app reachable from other devices on your network, which is handy for testing on a kiosk screen or tablet.

| 🔗 Address | 📄 Page |
| :--- | :--- |
| http://localhost:3000 | 🎙️ Kiosk home screen (voice orb and text box) |
| http://localhost:3000/directions | 🏢 3D route guidance |
| http://localhost:3000/admin/login | 🔐 Administrator sign-in |
| http://localhost:3000/admin | 📊 Administrator dashboard |

---

## 🗺️ Build and Publish the Map

> [!WARNING]
> A new database is empty. Visitors will find no destinations until a map is built and **published**.

1. 🔑 Sign in at `/admin/login` with `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Sessions last 24 hours.
2. 🏢 Open **Building Maps**. The editor loads the same 3D model the visitors see.
3. 🏁 Use **Add Node** to create a node named **Main Entrance**. Routes from the kiosk home screen start here. If it is missing, the system falls back to an entrance, reception or lobby node.
4. 📍 Use **Add Node** to click points along corridors, junctions, stairs and doors. Mark landmarks (corridor, staircase, elevator, double door), because spoken directions are built from them.
5. 🚪 Use **Add Room** to click inside a room and name it. This creates the node and the searchable destination together, with a simple alias made from the name.
6. 🔗 Use **Connect Nodes**: click one node, then another. Every node must join **one connected network**.
7. 🎯 Use **Select** to fix a node's name, type or connections. Move a node with the translate gizmo and set the direction a visitor faces with the rotate gizmo. Both save when released.
8. ✅ Open the **Dashboard** and make every map-health item green.
9. 🚀 Click **Publish**. Visitors always use the saved map, so changes apply to the next request without redeploying.

**Admin pages:** Dashboard · Building Maps · Destinations · Routes · Analytics (audit log).

**Roles:** `admin` and `editor` can change the map. Creating users and changing assistant settings (name, personality, colours) is **admin-only**.

---

## 🖥️ Kiosk Setup

NaviSense guides from a **fixed kiosk position**, so the kiosk should stand where the Main Entrance node is placed on the map.

1. 🖱️ Use a touchscreen or a computer with a microphone, connected to the internet.
2. 🌐 Open the app address in Chrome, Edge or Brave and switch the browser to **full screen** (`F11`).
3. 🎤 Allow **microphone access** when the browser asks.
4. 🔊 Check the speakers work, then test with a request such as *"Take me to the Conference hall"*.
5. 🔒 Keep the kiosk on the visitor pages only. The administrator pages need a sign-in.

**How visitors use it**

- Tap the **voice orb** and speak, or type in the text box. Typing always works as an alternative to speaking.
- The orb shows when the kiosk is *listening*, *thinking* or *speaking*.
- The 3D walk follows a green line to a red destination pin, with spoken directions and an on-screen turn cue.
- **Controls:** pause, resume, speed (0.7×, 1×, 1.5×, 2×), mute, list of places, and a joystick (touch) or `W` `A` `S` `D` keys (computer) to look around freely.
- **Typed commands:** *stop*, *pause*, *resume*, *repeat* and *where am I*.

---

## ☁️ Deployment

1. **Backend:** run `npx convex deploy`. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` on the production deployment, then:
   ```bash
   npx convex run seed:seedAdmin --prod
   ```
2. **Web app:** deploy to [Vercel](https://vercel.com) (or `npm run build` then `npm run start`) with the same environment variables, using the **production** `NEXT_PUBLIC_CONVEX_URL`.
3. **HTTPS:** always serve over HTTPS. Browsers allow the microphone only on HTTPS or localhost.
4. **Publish the map** on the production deployment, since it has its own database.

---

## ⚠️ Good to Know

- 🏢 The prototype covers the **ground floor** only.
- 📍 It does **not track visitors**. Guidance is a virtual walk that starts at the main entrance or the nearest node.
- 📶 Speech recognition, request interpretation and the Deepgram voice need internet. If they fail, **typed input**, the local route briefing and the browser voice keep guidance available.
- 🛠️ Nodes, connections and rooms must be kept in step with the building by an administrator through the map editor.

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
<summary><b>🗺️ No destinations, or "no walking route is mapped yet"</b></summary>

Add rooms and click **Publish**. Connect any disconnected nodes and make sure a **Main Entrance** node exists. The Dashboard shows what is missing.
</details>

<details>
<summary><b>🎙️ Microphone does not work</b></summary>

Allow microphone access, use HTTPS or localhost, and check the Deepgram key in `.env.local`. Restart the app after editing it. You can still type requests.
</details>

<details>
<summary><b>🤖 The assistant does not understand requests</b></summary>

Check the Groq key in `.env.local` and the internet connection. Make sure rooms are published, because the assistant matches requests against the published destinations and their aliases.
</details>

<details>
<summary><b>🔈 No spoken directions</b></summary>

Check the Deepgram key and that the mute button is off. If the cloud voice fails, the browser voice is used instead.
</details>

<details>
<summary><b>🧱 Black 3D scene, install fails, or port 3000 is busy</b></summary>

Enable WebGL / hardware acceleration. Update Node.js to 20.9+ and reinstall. Use another port with `npx next dev -p 3001`.
</details>

---

## 🔒 Security Notes

- 🤫 Keep `ADMIN_PASSWORD` secret. After first sign-in, create a personal admin and optionally remove the seeded one.
- 🚫 Never commit `.env.local` or share your API keys.
- 📜 Administrator actions are recorded in the audit log. Visitor activity is not.

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

**NaviSense · School of Science and Technology · MUBAS**

</div>
