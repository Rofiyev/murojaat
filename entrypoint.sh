#!/bin/sh
set -eu

# If a persistent SQLite path is configured, initialize it once from the bundled
# secured database. PostgreSQL deployments use DATABASE_URL instead.
if [ -z "${DATABASE_URL:-}" ] && [ -n "${SQLITE_PATH:-}" ]; then
  mkdir -p "$(dirname "$SQLITE_PATH")"
  if [ ! -f "$SQLITE_PATH" ] && [ -f /app/db.sqlite3 ]; then
    cp /app/db.sqlite3 "$SQLITE_PATH"
  fi
fi

# Initialize a mounted media volume from the bundled files once.
if [ -n "${MEDIA_ROOT:-}" ] && [ "$MEDIA_ROOT" != "/app/media" ]; then
  mkdir -p "$MEDIA_ROOT"
  if [ -z "$(ls -A "$MEDIA_ROOT" 2>/dev/null)" ] && [ -d /app/media ]; then
    cp -R /app/media/. "$MEDIA_ROOT"/
  fi
fi

python manage.py migrate --noinput
if [ "${LOAD_INITIAL_DATA:-False}" = "True" ] || [ "${LOAD_INITIAL_DATA:-False}" = "true" ]; then
  python manage.py seed_initial_data
fi
python manage.py collectstatic --noinput

if [ -n "${DATABASE_URL:-}" ]; then
  WORKERS=${WEB_CONCURRENCY:-2}
else
  # SQLite uses one worker to avoid unnecessary write-lock contention.
  WORKERS=${WEB_CONCURRENCY:-1}
fi
exec gunicorn hospital.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers "$WORKERS" --timeout 60 --access-logfile - --error-logfile -
