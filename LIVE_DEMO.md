# Live demo – shareable URL

Two ways to get a **live demo URL** you can share (e.g. LinkedIn).

---

## Option 1: One-click local live URL (ngrok)

1. **Install ngrok** (one time): https://ngrok.com/download  
   Or: `winget install ngrok` / `choco install ngrok`

2. **Run the live demo script** (from project folder):
   ```bash
   scripts\run_live_demo.bat
   ```
   - A window opens with the backend.
   - After a few seconds, ngrok starts and prints a **public HTTPS URL** (e.g. `https://abc123.ngrok-free.app`).

3. **Share that URL** – anyone can open it and use Index → CSV Analysis → Dashboard.

4. Stop with Ctrl+C in the ngrok window. Close the backend window when done.

---

## Option 2: Deploy online (always-on demo URL)

Deploy the app so it has a permanent URL (e.g. `https://your-app.onrender.com`).

### Using Render (free tier)

1. Push the project to **GitHub** (include `backend/artifacts/` or add a build step that runs training/copy_artifacts).

2. Go to **https://render.com** → New → Web Service.

3. Connect your repo. Set:
   - **Build command:** `pip install -r requirements.txt`
   - **Start command:** `uvicorn backend.app:app --host 0.0.0.0 --port $PORT`
   - **Root directory:** (leave blank if app is at repo root)

4. If you use the **Dockerfile** instead:
   - New → Web Service → connect repo.
   - Select **Docker** as environment. Render will use the Dockerfile.

5. After deploy, your live demo URL is: `https://<your-service-name>.onrender.com`

### Using Docker locally (then share via ngrok)

```bash
# From project root (after copy_artifacts)
docker build -t cyber-threat-demo .
docker run -p 8000:8000 cyber-threat-demo
# Then: ngrok http 8000
```

---

## Quick reference

| Method              | URL                          | Best for              |
|---------------------|------------------------------|------------------------|
| Local only          | http://localhost:8000        | Testing on your PC     |
| ngrok (run script)  | https://xxx.ngrok-free.app   | Quick shareable demo   |
| Render / Railway    | https://your-app.onrender.com| Always-on public demo  |
