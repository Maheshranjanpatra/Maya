import json,asyncio
from .base import AIProvider,AIProviderError
class CompatProvider(AIProvider):
    def __init__(self,name,key,model,base_url,vision=False):
        from openai import AsyncOpenAI
        self.name=name;self.supports_vision=vision;self.model=model;self.client=AsyncOpenAI(api_key=key,base_url=base_url)
    async def _call(self,system,user,json_mode=False):
        kwargs={'model':self.model,'messages':[{'role':'system','content':system},{'role':'user','content':user}]}
        if json_mode:kwargs['response_format']={'type':'json_object'}
        r=await self.client.chat.completions.create(**kwargs);return r.choices[0].message.content
    async def complete_json(self,system,user,schema,image_bytes=None):
        import json
        for _ in range(2):
            try:
                data=json.loads(await self._call(system,user,True))
                return schema.model_validate(data) if schema else data
            except Exception as e:last=e
        raise AIProviderError('AI returned invalid format') from last
    async def complete_text(self,system,user,image_bytes=None):return await self._call(system,user)
