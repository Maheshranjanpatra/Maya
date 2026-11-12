from .db import get_db, rows
POINTS={'read':10,'notes':10,'practice':15,'pastpaper':20,'mocktest':30,'revise':15}
def award_task(task):
    db=get_db(); amount=POINTS.get(task['type'],10); db.execute('INSERT INTO xp_event(amount,reason,ref_id) VALUES(?,?,?)',(amount,'Task completed',task['id'])); db.commit()
def profile():
    db=get_db(); total=db.execute('SELECT COALESCE(SUM(amount),0) FROM xp_event').fetchone()[0]
    level=1
    while level<50 and 50*level*(level-1)<=total: level+=1
    into=total-50*(level-1)*level
    return {'level':level,'xp_total':total,'xp_into_level':into,'xp_for_next':100*level,'title':'Novice' if level<4 else 'Apprentice' if level<7 else 'Scholar' if level<10 else 'Adept' if level<15 else 'Expert' if level<20 else 'Master' if level<30 else 'Sage','streak':0,'streak_best':0,'badges':rows('SELECT * FROM badge'),'stats':{},'first_task_date':None}
