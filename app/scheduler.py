from datetime import date,timedelta
def plan_week(start_date,subjects,exams,tasks,settings,blackouts):
    start=date.fromisoformat(str(start_date)[:10]); days=[]; cap=int(settings.get('daily_capacity_minutes',120))*(100-int(settings.get('buffer_pct',15)))//100
    blocked=set(blackouts); pending=[dict(t) for t in tasks if t.get('status','pending')=='pending']
    for n in range(7):
        d=start+timedelta(days=n); key=d.isoformat(); chosen=[]; used=0
        if d.weekday() in settings.get('study_days',[0,1,2,3,4,5,6]) and key not in blocked:
            for t in sorted(pending,key=lambda x:-float(x.get('priority_score',0))):
                if t.get('scheduled_date') in (None,key) and used+int(t['est_minutes'])<=cap:
                    chosen.append(t); used+=int(t['est_minutes'])
        days.append({'date':key,'minutes_planned':used,'tasks':chosen})
    return {'days':days}
def plan_day(day,subjects,exams,tasks,settings,blackouts):
    week=plan_week(day,subjects,exams,tasks,settings,blackouts); d=week['days'][0]
    return {'date':d['date'],'capacity_minutes':int(settings.get('daily_capacity_minutes',120)),'planned_minutes':d['minutes_planned'],'groups':[],'tasks':d['tasks']}
def replan(today,tasks,settings):
    missed=0
    for t in tasks:
        if t.get('status')=='pending' and t.get('scheduled_date') and t['scheduled_date']<str(today): missed+=1
    return {'moved':missed,'crunch':False,'explanation':'Overdue tasks are ready to be rescheduled.'}
