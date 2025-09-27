# Deploy FastAPI backend to Cloud Run

## 0) Prereqs
- `gcloud` CLI installed and logged in
- A GCP Project created, e.g. `labamba-frisbee`
- Enable APIs:
```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com sheets.googleapis.com