import os
from functools import lru_cache
def available_providers():
    return [n for n,k in [('gemini','GEMINI_API_KEY'),('groq','GROQ_API_KEY'),('grok','XAI_API_KEY'),('openai','OPENAI_API_KEY')] if os.getenv(k)]
@lru_cache(maxsize=1)
def get_provider():
    requested=os.getenv('AI_PROVIDER','').lower()
    choices={'gemini':('GEMINI_API_KEY','GEMINI_MODEL'),'groq':('GROQ_API_KEY','GROQ_MODEL'),'grok':('XAI_API_KEY','XAI_MODEL'),'xai':('XAI_API_KEY','XAI_MODEL'),'openai':('OPENAI_API_KEY','OPENAI_MODEL')}
    order=[requested] if requested in choices else ['gemini','groq','grok','openai']
    for name in order:
        keyvar,modelvar=choices[name];key=os.getenv(keyvar)
        if key:
            if name=='gemini':
                from .gemini import GeminiProvider
                return GeminiProvider(key,os.getenv(modelvar,'gemini-2.0-flash'))
            from .openai_compat import CompatProvider
            urls={'groq':'https://api.groq.com/openai/v1','grok':'https://api.x.ai/v1','openai':'https://api.openai.com/v1'}
            return CompatProvider(name,key,os.getenv(modelvar,'gpt-4o-mini'),urls[name],name=='openai')
    return None
