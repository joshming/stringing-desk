from datetime import datetime
from pathlib import Path
import sqlite3
import json
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


DATABASE_PATH = Path(__file__).parent / "stringing.db"
LOCATIONS = {"Sheridan Centre", "Battaglia's", "Stoney Creek"}


def get_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database() -> None:
    with get_connection() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_name TEXT,
                phone_number TEXT,
                racket_model TEXT NOT NULL DEFAULT 'Racket model not provided',
                string_name TEXT NOT NULL,
                colour TEXT NOT NULL,
                tension TEXT NOT NULL,
                pickup_date TEXT NOT NULL,
                location TEXT NOT NULL,
                total_cents INTEGER NOT NULL,
                uses_inventory INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'Open',
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS inventory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                string_name TEXT NOT NULL UNIQUE,
                colours TEXT NOT NULL DEFAULT '[]',
                manual_used_by_colour TEXT NOT NULL DEFAULT '{}'
            )
            """
        )
        columns = {row[1] for row in connection.execute("PRAGMA table_info(jobs)").fetchall()}
        if "racket_model" not in columns:
            connection.execute("ALTER TABLE jobs ADD COLUMN racket_model TEXT NOT NULL DEFAULT 'Racket model not provided'")
        if "uses_inventory" not in columns:
            connection.execute("ALTER TABLE jobs ADD COLUMN uses_inventory INTEGER NOT NULL DEFAULT 1")
        inventory_columns = {row[1] for row in connection.execute("PRAGMA table_info(inventory)").fetchall()}
        if "manual_used_by_colour" not in inventory_columns:
            connection.execute("ALTER TABLE inventory ADD COLUMN manual_used_by_colour TEXT NOT NULL DEFAULT '{}'")
        connection.execute("UPDATE jobs SET status = 'Complete' WHERE status = 'Ready'")


class StringingItem(BaseModel):
    racket_model: str = Field(min_length=1, max_length=120)
    string_name: str = Field(min_length=1, max_length=120)
    colour: str = Field(min_length=1, max_length=80)
    tension: str = Field(min_length=1, max_length=40)
    total: float = Field(ge=0)
    uses_inventory: bool = True


class JobCreate(BaseModel):
    customer_name: str | None = Field(default=None, max_length=120)
    phone_number: str | None = Field(default=None, max_length=40)
    items: list[StringingItem] = Field(min_length=1, max_length=20)
    pickup_date: str = Field(min_length=1, max_length=20)
    location: str
    notes: str = Field(default="", max_length=2000)


class JobUpdate(BaseModel):
    status: Literal["Open", "Complete"] | None = None
    notes: str | None = Field(default=None, max_length=2000)
    pickup_date: str | None = Field(default=None, min_length=1, max_length=20)
    location: str | None = None


class InventoryCreate(BaseModel):
    string_name: str = Field(min_length=1, max_length=120)
    colours: list[str] = Field(min_length=1, max_length=30)


class InventoryUpdate(BaseModel):
    string_name: str = Field(min_length=1, max_length=120)
    colours: list[str] = Field(min_length=1, max_length=30)


def row_to_job(row: sqlite3.Row) -> dict:
    job = dict(row)
    job["total"] = job.pop("total_cents") / 100
    job["uses_inventory"] = bool(job["uses_inventory"])
    return job


def row_to_inventory(row: sqlite3.Row) -> dict:
    inventory = dict(row)
    inventory["colours"] = json.loads(inventory["colours"])
    inventory["reel_capacity"] = 20
    usage = inventory.pop("used_by_colour", "{}")
    manual_usage = inventory.pop("manual_used_by_colour", "{}")
    inventory["used_by_colour"] = json.loads(usage) if isinstance(usage, str) else usage
    inventory["manual_used_by_colour"] = json.loads(manual_usage) if isinstance(manual_usage, str) else manual_usage
    inventory["remaining_by_colour"] = {
        colour: max(0, 20 - int(inventory["used_by_colour"].get(colour, 0)) - int(inventory["manual_used_by_colour"].get(colour, 0)))
        for colour in inventory["colours"]
    }
    return inventory


app = FastAPI(title="Stringing Desk API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    initialize_database()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/jobs")
def list_jobs() -> list[dict]:
    with get_connection() as connection:
        rows = connection.execute("SELECT * FROM jobs ORDER BY CASE WHEN status = 'Complete' THEN 1 ELSE 0 END ASC, pickup_date ASC, id DESC").fetchall()
    return [row_to_job(row) for row in rows]


@app.get("/api/inventory")
def list_inventory() -> list[dict]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT i.*, COALESCE((
              SELECT json_group_object(colour, usage_count)
              FROM (
                SELECT j.colour, COUNT(*) AS usage_count
                FROM jobs j
                WHERE j.string_name = i.string_name AND j.uses_inventory = 1
                GROUP BY j.colour
              )
            ), '{}') AS used_by_colour
            FROM inventory i ORDER BY i.string_name COLLATE NOCASE ASC
            """
        ).fetchall()
    return [row_to_inventory(row) for row in rows]


