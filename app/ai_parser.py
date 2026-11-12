from pydantic import BaseModel, Field


class Topic(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    subtopics: list[str] = Field(default_factory=list)
    marks: float = Field(default=0, ge=0)
    est_hours: float = Field(default=1, ge=0.25, le=60)
    difficulty: int = Field(default=3, ge=1, le=5)
    prerequisites: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.8, ge=0, le=1)


class Unit(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    order: int = Field(default=1, ge=1)
    topics: list[Topic] = Field(default_factory=list)


class Subject(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    code: str | None = None
    credits: float | None = Field(default=None, ge=0)
    units: list[Unit] = Field(default_factory=list)


class Extraction(BaseModel):
    subjects: list[Subject] = Field(min_length=1)
    warnings: list[str] = Field(default_factory=list)
