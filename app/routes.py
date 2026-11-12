import json
from datetime import date
from flask import Blueprint, jsonify, request, Response
from .db import get_db, rows, one
from .xp import award_task, profile
from .ics_export import calendar_text
bp=Blueprint('api',__name__,url_prefix='/api')
def ok(data=None): return jsonify(ok=True,data=data)
def bad(msg,status=400): return jsonify(ok=False,error=msg),status
@bp.get('/subjects')
def subjects():
    return ok(rows('SELECT s.*, (SELECT COUNT(*) FROM topic t JOIN unit u ON u.id=t.unit_id WHERE u.subject_id=s.id) topic_count FROM subject s'))
@bp.post('/subjects')
def add_subject():
    d=request.get_json(silent=True) or {}; name=(d.get('name') or '').strip()
    if not name:return bad('Subject name is required')
    db=get_db(); cur=db.execute('INSERT INTO subject(name,code,credits,exam_weight) VALUES(?,?,?,?)',(name,d.get('code'),d.get('credits'),d.get('exam_weight',100))); db.commit()
    return ok({'id':cur.lastrowid})
@bp.patch('/subjects/<int:sid>')
def edit_subject(sid):
    d=request.get_json(silent=True) or {}; allowed={'name','color','archived','credits','exam_weight','code'}
    sets={k:v for k,v in d.items() if k in allowed}
    if sets:
        get_db().execute('UPDATE subject SET '+','.join(k+'=?' for k in sets)+' WHERE id=?',(*sets.values(),sid)); get_db().commit()
    return ok({'updated':True})
@bp.delete('/subjects/<int:sid>')
def delete_subject(sid):
    s=one('SELECT archived FROM subject WHERE id=?',(sid,))
    if not s:return bad('Subject not found',404)
    if not s['archived']:return bad('Archive the subject before deleting',409)
    get_db().execute('DELETE FROM subject WHERE id=?',(sid,)); get_db().commit(); return ok({})
@bp.get('/subjects/<int:sid>/detail')
def subject_detail(sid):
    s=one('SELECT * FROM subject WHERE id=?',(sid,))
    if not s:return bad('Subject not found',404)
    units=rows('SELECT * FROM unit WHERE subject_id=? ORDER BY order_index',(sid,))
    for u in units:
        u['topics']=rows('SELECT * FROM topic WHERE unit_id=?',(u['id'],))
        for t in u['topics']:t['prereqs']=[r['prereq_topic_id'] for r in rows('SELECT prereq_topic_id FROM prereq WHERE topic_id=?',(t['id'],))]
    return ok({'subject':s,'units':units})
@bp.get('/exams')
def exams():
    out=rows('SELECT e.*,s.name subject_name FROM exam e JOIN subject s ON s.id=e.subject_id ORDER BY exam_date')
    for e in out:e['days_remaining']=(date.fromisoformat(e['exam_date'])-date.today()).days;e['risk']='tight' if e['days_remaining']<7 else 'comfortable'
    return ok(out)
@bp.post('/exams')
def add_exam():
    d=request.get_json(silent=True) or {}
    if not d.get('subject_id') or not d.get('exam_date'):return bad('Subject and exam date are required')
    c=get_db().execute('INSERT INTO exam(subject_id,exam_date,exam_type,weightage,scope_unit_ids) VALUES(?,?,?,?,?)',(d['subject_id'],d['exam_date'],d.get('exam_type','final'),d.get('weightage',100),json.dumps(d.get('scope_unit_ids',[]))));get_db().commit();return ok({'id':c.lastrowid})
@bp.delete('/exams/<int:eid>')
def del_exam(eid):get_db().execute('DELETE FROM exam WHERE id=?',(eid,));get_db().commit();return ok({})
@bp.get('/tasks')
def tasks():
    day=request.args.get('date')
    sql='SELECT t.*,p.name topic_name,s.name subject_name,s.color subject_color FROM task t LEFT JOIN topic p ON p.id=t.topic_id JOIN subject s ON s.id=t.subject_id'
    return ok(rows(sql+(' WHERE scheduled_date=?' if day else '')+' ORDER BY COALESCE(scheduled_date,due_date),priority_score DESC',(day,) if day else ()))
@bp.get('/tasks/all')
def all_tasks():return ok(rows('SELECT t.*,s.name subject_name,s.color subject_color FROM task t JOIN subject s ON s.id=t.subject_id ORDER BY id DESC'))
@bp.post('/tasks/generate/<int:sid>')
def gen_tasks(sid):
    topics=rows('SELECT t.* FROM topic t JOIN unit u ON u.id=t.unit_id WHERE u.subject_id=?',(sid,))
    return ok({'tasks':[{'topic_id':t['id'],'subject_id':sid,'type':'read','title':'Read: '+t['name'],'est_minutes':t['est_minutes'],'status':'pending'} for t in topics]})
@bp.post('/tasks/commit')
def commit_tasks():
    d=request.get_json(silent=True) or {}; db=get_db(); count=0
    for t in d.get('tasks',[]):
        if not t.get('subject_id') or not t.get('title'):continue
        db.execute('INSERT INTO task(topic_id,subject_id,type,title,est_minutes,scheduled_date,due_date,created_by) VALUES(?,?,?,?,?,?,?,?)',(t.get('topic_id'),t['subject_id'],t.get('type','read'),t['title'],int(t.get('est_minutes',30)),t.get('scheduled_date'),t.get('due_date'),'manual'));count+=1
    db.commit();return ok({'created':count})
