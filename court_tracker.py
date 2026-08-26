"""
Brooklyn Badminton Center — Wednesday night court availability tracker.

Checks the Acuity Scheduling API for open slots on Wednesday nights 7–9 PM ET
for these combinations:
  - 8 people  (1 court, appointment type 65420318)
  - 6 + 4     (2 courts simultaneously: need >= 2 courts free for 6ppl)
  - 6 + 6     (2 courts simultaneously: need >= 2 courts free for 6ppl)

Multi-court detection: the "any" calendar API always returns slotsAvailable=1
regardless of how many courts are free. To get a real court count for the 6+4
and 6+6 combos, we query all 7 individual court calendar IDs and count how many
have availability for the 6ppl appointment type at each time slot.

Telegram bot commands (natural language, powered by Claude):
  "I booked April 8th"              → marks that date as booked (skipped in future checks)
  "We can't make March 25 anymore"  → removes it from the booked list
  "What's available?"               → checks and replies with current open slots

Sends a Telegram alert when new slots become available.
Does NOT book — just notifies.

Usage:
    python3 court_tracker.py             # check once, alert on new slots
    python3 court_tracker.py --status    # print current availability, no alert
    python3 court_tracker.py --history   # show recent check history
"""

import argparse
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

from shared.google_calendar import booked_dates_from_calendar, fetch_bkbc_bookings
from shared.http import APIClient
from shared.state import StateManager
from shared.telegram import TelegramClient

load_dotenv(Path(__file__).parent.parent / "investor" / ".env")
load_dotenv(Path(__file__).parent.parent / "travel_planning" / ".env", override=False)

# ── Config ─────────────────────────────────────────────────────────────────────

OWNER    = "474f915b"
BASE_URL = "https://brooklynbadmintoncenter.as.me/api/scheduling/v1/availability/times"
BOOK_URL = "https://brooklynbadmintoncenter.as.me/schedule/474f915b?categories%5B%5D=Court+Booking+by+%23+of+players"

APPT = {
    "6ppl": "65420276",
    "8ppl": "65420318",
}

# Individual court calendar IDs (courts #1–7)
COURT_IDS = [
    "10414160",  # court 1
    "10414169",  # court 2
    "10414175",  # court 3
    "10414180",  # court 4
    "10414185",  # court 5
    "10414190",  # court 6
    "10414194",  # court 7
]

ET                = ZoneInfo("America/New_York")
AFTER_HOUR        = 20   # 8 PM ET  (inclusive — catches 8:30 PM slots)
LATEST_START_HOUR = 21   # 9 PM ET  (inclusive — slots starting after 9 PM are excluded)
WEEKS_AHEAD       = 8

STATE_FILE = Path(__file__).parent / "court_tracker_state.json"
_state_mgr = StateManager(
    STATE_FILE,
    defaults={"alerted": [], "checks": [], "booked_dates": [], "last_update_id": 0},
)

_http = APIClient(
    headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
        "Referer":    "https://brooklynbadmintoncenter.as.me/",
        "Accept":     "application/json",
    },
    timeout=15,
)


# ── API ────────────────────────────────────────────────────────────────────────

def fetch_times_any(appt_key: str, check_date: date) -> list[str]:
    """Return available time strings for an appointment type across any court."""
    data, ok = _http.get(BASE_URL, params={
        "owner":             OWNER,
        "appointmentTypeId": APPT[appt_key],
        "calendarId":        "any",
        "startDate":         check_date.isoformat(),
        "timezone":          "America/New_York",
    })
    return [s["time"] for s in data.get(check_date.isoformat(), [])] if ok else []


def count_courts_for_6ppl(check_date: date) -> dict[str, int]:
    """
    Query each of the 7 courts individually for 6ppl availability.
    Returns {time_str: court_count} — the actual number of courts free at each time.

    Background: the "any" calendar endpoint always returns slotsAvailable=1
    regardless of how many courts are actually free. Querying per-court and
    summing gives the true count needed to verify 2-court combos (6+4, 6+6).
    """
    time_count: dict[str, int] = {}
    for cal_id in COURT_IDS:
        data, ok = _http.get(BASE_URL, params={
            "owner":             OWNER,
            "appointmentTypeId": APPT["6ppl"],
            "calendarId":        cal_id,
            "startDate":         check_date.isoformat(),
            "timezone":          "America/New_York",
        })
        if not ok:
            continue
        for s in data.get(check_date.isoformat(), []):
            time_count[s["time"]] = time_count.get(s["time"], 0) + 1
    return time_count


# ── Availability check ─────────────────────────────────────────────────────────

def next_wednesdays(n: int) -> list[date]:
    today = date.today()
    days_until_wed = (2 - today.weekday()) % 7
    if days_until_wed == 0:
        days_until_wed = 7
    first = today + timedelta(days=days_until_wed)
    return [first + timedelta(weeks=i) for i in range(n)]


def in_window(time_str: str) -> bool:
    dt_et = datetime.fromisoformat(time_str).astimezone(ET)
    return AFTER_HOUR <= dt_et.hour <= LATEST_START_HOUR


