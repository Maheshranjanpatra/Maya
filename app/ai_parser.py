from pydantic import BaseModel
class Topic(BaseModel):
    name:str
    subtopics:list[str]=[]
    marks:float=0
    est_hours:float=1
    difficulty:int=3
    prerequisites:list[str]=[]
    confidence:float=0.8
class Unit(BaseModel):
    name:str
    order:int=1
    topics:list[Topic]=[]
class Subject(BaseModel):
    name:str
    code:str|None=None
    credits:float|None=None
    units:list[Unit]=[]
class Extraction(BaseModel):
    subjects:list[Subject]
    warnings:list[str]=[]
