def generate_tasks(subject):
    out=[]
    for unit in subject.get('units',[]):
        total=sum(float(t.get('est_hours',1)) for t in unit.get('topics',[]))
        for topic in unit.get('topics',[]):
            out.append({'topic_index':len(out),'type':'read','title':'Read: '+topic['name'],'est_minutes':max(15,round(float(topic.get('est_hours',1))*24/5)*5),'is_revision':False})
        out.append({'topic_index':None,'type':'notes','title':'Notes: '+unit['name'],'est_minutes':max(15,round(total*18/5)*5),'is_revision':False})
        if any(int(t.get('difficulty',3))>=3 for t in unit.get('topics',[])):
            out.append({'topic_index':None,'type':'practice','title':'Practice: '+unit['name'],'est_minutes':max(15,round(total*30/5)*5),'is_revision':False})
    return out