class InventoryConsume(BaseModel):
    colour: str = Field(min_length=1, max_length=80)


@app.post("/api/inventory/{inventory_id}/consume")
def consume_inventory(inventory_id: int, payload: InventoryConsume) -> dict:
    with get_connection() as connection:
        item = connection.execute("SELECT * FROM inventory WHERE id = ?", (inventory_id,)).fetchone()
        if item is None:
            raise HTTPException(status_code=404, detail="Inventory item not found.")
        if payload.colour not in json.loads(item["colours"]):
            raise HTTPException(status_code=422, detail="That colour is not in this inventory item.")
        job_count = connection.execute(
            "SELECT COUNT(*) FROM jobs WHERE string_name = ? AND colour = ? AND uses_inventory = 1",
            (item["string_name"], payload.colour),
        ).fetchone()[0]
        manual_usage = json.loads(item["manual_used_by_colour"] or "{}")
        remaining = 20 - job_count - int(manual_usage.get(payload.colour, 0))
        if remaining <= 0:
            raise HTTPException(status_code=409, detail="No strings remain for that colour.")
        manual_usage[payload.colour] = int(manual_usage.get(payload.colour, 0)) + 1
        connection.execute(
            "UPDATE inventory SET manual_used_by_colour = ? WHERE id = ?",
            (json.dumps(manual_usage), inventory_id),
        )
        row = connection.execute(
            """SELECT i.*, COALESCE((SELECT json_group_object(colour, usage_count) FROM (
                SELECT j.colour, COUNT(*) AS usage_count FROM jobs j
                WHERE j.string_name = i.string_name AND j.uses_inventory = 1 GROUP BY j.colour
            )), '{}') AS used_by_colour FROM inventory i WHERE i.id = ?""",
            (inventory_id,),
        ).fetchone()
    return row_to_inventory(row)


