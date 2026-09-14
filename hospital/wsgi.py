"""WSGI config for Hospital Management."""
import os
import secrets
import shutil
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# Vercel fallback: external DATABASE_URL is recommended for real use.
# Without it, run a temporary SQLite copy so the application can start safely
# without publishing the original database or any patient/user records.
if os.getenv("VERCEL") and not os.getenv("DATABASE_URL"):
    target = Path("/tmp/hospital.sqlite3")
    seed = BASE_DIR / "vercel_db.sqlite3"
    if not target.exists() and seed.exists():
        shutil.copy2(seed, target)
    os.environ.setdefault("SQLITE_PATH", str(target))
    os.environ.setdefault("MEDIA_ROOT", "/tmp/hospital-media")
    secret_file = Path("/tmp/hospital-secret-key")
    if secret_file.exists():
        secret = secret_file.read_text().strip()
    else:
        secret = secrets.token_urlsafe(64)
        secret_file.write_text(secret)
    os.environ.setdefault("SECRET_KEY", secret)

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "hospital.settings")

from django.core.wsgi import get_wsgi_application
application = get_wsgi_application()
