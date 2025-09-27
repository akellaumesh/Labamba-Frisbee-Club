# La Bamba Frisbee Club
La bamba Frisbee Club

Static site + FastAPI backend reading Google Sheet (responses from the Google Form).

## Live pages
- **About** – club info
- **Teams** – auto-count and list from registrations
- **Registration** – embedded Google Form (submits to your Google Sheet)
- **Photos** – link or embed album
- **Live** – space for stream/schedule

## Quick start

### 1) Frontend (local preview)
```bash
cd frontend
# For local dev you can use any static server:
python3 -m http.server 5173
# open http://127.0.0.1:5173
```

### 2) Backend (local)
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

SHEET_ID=your_sheet_id
SHEET_RANGE='Form Responses 1!A1:Z'
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/backend/keys/service-account.json

uvicorn main:app --reload --port 8000
 Test:
 http://127.0.0.1:8000/health
 http://127.0.0.1:8000/api/registrations
```

### 3) Using Docker:
````bash
cd backend
docker build -t labamba-backend:latest .
docker run --rm -p 8080:8080 \
  -e SHEET_ID=your_sheet_id \
  -e SHEET_RANGE='Form Responses 1!A1:Z' \
  -v "$PWD/keys/service-account.json:/secrets/key.json:ro" \
  -e GOOGLE_APPLICATION_CREDENTIALS=/secrets/key.json \
  labamba-backend:latest
````
### 4) Deploy it through Google cloud
```bash
gcloud run deploy labamba-backend \
  --image gcr.io/labamba-frisbee/labamba-backend \
  --region europe-north1 \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars SHEET_ID=1EbNX-ftw8EpLeXawcFTILMiOBgA_VEGzJfFhroM6Oao,SHEET_RANGE='Form Responses 1!A1:Z' \
  --set-secrets GOOGLE_APPLICATION_CREDENTIALS_JSON=labamba-sheets-sa:latest
```
### 5) Deploy it through Netflify cloud
```bash
Push to code changes GitHub.
Netlify → Add new site → Import from Git.
Build settings
Base directory: (leave empty)
Publish directory: frontend
Build command: (leave empty)
Add a proxy so your site can call the backend without CORS:
Create frontend/_redirects:
/api/*  https://<RUN_URL>/:splat  200
In frontend/main.js (for production):
CONFIG.MODE = "backend";
CONFIG.BACKEND_URL = "/api/registrations"; // keep relative; Netlify forwards it.
```

If you would like to test it manually from the cli. Follow the below steps
```bash
brew install netlify-cli
cd frontend
netlify init
netlify deploy --build --prod --dir=frontend

```

### 6) TEST
Test it using 
https://labambafrisbee.netlify.app -- Frontend
https://labamba-backend-459492754349.europe-north1.run.app/api/registrations -- Backend
