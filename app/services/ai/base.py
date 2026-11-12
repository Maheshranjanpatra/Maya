from abc import ABC,abstractmethod
from pydantic import BaseModel
class AIProviderError(Exception):
    '''Provider call failed after retry.'''
class AIProvider(ABC):
    name='unknown'; supports_vision=False
    @abstractmethod
    async def complete_json(self,system:str,user:str,schema:type[BaseModel]|None,image_bytes:bytes|None=None):...
    @abstractmethod
    async def complete_text(self,system:str,user:str,image_bytes:bytes|None=None)->str:...
