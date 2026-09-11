import sqlite3

DB_NAME = "soc_threats.db"


def init_db():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS runtime_rules (
            rule_id TEXT PRIMARY KEY,
            rule_type TEXT NOT NULL,
            target_ip TEXT,
            protocol TEXT,
            direction TEXT NOT NULL,
            parameters TEXT,
            rule_description TEXT NOT NULL,
            requires_approval BOOLEAN NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT,
            applied_at TEXT,
            rolled_back_at TEXT,
            rejection_reason TEXT
        )
    """)

    conn.commit()
    conn.close()


def log_incident(
    source_ip,
    attack_type,
    severity,
    action_taken,
    guardrail_approved,
    reason
):
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()

    cursor.execute("""
        INSERT INTO threat_logs (
            source_ip,
            attack_type,
            severity,
            action_taken,
            guardrail_approved,
            reason
        )
        VALUES (?, ?, ?, ?, ?, ?)
    """, (
        source_ip,
        attack_type,
        severity,
        action_taken,
        guardrail_approved,
        reason
    ))

    conn.commit()
    conn.close()