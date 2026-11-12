from flask import Blueprint, jsonify, request
from datetime import date,timedelta
from .db import rows
from .stats import overview
stats_bp=Blueprint('stats',__name__,url_prefix='/api/stats')
@stats_bp.get('/overview')
def stats_overview():return jsonify(ok=True,data=overview())
@stats_bp.get('/heatmap')
def heatmap():
    start=date.today()-timedelta(days=83); return jsonify(ok=True,data=[{'date':(start+timedelta(days=i)).isoformat(),'minutes':0,'xp':0} for i in range(84)])
@stats_bp.get('/calendar')
def calendar():return jsonify(ok=True,data=[])
@stats_bp.get('/risk')
def risk():return jsonify(ok=True,data=[])
