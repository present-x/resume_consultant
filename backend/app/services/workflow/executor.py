from dataclasses import dataclass
from typing import AsyncIterator
from app.services.llm import LLMProviderBase
from app.prompts import load_prompt, build_user_message


@dataclass
class WorkflowStep:
    """Represents a single step in the resume analysis workflow."""
    step_number: int
    title: str
    description: str


WORKFLOW_STEPS = [
    WorkflowStep(1, "第一印象与初步诊断", "目标定位判断与30秒定论"),
    WorkflowStep(2, "地毯式深度审计与指导", "整体审计与模块化审计"),
    WorkflowStep(3, "战略性修改蓝图", "提供清晰、可执行的修改计划"),
    WorkflowStep(4, "重构与展示", "生成修改后的简历范本"),
    WorkflowStep(5, "最终裁决与行动清单", "总结评价与下一步行动"),
]


class WorkflowExecutor:
    """Executes the 5-step resume analysis workflow."""
    
    def __init__(self, llm_provider: LLMProviderBase):
        self.llm = llm_provider
        self.results: list[str] = []
    
    async def execute_step_stream(
        self,
        step: WorkflowStep,
        resume_text: str,
        job_description: str = None
    ) -> AsyncIterator[str]:
        """Execute a single workflow step with streaming output."""
        
        system_prompt = load_prompt(step.step_number)
        user_message = build_user_message(
            resume_text=resume_text,
            job_description=job_description,
            previous_results=self.results if self.results else None
        )
        
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message}
        ]
        
        # Collect full response for storing
        full_response = ""
        
        async for chunk in self.llm.chat_stream(messages, temperature=0.7):
            full_response += chunk
            yield chunk
        
        # Store result for subsequent steps
        self.results.append(full_response)
    
    async def execute_all_stream(
        self,
        resume_text: str,
        job_description: str = None
    ) -> AsyncIterator[dict]:
        """Execute all workflow steps, yielding step info and content chunks."""
        
        for step in WORKFLOW_STEPS:
            # Yield step start marker
            yield {
                "type": "step_start",
                "step": step.step_number,
                "title": step.title,
                "description": step.description
            }
            
            # Stream step content
            async for chunk in self.execute_step_stream(step, resume_text, job_description):
                yield {
                    "type": "content",
                    "step": step.step_number,
                    "content": chunk
                }
            
            # Yield step end marker
            yield {
                "type": "step_end",
                "step": step.step_number
            }
        
        # Yield completion marker
        yield {"type": "complete"}
