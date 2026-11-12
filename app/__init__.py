import logging

from flask import Flask, jsonify, render_template, request
from dotenv import load_dotenv
from .config import Config
from .db import close_db, init_db, one


def create_app(test_config=None):
    load_dotenv()
    app=Flask(__name__)
    app.config.from_object(Config)
    if test_config:
        app.config.update(test_config)
    logging.basicConfig(level=logging.INFO)
    from .routes import bp
    from .routes_ai import ai_bp
    from .routes_stats import stats_bp
    app.register_blueprint(bp); app.register_blueprint(ai_bp); app.register_blueprint(stats_bp)
    app.teardown_appcontext(close_db)
    with app.app_context(): init_db()
    @app.before_request
    def lock_api():
        if not request.path.startswith('/api/'):
            return None
        if request.path == '/api/settings' and request.method == 'GET':
            return None
        settings = one('SELECT web_lock_key FROM settings WHERE id=1')
        lock_key = settings['web_lock_key'] if settings else ''
        if lock_key and request.headers.get('X-Web-Lock-Key') != lock_key:
            return jsonify(ok=False,error='Web lock key required'),401
    @app.get('/')
    def index(): return render_template('index.html')
    @app.errorhandler(413)
    def upload_too_large(_error):
        return jsonify(ok=False,error='Upload exceeds the configured size limit.'),413
    return app
