from .db import rows
def overview():
    return {'subjects':rows('SELECT id,name,color FROM subject WHERE archived=0'),'streak':0,'streak_best':0,'total_minutes_this_week':0,'total_minutes_last_week':0,'weak_topics':[]}
