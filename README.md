# Smart Traffic Management System

## Render start command
```text
gunicorn app:app
```

## Required Render environment variables
- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `DB_CA_FILE` (optional if `ca.pem` is committed)

## Local upload
Put `traffic_dataset.xlsx` or `traffic_dataset.csv` beside `upload_dataset.py` and run:
```text
python upload_dataset.py
```

The web application's **Upload Dataset** button can also upload CSV/XLSX directly to Aiven.

## Important
Never commit the Aiven database password to GitHub. Rotate the password if it has already been exposed.
