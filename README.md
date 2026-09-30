# Stringing Desk

A lightweight badminton stringing job tracker built with React, TypeScript, FastAPI, and SQLite.

## Run the backend

From the project root:

```bash
python3 -m venv backend/.venv
source backend/.venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e backend
uvicorn backend.main:app --reload --port 8000
```

The SQLite database is created automatically at `backend/stringing.db`.

## Run the frontend

In a second terminal:

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.
