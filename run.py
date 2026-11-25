import ipaddress
import os

from app import create_app

app = create_app()

if __name__ == "__main__":
    host = app.config["HOST"]
    try:
        is_loopback = ipaddress.ip_address(host).is_loopback
    except ValueError:
        is_loopback = host.lower() == "localhost"
    ssl_cert = app.config["SSL_CERT"]
    ssl_key = app.config["SSL_KEY"]
    if not is_loopback and not (ssl_cert and ssl_key):
        raise RuntimeError(
            "Binding Maya to a non-local host requires MAYA_SSL_CERT and MAYA_SSL_KEY."
        )
    ssl_context = (ssl_cert, ssl_key) if ssl_cert and ssl_key else None
    app.run(
        host=host,
        port=int(os.environ.get("PORT", 8000)),
        debug=False,
        ssl_context=ssl_context,
    )