def check_wednesday(check_date: date, already_booked: bool = False) -> list[dict]:
    label = " (checking for additional court)" if already_booked else ""
    print(f"  Checking {check_date}{label}…", flush=True)

    times_8ppl       = set(t for t in fetch_times_any("8ppl", check_date) if in_window(t))
    court_count_6ppl = {t: c for t, c in count_courts_for_6ppl(check_date).items() if in_window(t)}

    available = []
    for time_str in sorted(times_8ppl | set(court_count_6ppl)):
        dt_et    = datetime.fromisoformat(time_str).astimezone(ET)
        display  = dt_et.strftime("%-I:%M %p")
        courts_6 = court_count_6ppl.get(time_str, 0)

        if already_booked:
            # Already have 1 court — look for 1 more to reach 10-12+ people
            if time_str in times_8ppl:
                available.append({"date": check_date.isoformat(), "time_str": time_str,
                                   "time_display": display,
                                   "combo": "additional 8-person court (+8 people)",
                                   "additional": True})
            if courts_6 >= 1:
                available.append({"date": check_date.isoformat(), "time_str": time_str,
                                   "time_display": display,
                                   "combo": f"additional 6-person court (+6 people, {courts_6} free)",
                                   "additional": True})
        else:
            if time_str in times_8ppl:
                available.append({"date": check_date.isoformat(), "time_str": time_str,
                                   "time_display": display, "combo": "8 people (1 court)",
                                   "additional": False})
            if courts_6 >= 2:
                available.append({"date": check_date.isoformat(), "time_str": time_str,
                                   "time_display": display,
                                   "combo": f"6+4 or 6+6 people (2 courts, {courts_6} free)",
                                   "additional": False})
    return available


def run_check(booked_dates: set[str]) -> list[dict]:
    wednesdays    = next_wednesdays(WEEKS_AHEAD)
    all_available = []
    for wed in wednesdays:
        already_booked = wed.isoformat() in booked_dates
        all_available.extend(check_wednesday(wed, already_booked=already_booked))
    return all_available


# ── State helpers ──────────────────────────────────────────────────────────────

def slot_key(slot: dict) -> str:
    return f"{slot['date']}|{slot['time_str']}|{slot['combo']}"


def new_slots(available: list[dict], state: dict) -> list[dict]:
    alerted = set(state.get("alerted", []))
    return [s for s in available if slot_key(s) not in alerted]


def mark_alerted(state: dict, slots: list[dict]) -> None:
    alerted = set(state.get("alerted", []))
    alerted.update(slot_key(s) for s in slots)
    today = date.today().isoformat()
    state["alerted"] = sorted(k for k in alerted if k.split("|")[0] >= today)


# ── Telegram commands (Claude-powered) ────────────────────────────────────────

def process_commands(state: dict, tg: TelegramClient) -> bool:
    """
    Poll Telegram for new messages and handle natural-language booking commands.
    Returns True if the user requested a status/availability check.
    """
    offset  = state.get("last_update_id", 0) + 1
    updates = tg.get_updates(offset)

    wants_status = False
    for update in updates:
        state["last_update_id"] = update["update_id"]
        text = update.get("message", {}).get("text", "").strip()
        if not text:
            continue

        intent   = tg.parse_intent(text)
        action   = intent.get("action", "unknown")
        date_str = intent.get("date")

        booked: list[str] = state.setdefault("booked_dates", [])

        if action == "booked" and date_str:
            if date_str not in booked:
                booked.append(date_str)
                state["booked_dates"] = sorted(booked)
                tg.send(f"✅ Got it — *{date_str}* marked as booked. I'll skip it from now on.")
            else:
                tg.send(f"ℹ️ *{date_str}* was already in the booked list.")

        elif action == "unbooked" and date_str:
            if date_str in booked:
                booked.remove(date_str)
                state["booked_dates"] = sorted(booked)
                tg.send(f"✅ Got it — *{date_str}* removed. I'll include it in future checks.")
            else:
                tg.send(f"ℹ️ *{date_str}* wasn't in the booked list.")

        elif action == "status":
            wants_status = True
            tg.send("🔍 Checking availability now…")

    return wants_status


# ── Telegram alert ─────────────────────────────────────────────────────────────

