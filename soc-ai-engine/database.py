import sqlite3

DB_NAME = "soc_threats.db"

def init_db():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS threat_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            source_ip TEXT,
            attack_type TEXT,
            severity TEXT,
            action_taken TEXT,
            guardrail_approved BOOLEAN,
            reason TEXT
        )
    """)
    conn.commit()
    conn.close()

def log_incident(source_ip, attack_type, severity, action_taken, guardrail_approved, reason):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO threat_logs (source_ip, attack_type, severity, action_taken, guardrail_approved, reason)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (source_ip, attack_type, severity, action_taken, guardrail_approved, reason))
    conn.commit()
    conn.close()