import logging

from flask import Flask, jsonify, render_template, send_from_directory
from dotenv import load_dotenv


def create_app(test_config=None):
    load_dotenv()
    from .config import Config

    app = Flask(__name__)
    app.config.from_object(Config)
    if test_config:
        app.config.update(test_config)
    logging.basicConfig(level=logging.INFO)
    from .routes_ai import ai_bp
    app.register_blueprint(ai_bp)
    @app.get('/')
    def index(): return render_template('index.html')
    @app.get('/service-worker.js')
    def service_worker():
        response = send_from_directory(app.static_folder, 'sw.js')
        response.headers['Service-Worker-Allowed'] = '/'
        return response
    @app.errorhandler(413)
    def upload_too_large(_error):
        return jsonify(ok=False,error='Upload exceeds the configured size limit.'),413
    return app
