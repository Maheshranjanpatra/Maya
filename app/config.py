import os
from pathlib import Path
class Config:
    SECRET_KEY=os.getenv('SECRET_KEY','change-me')
    DATABASE_PATH=os.getenv('DATABASE_PATH','data/maya.db')
    MAX_CONTENT_LENGTH=int(os.getenv('MAX_UPLOAD_MB','20'))*1024*1024