@app.post("/api/inventory", status_code=201)
def create_inventory(payload: InventoryCreate) -> dict:
    string_name = payload.string_name.strip()
    colours = sorted({colour.strip() for colour in payload.colours if colour.strip()}, key=str.casefold)
    if not colours:
        raise HTTPException(status_code=422, detail="Add at least one colour.")
    with get_connection() as connection:
        try:
            cursor = connection.execute(
                "INSERT INTO inventory (string_name, colours) VALUES (?, ?)",
                (string_name, json.dumps(colours)),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409, detail="That string is already in inventory.")
        row = connection.execute("SELECT * FROM inventory WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return row_to_inventory(row)


@app.delete("/api/inventory/{inventory_id}", status_code=204)
def delete_inventory(inventory_id: int) -> None:
    with get_connection() as connection:
        cursor = connection.execute("DELETE FROM inventory WHERE id = ?", (inventory_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Inventory item not found.")


@app.patch("/api/inventory/{inventory_id}")
def update_inventory(inventory_id: int, payload: InventoryUpdate) -> dict:
    string_name = payload.string_name.strip()
    colours = sorted({colour.strip() for colour in payload.colours if colour.strip()}, key=str.casefold)
    if not colours:
        raise HTTPException(status_code=422, detail="Add at least one colour.")
    with get_connection() as connection:
        current = connection.execute("SELECT * FROM inventory WHERE id = ?", (inventory_id,)).fetchone()
        if current is None:
            raise HTTPException(status_code=404, detail="Inventory item not found.")
        try:
            connection.execute(
                "UPDATE inventory SET string_name = ?, colours = ? WHERE id = ?",
                (string_name, json.dumps(colours), inventory_id),
            )
            if current["string_name"] != string_name:
                connection.execute(
                    "UPDATE jobs SET string_name = ? WHERE string_name = ? AND uses_inventory = 1",
                    (string_name, current["string_name"]),
                )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=409, detail="That string is already in inventory.")
        row = connection.execute(
            """
            SELECT i.*, COALESCE((
              SELECT json_group_object(colour, usage_count)
              FROM (
                SELECT j.colour, COUNT(*) AS usage_count
                FROM jobs j
                WHERE j.string_name = i.string_name AND j.uses_inventory = 1
                GROUP BY j.colour
              )
            ), '{}') AS used_by_colour
            FROM inventory i WHERE i.id = ?
            """,
            (inventory_id,),
        ).fetchone()
    return row_to_inventory(row)


@app.post("/api/jobs", status_code=201)
def create_job(payload: JobCreate) -> list[dict]:
    if not payload.customer_name and not payload.phone_number:
        raise HTTPException(status_code=422, detail="Add a customer name or phone number.")
    if payload.location not in LOCATIONS:
        raise HTTPException(status_code=422, detail="Choose a valid pickup location.")

    created_at = datetime.now().isoformat(timespec="seconds")
    customer_name = payload.customer_name.strip() or None if payload.customer_name else None
    phone_number = payload.phone_number.strip() or None if payload.phone_number else None
    with get_connection() as connection:
        created_ids = []
        for item in payload.items:
            cursor = connection.execute(
                """
                INSERT INTO jobs
                  (customer_name, phone_number, racket_model, string_name, colour, tension,
                   pickup_date, location, total_cents, uses_inventory, status, notes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Open', ?, ?)
                """,
                (customer_name, phone_number, item.racket_model.strip(), item.string_name.strip(),
                 item.colour.strip(), item.tension.strip(), payload.pickup_date, payload.location,
                 round(item.total * 100), int(item.uses_inventory), payload.notes.strip(), created_at),
            )
            created_ids.append(cursor.lastrowid)
        rows = connection.execute(
            f"SELECT * FROM jobs WHERE id IN ({','.join('?' for _ in created_ids)}) ORDER BY id ASC",
            created_ids,
        ).fetchall()
    return [row_to_job(row) for row in rows]


@app.patch("/api/jobs/{job_id}")
def update_job(job_id: int, payload: JobUpdate) -> dict:
    updates = []
    values = []
    if payload.status is not None:
        updates.append("status = ?")
        values.append(payload.status)
    if payload.notes is not None:
        updates.append("notes = ?")
        values.append(payload.notes.strip())
    if payload.pickup_date is not None:
        updates.append("pickup_date = ?")
        values.append(payload.pickup_date)
    if payload.location is not None:
        if payload.location not in LOCATIONS:
            raise HTTPException(status_code=422, detail="Choose a valid pickup location.")
        updates.append("location = ?")
        values.append(payload.location)
    if not updates:
        raise HTTPException(status_code=400, detail="No changes supplied.")

    values.append(job_id)
    with get_connection() as connection:
        cursor = connection.execute(f"UPDATE jobs SET {', '.join(updates)} WHERE id = ?", values)
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Job not found.")
        row = connection.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return row_to_job(row)
