from flask import Blueprint, request, jsonify
from .db import get_db, rows, one
from .services.ai.factory import get_provider
from .services.ai.prompts import SYLLABUS_EXTRACT_PROMPT, QUICKADD_PROMPT, EXPLAIN_PROMPT, FLASHCARDS_PROMPT
from .ai_parser import Extraction
from .utils.extract_text import extract_text
import json
ai_bp=Blueprint('ai',__name__,url_prefix='/api')
def err(e):return jsonify(ok=False,error=str(e))
@ai_bp.post('/upload')
async def upload():
    try:
        f=request.files.get('file'); text=request.form.get('pasted_text','')
        if f:text=extract_text(f.filename,f.read(),get_provider())
        if not text.strip():return err('Choose a file or paste syllabus text.')
        p=get_provider()
        if not p:return err('Add GEMINI_API_KEY or GROQ_API_KEY to .env to enable parsing.')
        result=await p.complete_json(SYLLABUS_EXTRACT_PROMPT,'Subject name: '+request.form.get('subject_name','')+'\n'+text,Extraction)
        return jsonify(ok=True,data={'upload_id':'draft','extraction':result.model_dump()})
    except Exception as e:return err(str(e))
@ai_bp.post('/extract/commit')
def commit():
    d=request.get_json(silent=True) or {}; db=get_db(); ids=[]
    for s in d.get('subjects',[]):
        cur=db.execute('INSERT INTO subject(name,code,credits) VALUES(?,?,?)',(s['name'],s.get('code'),s.get('credits'))); sid=cur.lastrowid;ids.append(sid)
        for u in s.get('units',[]):
            uc=db.execute('INSERT INTO unit(subject_id,name,order_index) VALUES(?,?,?)',(sid,u['name'],u.get('order',1)));uid=uc.lastrowid
            for t in u.get('topics',[]):
                db.execute('INSERT INTO topic(unit_id,name,difficulty,marks,est_minutes,confidence) VALUES(?,?,?,?,?,?)',(uid,t['name'],t.get('difficulty',3),t.get('marks',0),int(float(t.get('est_hours',1))*60),t.get('confidence',.8)))
    db.commit();return jsonify(ok=True,data={'subject_ids':ids})
@ai_bp.post('/ai/quickadd')
async def quickadd():
    try:
        p=get_provider()
        if not p:return err('Add GEMINI_API_KEY or GROQ_API_KEY to .env to enable AI.')
        subjects=[x['name'] for x in rows('SELECT name FROM subject')]
        from datetime import date
        data=await p.complete_json(QUICKADD_PROMPT.replace('{TODAY_ISO}',date.today().isoformat()).replace('{SUBJECTS}',str(subjects)),(request.get_json() or {}).get('text',''),None)
        return jsonify(ok=True,data=data)
    except Exception as e:return err(str(e))
@ai_bp.post('/ai/explain')
async def explain():
    try:
        t=one('SELECT name,notes FROM topic WHERE id=?',((request.get_json() or {}).get('topic_id'),))
        if not t:return err('Topic not found')
        p=get_provider()
        if not p:return err('Add an AI key to enable explanations.')
        return jsonify(ok=True,data={'text':await p.complete_text(EXPLAIN_PROMPT,t['name']+'\n'+t['notes'])})
    except Exception as e:return err(str(e))
@ai_bp.post('/ai/flashcards')
async def flashcards():
    try:
        t=one('SELECT name,notes FROM topic WHERE id=?',((request.get_json() or {}).get('topic_id'),))
        if not t:return err('Topic not found')
        p=get_provider()
        if not p:return err('Add an AI key to enable flashcards.')
        from pydantic import BaseModel
        class Cards(BaseModel): cards:list[dict]
        out=await p.complete_json(FLASHCARDS_PROMPT,t['name']+' '+t['notes'],Cards)
        return jsonify(ok=True,data=out.model_dump()['cards'])
    except Exception as e:return err(str(e))
