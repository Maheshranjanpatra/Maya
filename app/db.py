import sqlite3
from flask import current_app, g
from pathlib import Path
def get_db():
    if 'db' not in g:
        path=current_app.config['DATABASE_PATH']; Path(path).parent.mkdir(parents=True,exist_ok=True)
        g.db=sqlite3.connect(path); g.db.row_factory=sqlite3.Row; g.db.execute('PRAGMA foreign_keys=ON')
    return g.db
def close_db(e=None):
    db=g.pop('db',None)
    if db is not None: db.close()
def init_db():
    db=get_db()
    db.executescript(Path(current_app.root_path,'schema.sql').read_text())
    settings_columns = {
        row['name'] for row in db.execute('PRAGMA table_info(settings)').fetchall()
    }
    if 'gemini_api_key' not in settings_columns:
        db.execute("ALTER TABLE settings ADD COLUMN gemini_api_key TEXT DEFAULT ''")
    topic_columns = {
        row['name'] for row in db.execute('PRAGMA table_info(topic)').fetchall()
    }
    if 'parent_topic_id' not in topic_columns:
        db.execute(
            "ALTER TABLE topic ADD COLUMN parent_topic_id INTEGER "
            "REFERENCES topic(id) ON DELETE SET NULL"
        )
    task_columns = {
        row['name'] for row in db.execute('PRAGMA table_info(task)').fetchall()
    }
    if 'skip_reason' not in task_columns:
        db.execute("ALTER TABLE task ADD COLUMN skip_reason TEXT")
    if 'completed_at' not in task_columns:
        db.execute("ALTER TABLE task ADD COLUMN completed_at TEXT")
    db.commit()
def rows(sql,args=()):
    return [dict(r) for r in get_db().execute(sql,args).fetchall()]
def one(sql,args=()):
    r=get_db().execute(sql,args).fetchone()
    return dict(r) if r else None