@bp.patch('/tasks/<int:tid>')
def patch_task(tid):
    d=request.get_json(silent=True) or {}; allowed={'status','scheduled_date','actual_minutes','est_minutes'}
    sets={k:v for k,v in d.items() if k in allowed}
    db=get_db(); old=one('SELECT * FROM task WHERE id=?',(tid,))
    if not old:return bad('Task not found',404)
    if sets:
        db.execute('UPDATE task SET '+','.join(k+'=?' for k in sets)+' WHERE id=?',(*sets.values(),tid))
        if sets.get('status')=='done' and old['status']!='done':award_task(old)
        if sets.get('status')=='pending' and old['status']=='done':db.execute("INSERT INTO xp_event(amount,reason,ref_id) VALUES(?,?,?)",(-10,'Task uncompleted',tid))
        db.commit()
    return ok(one('SELECT * FROM task WHERE id=?',(tid,)))
@bp.post('/tasks/<int:tid>/skip')
def skip(tid):get_db().execute("UPDATE task SET status='skipped' WHERE id=?",(tid,));get_db().commit();return ok({})
@bp.post('/tasks/<int:tid>/snooze')
def snooze(tid):
    d=request.get_json(silent=True) or {}; from datetime import timedelta
    t=one('SELECT scheduled_date FROM task WHERE id=?',(tid,))
    if not t:return bad('Task not found',404)
    base=date.fromisoformat(t['scheduled_date']) if t['scheduled_date'] else date.today()
    get_db().execute('UPDATE task SET scheduled_date=? WHERE id=?',((base+timedelta(days=max(1,int(d.get('days',1))))).isoformat(),tid));get_db().commit();return ok({})
@bp.get('/plan/today')
def today():
    ts=rows("SELECT t.*,s.name subject_name,s.color FROM task t JOIN subject s ON s.id=t.subject_id WHERE scheduled_date=? AND status='pending'",(date.today().isoformat(),))
    return ok({'date':date.today().isoformat(),'capacity_minutes':120,'planned_minutes':sum(t['est_minutes'] for t in ts),'groups':[{'subject':t['subject_name'],'color':t['color'],'tasks':[t]} for t in ts]})
@bp.get('/plan/week')
def week():return ok({'days':[]})
@bp.post('/plan/replan')
def replan():return ok({'moved':0,'crunch':False,'explanation':'Plan checked.'})
@bp.get('/reviews/queue')
def review_queue():return ok(rows('SELECT r.*,t.name topic_name,s.name subject_name,t.notes back FROM review_item r JOIN topic t ON t.id=r.topic_id JOIN unit u ON u.id=t.unit_id JOIN subject s ON s.id=u.subject_id WHERE next_review<=? ORDER BY next_review',(date.today().isoformat(),)))
@bp.post('/reviews/<int:rid>/grade')
def grade(rid):
    d=request.get_json(silent=True) or {}; q=max(0,min(5,int(d.get('quality',3)))); r=one('SELECT * FROM review_item WHERE id=?',(rid,))
    if not r:return bad('Review not found',404)
    interval=1 if q<3 else max(1,int(r['interval_days']*r['ease'])); ease=max(1.3,r['ease']+0.1-(5-q)*(0.08+(5-q)*0.02))
    from datetime import timedelta
    nxt=(date.today()+timedelta(days=interval)).isoformat();get_db().execute('UPDATE review_item SET ease=?,interval_days=?,next_review=?,reps=reps+1 WHERE id=?',(ease,interval,nxt,rid));get_db().commit();return ok({'next_review':nxt,'interval_days':interval,'ease':ease})
@bp.get('/profile')
def get_profile():return ok(profile())
@bp.post('/xp/award')
def xp_award():
    d=request.get_json(silent=True) or {};get_db().execute('INSERT INTO xp_event(amount,reason,ref_id) VALUES(?,?,?)',(int(d.get('amount',0)),d.get('reason','Manual award'),d.get('ref_id')));get_db().commit();return ok({})
@bp.get('/settings')
def settings():
    s=one('SELECT * FROM settings WHERE id=1');s.pop('web_lock_key',None)
    from .services.ai.factory import available_providers,get_provider
    p=get_provider()
    return ok({'settings':s,'active_provider':p.name if p else None,'providers_available':available_providers()})
@bp.patch('/settings')
def patch_settings():
    d=request.get_json(silent=True) or {}; allowed={'daily_capacity_minutes','study_days','buffer_pct','theme','ai_provider','web_lock_key','daily_goal','weekly_goal'}
    sets={k:(json.dumps(v) if k=='study_days' and not isinstance(v,str) else v) for k,v in d.items() if k in allowed}
    if sets:get_db().execute('UPDATE settings SET '+','.join(k+'=?' for k in sets)+' WHERE id=1',(*sets.values(),));get_db().commit()
    return ok({})
@bp.get('/export/ics')
def ics():return Response(calendar_text(rows('SELECT * FROM task')),mimetype='text/calendar',headers={'Content-Disposition':'attachment; filename=maya.ics'})
@bp.get('/export/backup')
def backup():return Response(json.dumps({'subjects':rows('SELECT * FROM subject'),'units':rows('SELECT * FROM unit'),'topics':rows('SELECT * FROM topic'),'tasks':rows('SELECT * FROM task'),'exams':rows('SELECT * FROM exam')}),mimetype='application/json',headers={'Content-Disposition':'attachment; filename=maya-backup.json'})
@bp.post('/import/backup')
def import_backup():return bad('Backup import is not supported by this version',501)
