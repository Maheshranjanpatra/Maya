from datetime import datetime,timezone
def calendar_text(tasks):
    lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Maya//Study Planner//EN']
    for t in tasks:
        if t.get('scheduled_date'):
            stamp=t['scheduled_date'].replace('-','')
            lines += ['BEGIN:VEVENT','UID:maya-task-%s@local'%t['id'],'DTSTART;VALUE=DATE:'+stamp,'SUMMARY:'+t['title'].replace(',','\\,'),'END:VEVENT']
    return '\r\n'.join(lines+['END:VCALENDAR'])
