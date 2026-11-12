from flask import Blueprint, jsonify, request

from .stats import calendar_month, exam_risks, heatmap, overview

stats_bp = Blueprint("stats", __name__, url_prefix="/api/stats")


@stats_bp.get("/overview")
def stats_overview():
    return jsonify(ok=True, data=overview())


@stats_bp.get("/heatmap")
def heatmap_data():
    return jsonify(ok=True, data=heatmap())


@stats_bp.get("/calendar")
def calendar_data():
    try:
        return jsonify(ok=True, data=calendar_month(request.args.get("month")))
    except ValueError as error:
        return jsonify(ok=False, error=str(error)), 400


@stats_bp.get("/risk")
def risk_data():
    return jsonify(ok=True, data=exam_risks())
