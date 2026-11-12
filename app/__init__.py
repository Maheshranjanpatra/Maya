import logging, os
from flask import Flask, jsonify, render_template, request
from dotenv import load_dotenv
from .config import Config
from .db import close_db, init_db, one
def create_app():
    load_dotenv()
    app=Flask(__name__); app.config.from_object(Config)
    logging.basicConfig(level=logging.INFO)
    from .routes import bp
    from .routes_ai import ai_bp
    from .routes_stats import stats_bp
    app.register_blueprint(bp); app.register_blueprint(ai_bp); app.register_blueprint(stats_bp)
    app.teardown_appcontext(close_db)
    with app.app_context(): init_db()
    @app.before_request
    def lock_api():
        if request.path.startswith('/api/') and request.path not in ('/api/settings',):
            s=one('SELECT web_lock_key FROM settings WHERE id=1')
            if s and s['web_lock_key'] and request.headers.get('X-Web-Lock-Key') != s['web_lock_key']:
                return jsonify(ok=False,error='Web lock key required'),401
    @app.get('/')
    def index(): return render_template('index.html')
    return app
