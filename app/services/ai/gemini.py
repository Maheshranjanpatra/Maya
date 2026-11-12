import json, asyncio
from pydantic import BaseModel,ValidationError
from .base import AIProvider,AIProviderError
class GeminiProvider(AIProvider):
    name='gemini';supports_vision=True
    def __init__(self,key,model):
        import google.generativeai as genai
        genai.configure(api_key=key);self.model=genai.GenerativeModel(model)
    async def _generate(self,prompt,image_bytes=None,json_mode=False):
        def call():
            parts=[prompt]
            if image_bytes:
                from PIL import Image
                import io
                parts.append(Image.open(io.BytesIO(image_bytes)))
            return self.model.generate_content(parts,generation_config={'response_mime_type':'application/json'} if json_mode else None).text
        return await asyncio.to_thread(call)
    async def complete_json(self,system,user,schema,image_bytes=None):
        for _ in range(2):
            try:
                raw=await self._generate(system+'\n'+user,image_bytes,True); data=json.loads(raw)
                return schema.model_validate(data) if schema else data
            except Exception as e: last=e
        raise AIProviderError('AI returned invalid format') from last
    async def complete_text(self,system,user,image_bytes=None):return await self._generate(system+'\n'+user,image_bytes)
