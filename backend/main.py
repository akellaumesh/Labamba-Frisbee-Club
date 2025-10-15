# backend/main.py
from __future__ import annotations

import json, os, time, logging, uuid
from typing import Any, Dict, List
from datetime import datetime
import stripe
from pydantic import BaseModel

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from google.cloud import storage

from dotenv import load_dotenv
load_dotenv()

log = logging.getLogger("uvicorn.error")

# --- Simple in-memory cache ---
_cache: Dict[str, Any] = {"t": 0.0, "data": None}
TTL = 30  # seconds

app = FastAPI(title="La Bamba Frisbee API")

# CORS: include POST for photo uploads
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://labambafrisbee.se",
        "https://*.netlify.app",
        "https://labambafrisbee.netlify.app",
        "https://labambafrisbee.se",
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:8000",
        "http://127.0.0.1:8080",
    ],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

SHEET_ID = os.environ.get("SHEET_ID", "")
RANGE = os.environ.get("SHEET_RANGE", "Form Responses 1!A1:Z")
SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]

# Photos bucket (set in Cloud Run env)
BUCKET_NAME = os.environ.get("PHOTOS_BUCKET", "")

def gcs_client():
    return storage.Client()

@app.post("/api/photos")
async def upload_photo(file: UploadFile = File(...)):
    if not BUCKET_NAME:
        raise HTTPException(status_code=500, detail="PHOTOS_BUCKET not set")
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image uploads allowed")

    ext = os.path.splitext(file.filename or "")[1].lower() or ".jpg"
    key = f"uploads/{datetime.utcnow().strftime('%Y/%m/%d')}/{uuid.uuid4().hex}{ext}"

    data = await file.read()
    try:
        bucket = gcs_client().bucket(BUCKET_NAME)
        blob = bucket.blob(key)
        blob.upload_from_string(data, content_type=file.content_type)
        blob.make_public()  # simplest gallery; switch to signed URLs if needed
        return {"ok": True, "url": blob.public_url, "key": key}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")

@app.get("/api/photos")
async def list_photos(limit: int = 60):
    if not BUCKET_NAME:
        raise HTTPException(status_code=500, detail="PHOTOS_BUCKET not set")
    try:
        bucket = gcs_client().bucket(BUCKET_NAME)
        urls: List[str] = []
        for b in bucket.list_blobs(prefix="uploads/"):
            if b.name.endswith("/"):
                continue
            urls.append(f"https://storage.googleapis.com/{BUCKET_NAME}/{b.name}")
            if len(urls) >= limit:
                break
        return {"ok": True, "photos": urls}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"List failed: {e}")

def sheets_service():
    # 1) File path
    creds_file = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if creds_file:
        log.info(f"Using credentials file: {creds_file}")
        creds = Credentials.from_service_account_file(creds_file, scopes=SCOPES)
        return build("sheets", "v4", credentials=creds)

    # 2) Base64
    creds_b64 = os.getenv("GOOGLE_APPLICATION_CREDENTIALS_B64")
    if creds_b64:
        log.info("Using base64 credentials from env")
        info = json.loads(__import__("base64").b64decode(creds_b64).decode("utf-8"))
        creds = Credentials.from_service_account_info(info, scopes=SCOPES)
        return build("sheets", "v4", credentials=creds)

    # 3) Inline JSON
    creds_json = os.getenv("GOOGLE_APPLICATION_CREDENTIALS_JSON")
    if creds_json:
        log.info("Using inline JSON credentials from env")
        info = json.loads(creds_json)
        creds = Credentials.from_service_account_info(info, scopes=SCOPES)
        return build("sheets", "v4", credentials=creds)

    raise RuntimeError("No Google credentials provided")

@app.get("/health")
async def health() -> Dict[str, Any]:
    return {"ok": True}

@app.get("/api/health")
async def api_health() -> Dict[str, Any]:
    return {"ok": True}

@app.get("/api/registrations")
async def registrations() -> Dict[str, Any]:
    if not SHEET_ID:
        return {"headers": [], "rows": [], "count": 0}

    now = time.time()
    if _cache["data"] and now - _cache["t"] < TTL:
        return _cache["data"]

    try:
        svc = sheets_service().spreadsheets().values()
        resp = svc.get(spreadsheetId=SHEET_ID, range=RANGE).execute()
        values: List[List[str]] = resp.get("values", [])  # type: ignore[assignment]
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Sheets fetch failed: {e!s}")

    if not values:
        out = {"headers": [], "rows": [], "count": 0}
    else:
        headers: List[str] = values[0]
        rows: List[List[str]] = values[1:]
        out = {"headers": headers, "rows": rows, "count": len(rows)}

    _cache["data"] = out
    _cache["t"] = now
    return out


stripe.api_key = os.getenv("STRIPE_SECRET_KEY")  # set in Cloud Run

class CheckoutIn(BaseModel):
    amount_sek: int
    description: str | None = None

@app.post("/api/pay/checkout")
async def create_checkout_session(body: CheckoutIn):
    if not stripe.api_key:
        raise HTTPException(status_code=500, detail="Stripe not configured")

    # Convert SEK to öre (Stripe amounts are in the smallest unit)
    amount_ore = int(body.amount_sek) * 100

    try:
        session = stripe.checkout.Session.create(
            mode="payment",
            payment_method_types=["card"],
            line_items=[{
                "price_data": {
                    "currency": "sek",
                    "product_data": {
                        "name": body.description or "Gothrow payment",
                    },
                    "unit_amount": amount_ore,
                },
                "quantity": 1,
            }],
            success_url=os.getenv("CHECKOUT_SUCCESS_URL", "https://labambafrisbee.se/gothrow?paid=1"),
            cancel_url=os.getenv("CHECKOUT_CANCEL_URL", "https://labambafrisbee.se/gothrow?canceled=1"),
        )
        return {"sessionId": session["id"]}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Stripe error: {e}")