def build_alert(slots: list[dict]) -> str:
    lines = [
        "🏸 *BKBC Wednesday night slots available!*",
        f"🔗 {BOOK_URL}",
        "",
    ]

    new_slots   = [s for s in slots if not s.get("additional")]
    extra_slots = [s for s in slots if s.get("additional")]

    def _render_by_date(slot_list: list[dict]) -> list[str]:
        by_date: dict[str, list[dict]] = {}
        for s in slot_list:
            by_date.setdefault(s["date"], []).append(s)
        out = []
        for d in sorted(by_date):
            dt = datetime.strptime(d, "%Y-%m-%d")
            out.append(f"📅 *{dt.strftime('%A, %B %-d')}*")
            for s in sorted(by_date[d], key=lambda x: x["time_str"]):
                out.append(f"  • {s['time_display']} — {s['combo']}")
            out.append("")
        return out

    if new_slots:
        lines += _render_by_date(new_slots)

    if extra_slots:
        lines.append("➕ *Additional courts (dates already booked — expand to 10-12+ people):*")
        lines += _render_by_date(extra_slots)

    # Already-booked courts from Google Calendar
    bookings = fetch_bkbc_bookings()
    if bookings:
        lines.append("📋 *Already booked:*")
        for b in bookings:
            dt  = datetime.strptime(b["date"], "%Y-%m-%d")
            day = dt.strftime("%a, %b %-d")
            parts = [day]
            if b["time"]:   parts.append(b["time"])
            if b["court"]:  parts.append(f"Court #{b['court']}")
            if b["size"]:   parts.append(f"({b['size']})")
            lines.append(f"  • {' — '.join(parts[:2])}" +
                         (f" — {' '.join(parts[2:])}" if parts[2:] else ""))

    return "\n".join(lines).strip()


# ── Sign-up list ───────────────────────────────────────────────────────────────

SIGNUP_ROSTER = [
    "Player 01",
    "Player 02",
    "Player 03",
    "Player 04",
    "Player 05",
    "Player 06",
    "Player 07",
    "Player 08",
    "Player 09",
    "Player 10",
    "Player 11",
    "Player 12",
]

SIGNUP_FIXED = ["Player 01", "Player 02"]  # always pre-filled at the top


def build_signup_list() -> str:
    """Build a Thursday sign-up message for the next Wednesday session."""
    bookings = fetch_bkbc_bookings()

    if bookings:
        b = bookings[0]
        dt = datetime.strptime(b["date"], "%Y-%m-%d")
        day_str = dt.strftime("%-d/%-m")
        court_part = f"Court {b['court']}" if b["court"] else "court TBD"
        time_part  = b["time"] or "8:30pm"
        header = f"Wednesday {day_str} {time_part}–11:30pm\n{court_part}\n"
    else:
        # No booking yet — use next Wednesday
        today = date.today()
        days_until_wed = (2 - today.weekday()) % 7 or 7
        next_wed = today + timedelta(days=days_until_wed)
        day_str = next_wed.strftime("%-d/%-m")
        header = f"Wednesday {day_str} 8:30pm–11:30pm\n"

    lines = []
    for i, name in enumerate(SIGNUP_FIXED, start=1):
        lines.append(f"{i}.     {name}")
    for i in range(len(SIGNUP_FIXED) + 1, 17):
        lines.append(f"{i}.")

    return header + "\n".join(lines)


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Track BKBC Wednesday night availability")
    parser.add_argument("--status",  action="store_true", help="Print current availability (no alert)")
    parser.add_argument("--history", action="store_true", help="Show recent check history")
    parser.add_argument("--report",  action="store_true", help="Send Thursday sign-up list to Telegram")
    args = parser.parse_args()

    if args.report:
        tg  = TelegramClient.badminton()
        msg = build_signup_list()
        print("Sending sign-up list to Telegram…")
        print(msg)
        tg.send(msg)
        return

    if args.history:
        state  = _state_mgr.load()
        checks = state.get("checks", [])
        if not checks:
            print("No history yet.")
            return
        print(f"BKBC tracker — {len(checks)} check(s)\n")
        for c in checks[-20:]:
            print(f"  {c['checked_at'][:16]} UTC  —  {c.get('slots_found', '?')} slot(s) found")
        booked = state.get("booked_dates", [])
        if booked:
            print(f"\nBooked dates (skipped): {', '.join(booked)}")
        return

    print("Checking BKBC Wednesday night availability…")
    state = _state_mgr.load()
    tg    = TelegramClient.badminton()

    # Process incoming Telegram commands first
    wants_status = process_commands(state, tg)

    # Merge calendar bookings + manually marked dates
    calendar_booked = booked_dates_from_calendar()
    manual_booked   = set(state.get("booked_dates", []))
    booked_dates    = calendar_booked | manual_booked

    available = run_check(booked_dates)
    fresh     = new_slots(available, state)

    if args.status or wants_status:
        msg = (
            f"{len(available)} slot(s) available (7–9 PM ET, Wednesdays):\n\n"
            + "\n".join(
                f"  {s['date']}  {s['time_display']:>8}  {s['combo']}"
                for s in sorted(available, key=lambda x: (x["date"], x["time_str"]))
            )
        ) if available else "No Wednesday-night slots available right now."

        if args.status:
            print(f"\n{msg}")
        if wants_status:
            tg.send(msg)
        if args.status:
            return

    if fresh:
        print(f"\n{len(fresh)} new slot(s) found — sending Telegram alert…")
        tg.send(build_alert(fresh))
        mark_alerted(state, fresh)
    else:
        print(f"\nNo new slots ({len(available)} total available, all already alerted).")

    _state_mgr.append_and_prune(state, "checks", {
        "checked_at":  datetime.now(timezone.utc).isoformat(),
        "slots_found": len(available),
    })
    _state_mgr.save(state)


if __name__ == "__main__":
    main()
