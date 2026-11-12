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
    db.commit()
def rows(sql,args=()):
    return [dict(r) for r in get_db().execute(sql,args).fetchall()]
def one(sql,args=()):
    r=get_db().execute(sql,args).fetchone()
    return dict(r) if r else None
